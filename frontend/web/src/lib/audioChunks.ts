// 긴 녹음 대응: 브라우저에서 오디오를 16kHz 모노 WAV로 변환하고,
// STT 입력 한도(약 23분/25MB)를 넘지 않도록 조각(chunk)으로 분할한다.
// 각 조각은 별도 "녹음"으로 업로드되어 개별 전사되고, 분석 시 합쳐진다.

const TARGET_RATE = 16000;   // 16kHz 모노 → STT 품질 충분, 용량 최소
const CHUNK_SEC = 600;       // 조각당 10분
const THRESHOLD_SEC = 1000;
// **조각 하나가 절대 넘으면 안 되는 길이.** 목표치만 보고 자르면 끝에서 상한을 넘는 조각이 남는다 —
// v1 에서 25분 입력의 마지막 조각이 900초(28.8MB)가 되어 OpenAI 25MB 한도를 넘은 적이 있다.
// 16kHz 모노 16bit = 32,000 B/s → 25MB 는 819초. 720초면 23.0MB 로 여유가 있다.
const MAX_CHUNK_SEC = 720;  // 이보다 길면 분할 (23분 한도 대비 여유)
const MAX_BYTES = 23 * 1024 * 1024; // 원본 그대로 보낼 수 있는 크기 상한 (STT 25MB 한도 여유)

// 컷 지점을 찾을 때 목표 앞뒤로 살펴보는 범위. 문장 한가운데를 자르면 **양쪽 조각이 모두 손상된다** —
// 앞 조각은 말이 끊기고, 뒤 조각은 문맥 없이 시작해 화자 판정까지 흔들린다.
// v1 에서 검증된 값을 그대로 쓴다.
const CUT_SEARCH_SEC = 30;
const CUT_WINDOW_SEC = 0.5;

/**
 * 구간 안에서 **가장 조용한 지점**을 찾는다. 거기서 자르면 발화를 덜 다친다.
 *
 * 창을 통째로 다시 더하지 않고 이동합으로 계산한다 — 1시간 오디오에서 체감 차이가 크다.
 */
function quietestPoint(data: Float32Array, from: number, to: number): number {
  const win = Math.floor(CUT_WINDOW_SEC * TARGET_RATE);
  const start = Math.max(0, from);
  const end = Math.min(data.length - win, to);
  if (end <= start) return Math.min(Math.max(from, 0), data.length);

  let best = start;
  let bestEnergy = Infinity;
  let energy = 0;
  for (let i = start; i < start + win; i++) energy += data[i] * data[i];
  for (let i = start; i < end; i++) {
    if (energy < bestEnergy) { bestEnergy = energy; best = i; }
    energy += data[i + win] * data[i + win] - data[i] * data[i];
  }
  return best + Math.floor(win / 2);   // 조용한 구간의 한가운데
}

/**
 * 길이를 먼저 잰다.
 *
 * **크기만 보면 안 된다.** 예전에는 `blob.size <= MAX_BYTES` 면 그대로 통과시켰는데,
 * webm/opus 32kbps 기준 23MB 는 **약 100분**이다. 분할 없이 올라가
 * `gpt-4o-transcribe-diarize` 의 입력 한도(1400초 = 23분 20초)에 걸려 400 으로 실패했다.
 * 그 한도는 문서에 없고 400 응답으로만 드러난다.
 *
 * 전체 디코딩 없이 메타데이터만 읽는다 — 1시간짜리를 재려고 통째로 디코딩할 이유가 없다.
 */
async function probeDurationSec(blob: Blob): Promise<number | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const el = document.createElement('audio');
    const done = (v: number | null) => { URL.revokeObjectURL(url); resolve(v); };
    el.preload = 'metadata';
    el.onloadedmetadata = () => done(Number.isFinite(el.duration) ? el.duration : null);
    el.onerror = () => done(null);
    el.src = url;
    // 형식에 따라 이벤트가 오지 않을 수 있다. 그때는 디코딩 경로로 보낸다.
    setTimeout(() => done(null), 5000);
  });
}

export interface PreparedPart {
  file: File;
  durationSeconds: number;
}

function encodeWav(samples: Float32Array, sampleRate: number): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const writeStr = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
  };
  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);            // PCM
  view.setUint16(22, 1, true);            // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);            // block align
  view.setUint16(34, 16, true);           // bits per sample
  writeStr(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  let off = 44;
  for (let i = 0; i < samples.length; i++, off += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([view], { type: 'audio/wav' });
}

async function to16kMono(decoded: AudioBuffer): Promise<Float32Array> {
  const length = Math.max(1, Math.ceil(decoded.duration * TARGET_RATE));
  const OfflineCtx =
    (window as any).OfflineAudioContext || (window as any).webkitOfflineAudioContext;
  const off = new OfflineCtx(1, length, TARGET_RATE); // 채널 1 → 자동 다운믹스
  const src = off.createBufferSource();
  src.buffer = decoded;
  src.connect(off.destination);
  src.start(0);
  const rendered = await off.startRendering();
  return rendered.getChannelData(0);
}

/**
 * blob(webm/wav/…)을 16kHz 모노 WAV로 변환하고, 길면 10분 조각으로 분할.
 * Web Audio 사용 불가 시 원본을 그대로 1개로 반환(폴백).
 */
export async function prepareRecordings(blob: Blob): Promise<PreparedPart[]> {
  // **길이와 크기를 모두 만족할 때만** 원본 그대로 보낸다.
  // 크기만 봤다가 100분짜리 23MB 파일이 분할 없이 올라가 실패한 적이 있다.
  const probed = await probeDurationSec(blob);
  const shortEnough = probed != null && probed <= THRESHOLD_SEC;
  if (blob.size <= MAX_BYTES && shortEnough) {
    const name = (blob as File).name || 'recording.webm';
    const file = blob instanceof File ? blob : new File([blob], name, { type: blob.type || 'audio/webm' });
    return [{ file, durationSeconds: 0 }];
  }

  const AC = (window as any).AudioContext || (window as any).webkitAudioContext;
  if (!AC) return [{ file: blob as File, durationSeconds: 0 }];

  let decoded: AudioBuffer;
  const ctx = new AC();
  try {
    decoded = await ctx.decodeAudioData(await blob.arrayBuffer());
  } catch {
    try { await ctx.close(); } catch { /* ignore */ }
    return [{ file: blob as File, durationSeconds: 0 }];
  }
  try { await ctx.close(); } catch { /* ignore */ }

  const mono = await to16kMono(decoded);
  const total = mono.length / TARGET_RATE;
  const mk = (samples: Float32Array, name: string, dur: number): PreparedPart => ({
    file: new File([encodeWav(samples, TARGET_RATE)], name, { type: 'audio/wav' }),
    durationSeconds: Math.round(dur),
  });

  if (total <= THRESHOLD_SEC) {
    return [mk(mono, 'recording.wav', total)];
  }

  // 고정 간격이 아니라 **무음 지점**에서 자른다.
  // 예전에는 정확히 10분마다 잘라 문장 한가운데가 끊겼다.
  const target = CHUNK_SEC * TARGET_RATE;
  const max = MAX_CHUNK_SEC * TARGET_RATE;
  const search = CUT_SEARCH_SEC * TARGET_RATE;

  // "남은 길이가 상한을 넘는 동안" 으로 돌린다 — 이러면 **마지막 조각도 상한 이하가 보장된다.**
  const cuts: number[] = [0];
  while (mono.length - cuts[cuts.length - 1] > max) {
    const last = cuts[cuts.length - 1];
    const remaining = mono.length - last;
    // 남은 길이가 상한의 두 배 이하면 반으로 나눈다. 그러지 않으면 끝에 짧은 꼬리가 남고,
    // 짧은 조각은 화자 클러스터링에 쓸 음성이 부족해 화자 수를 과소 감지한다.
    const nominal = remaining <= max * 2 ? last + Math.floor(remaining / 2) : last + target;
    const cut = quietestPoint(mono, nominal - search, nominal + search);
    if (cut <= last) break;   // 진행이 없으면 멈춘다 (무한 루프 방지)
    cuts.push(cut);
  }
  cuts.push(mono.length);

  const parts: PreparedPart[] = [];
  for (let i = 0; i < cuts.length - 1; i++) {
    const slice = new Float32Array(mono.subarray(cuts[i], cuts[i + 1]));
    parts.push(mk(slice, `part-${i + 1}.wav`, slice.length / TARGET_RATE));
  }
  return parts;
}

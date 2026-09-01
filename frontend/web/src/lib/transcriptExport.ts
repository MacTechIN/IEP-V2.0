// 화자별 대화 내려받기 — 문서 모델과 세 형식 (2026-08-18)
//
// **세 형식이 각자 녹취를 읽지 않는다.** 가운데에 문서 모델(`TranscriptDoc`) 하나를 두고
// 텍스트·워드·인쇄가 그것만 본다. 형식마다 따로 짜면 머리말을 고칠 때 세 군데를 고쳐야 하고,
// 반드시 한 군데를 빠뜨린다.
//
//   segments ─▶ buildTranscriptDoc() ─▶ TranscriptDoc ─┬─▶ toPlainText()  ─▶ .txt
//                                                      ├─▶ buildDocx()    ─▶ .docx
//                                                      └─▶ toPrintHtml()  ─▶ 인쇄창
//
// **범위는 항상 전체다.** 화자 필터·검색·"짧은 발화 접기" 는 화면의 사정이고,
// 받은 파일이 그때그때 달라지면 나중에 그 파일만 봤을 때 일부인지 전부인지 알 수 없다.
// 그래서 이 파일은 걸러진 목록(`shownSegments`)을 아예 받지 않는다 — 원본 `segments` 만 받는다.

/** 화면 집계(`MeetingDetailPage`)와 **같은 규칙**을 쓴다. 어긋나면 화자 수가 서로 다르게 보인다. */
export const UNKNOWN_SPEAKER = '알 수 없음';

export interface ExportSegment {
  speakerLabel?: string | null;
  content?: string | null;
}

export interface ExportMeeting {
  /** 비닉권 대상 (021) */
  privileged?: boolean;
  title?: string;
  startTime?: string;
  customerName?: string;
  /**
   * 작성자 — 프로필의 변호사 정보 (026).
   *
   * **이 문서는 사무소 밖으로 나간다.** 받은 사람이 누가 작성한 것인지 알아야 하고,
   * 되물을 곳(사무실 번호)이 적혀 있어야 한다. 비어 있으면 그 줄을 아예 넣지 않는다 —
   * 「작성자: 」 라고 빈 채로 찍히는 것이 안 적힌 것보다 나쁘다.
   */
  author?: {
    name?: string | null; barNo?: string | null; firmName?: string | null;
    position?: string | null; officePhone?: string | null;
  } | null;
}

export interface TranscriptDoc {
  title: string;
  subtitle: string;
  meta: { label: string; value: string }[];
  /** 같은 화자의 연속 발화는 한 덩어리다 — 아래 `buildTranscriptDoc` 주석 참고. */
  blocks: { speaker: string; lines: string[] }[];
  /** 파일 이름에 쓰는 **미팅 날짜**(YYYY-MM-DD). 내려받은 날이 아니다. */
  dateKey: string;
  /** 비닉권 대상인가 (021). 참이면 모든 형식의 **맨 위에** 고지가 박힌다. */
  privileged?: boolean;
}

const speakerOf = (s: ExportSegment): string =>
  (s.speakerLabel || '').trim() || UNKNOWN_SPEAKER;

const two = (n: number) => String(n).padStart(2, '0');

/** `2026-08-14 14:00`. 브라우저 시간대로 읽는다 — 사용자가 화면에서 본 값과 같아야 한다. */
function formatDateTime(d: Date): string {
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())} `
    + `${two(d.getHours())}:${two(d.getMinutes())}`;
}

/** `2026-08-14`. 파일 이름용. 미팅 시각이 없거나 깨졌으면 오늘로 떨어진다. */
function dateKeyOf(iso: string | undefined, fallback: Date): string {
  const d = iso ? new Date(iso) : fallback;
  const ok = Number.isNaN(d.getTime()) ? fallback : d;
  return `${ok.getFullYear()}-${two(ok.getMonth() + 1)}-${two(ok.getDate())}`;
}

/**
 * 녹취를 문서로 옮긴다.
 *
 * **같은 화자가 연달아 말한 것은 한 덩어리로 묶는다.** 발화 404개를 그대로 펼치면
 * `[영업대표]` 가 404번 반복되는데, 그건 사람이 읽을 수 있는 문서가 아니다.
 *
 * `now` 를 밖에서 넣을 수 있게 둔 것은 테스트 때문이다 — "내려받은 때" 가 매번 달라지면
 * 출력 전체를 문자열로 비교할 수 없다.
 */
/**
 * 비닉권 고지. **내보내는 문서에는 반드시 박힌다** (021).
 *
 * 표시를 DB 에만 두면 아무 소용이 없다 — 파일은 사무소 밖으로 나가고,
 * 받은 사람은 이것이 무엇인지 알아야 한다.
 * 문구는 법률 검토를 받아 고칠 자리다. 지금은 사실만 적는다.
 */
export const PRIVILEGE_NOTICE =
  '[비밀유지·비닉권 대상] 이 문서는 변호사와 의뢰인 사이의 상담 기록입니다. '
  + '변호인·의뢰인 특권의 보호 대상일 수 있으며, 수신인 외의 열람·복제·배포를 금합니다. '
  + '잘못 받으셨다면 즉시 알려 주시고 폐기해 주십시오.';

export function buildTranscriptDoc(
  meeting: ExportMeeting,
  segments: ExportSegment[],
  now: Date = new Date(),
): TranscriptDoc {
  const blocks: TranscriptDoc['blocks'] = [];
  const speakers = new Set<string>();
  let spoken = 0;

  for (const s of segments) {
    const text = (s.content || '').trim();
    // 빈 줄은 문서에 넣지 않는다. 화면에서는 자리라도 차지하지만 문서에는 이름만 남는다.
    if (!text) continue;
    const speaker = speakerOf(s);
    speakers.add(speaker);
    spoken += 1;
    const last = blocks[blocks.length - 1];
    if (last && last.speaker === speaker) last.lines.push(text);
    else blocks.push({ speaker, lines: [text] });
  }

  const meta: TranscriptDoc['meta'] = [];
  const when = meeting.startTime ? formatDateTime(new Date(meeting.startTime)) : '';
  if (when) meta.push({ label: '일시', value: when });
  if (meeting.customerName) meta.push({ label: '의뢰인', value: meeting.customerName });
  meta.push({ label: '발화', value: `${spoken}개 · 화자 ${speakers.size}명` });
  meta.push({ label: '내려받은 때', value: formatDateTime(now) });
  // 작성자 (026). **채워진 것만 이어 붙인다** — 빈 괄호가 찍히면 안 된다.
  const a = meeting.author;
  if (a) {
    const who = [a.firmName, a.name && a.position ? `${a.name} ${a.position}` : a.name]
      .filter(Boolean).join(' · ');
    const id = a.barNo ? `변호사등록번호 ${a.barNo}` : '';
    const line = [who, id, a.officePhone].filter(Boolean).join(' · ');
    if (line) meta.push({ label: '작성자', value: line });
  }

  return {
    title: (meeting.title || '').trim() || '미팅',
    subtitle: '화자별 대화',
    meta,
    blocks,
    dateKey: dateKeyOf(meeting.startTime, now),
    privileged: !!meeting.privileged,
  };
}

// ─────────────────────────── 텍스트

/** 한글은 두 칸을 먹는다. 글자 수로 맞추면 라벨이 들쭉날쭉해진다. */
function displayWidth(s: string): number {
  let w = 0;
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    w += (c >= 0x1100 && c <= 0x115f) || (c >= 0x2e80 && c <= 0xa4cf)
      || (c >= 0xac00 && c <= 0xd7a3) || (c >= 0xf900 && c <= 0xfaff)
      || (c >= 0xfe30 && c <= 0xfe6f) || (c >= 0xff00 && c <= 0xff60)
      || (c >= 0xffe0 && c <= 0xffe6) ? 2 : 1;
  }
  return w;
}

const padTo = (s: string, width: number) => s + ' '.repeat(Math.max(0, width - displayWidth(s)));

/** UTF-8 BOM. 리터럴로 넣으면 편집기마다 보이지 않게 사라져 사고가 난다 — 이스케이프로 쓴다. */
export const BOM = '\uFEFF';

/**
 * `.txt` 본문.
 *
 * **줄바꿈은 CRLF 다.** LF 만 있으면 Windows 메모장이 전체를 한 줄로 뭉갠다.
 * **BOM 을 붙인다.** 없으면 엑셀과 구형 메모장이 UTF-8 을 못 알아보고 한글을 깨뜨린다.
 * 둘 다 "내 컴퓨터에서는 되던" 것이 남의 컴퓨터에서 깨지는 전형적인 자리다.
 */
export function toPlainText(doc: TranscriptDoc): string {
  const rule = '─'.repeat(40);
  const labelWidth = Math.max(...doc.meta.map((m) => displayWidth(m.label)));
  const out: string[] = [
    // **맨 위다.** 아래에 두면 읽지 않는다.
    ...(doc.privileged ? [PRIVILEGE_NOTICE, rule] : []),
    doc.title,
    doc.subtitle,
    rule,
    ...doc.meta.map((m) => `${padTo(m.label, labelWidth)}   ${m.value}`),
    rule,
    '',
  ];
  for (const b of doc.blocks) {
    out.push(`[${b.speaker}]`, ...b.lines, '');
  }
  return BOM + out.join('\r\n');
}

export const TEXT_MIME = 'text/plain;charset=utf-8';

// ─────────────────────────── 인쇄 (PDF)

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!
  ));
}

/**
 * 인쇄용 HTML.
 *
 * PDF 를 라이브러리로 만들지 않는 이유는 **한글 폰트**다. jsPDF·pdf-lib 의 내장 폰트에는
 * 한글이 없어 Noto Sans KR 을 서브셋해 실어야 하는데, 상용 2,780자만 잡아도 1MB 안팎이
 * 붙는다(지금 번들이 726KB 다). 브라우저 인쇄는 시스템 폰트를 그대로 쓰고 줄바꿈·페이지
 * 나눔을 브라우저가 처리하며, **번들이 한 바이트도 늘지 않는다.**
 */
export function toPrintHtml(doc: TranscriptDoc): string {
  const meta = doc.meta
    .map((m) => `<tr><th>${escapeHtml(m.label)}</th><td>${escapeHtml(m.value)}</td></tr>`)
    .join('');
  const body = doc.blocks.map((b) => (
    '<section class="block">'
    + `<p class="speaker">${escapeHtml(b.speaker)}</p>`
    + b.lines.map((l) => `<p class="line">${escapeHtml(l)}</p>`).join('')
    + '</section>'
  )).join('');

  return `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><title>${escapeHtml(doc.title)}</title>
<style>
  @page { size: A4; margin: 18mm 16mm; }
  * { box-sizing: border-box; }
  body { margin: 0; color: #111;
         font-family: -apple-system, BlinkMacSystemFont, "Malgun Gothic", "맑은 고딕",
                      "Apple SD Gothic Neo", "Noto Sans KR", sans-serif;
         font-size: 10.5pt; line-height: 1.6; }
  h1 { font-size: 17pt; margin: 0 0 2px; }
  .subtitle { color: #555; font-size: 10pt; margin: 0 0 12px; }
  table.meta { border-collapse: collapse; margin: 0 0 14px; }
  table.meta th { text-align: left; font-weight: 600; color: #555;
                  padding: 1px 16px 1px 0; white-space: nowrap; vertical-align: top; }
  table.meta td { padding: 1px 0; }
  hr { border: 0; border-top: 1px solid #ccc; margin: 0 0 16px; }
  /* 비닉권 고지 (021). **맨 위에 크게** — 아래에 두면 읽지 않는다.
     인쇄에서 첫 장에만 나오지만, 종이 뭉치의 첫 장이 곧 그 문서의 얼굴이다. */
  .privilege { border: 1.5pt solid #991B1B; color: #991B1B; background: #FEF2F2;
               padding: 8px 10px; margin: 0 0 14px; font-size: 9.5pt; line-height: 1.5;
               break-inside: avoid; }
  /* 화자 이름만 페이지 맨 아래 남고 말은 다음 장으로 넘어가는 것을 막는다 */
  .block { break-inside: avoid; page-break-inside: avoid; margin: 0 0 12px; }
  .speaker { font-weight: 700; margin: 0 0 3px;
             break-after: avoid; page-break-after: avoid; }
  .line { margin: 0 0 3px; }
</style></head>
<body>
${doc.privileged ? `<div class="privilege">${escapeHtml(PRIVILEGE_NOTICE)}</div>` : ''}
<h1>${escapeHtml(doc.title)}</h1>
<p class="subtitle">${escapeHtml(doc.subtitle)}</p>
<table class="meta">${meta}</table>
<hr>
${body}
</body></html>`;
}

/**
 * 숨은 iframe 으로 인쇄창을 연다.
 *
 * **`window.open` 을 쓰지 않는다** — 팝업 차단기에 막히면 아무 일도 일어나지 않고,
 * 사용자는 왜 안 되는지 알 방법이 없다. iframe 은 차단 대상이 아니다.
 */
export function printDoc(html: string): void {
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  // **`visibility:hidden` 이나 `display:none` 을 쓰지 않는다.** 숨김으로 처리된 iframe 은
  // 브라우저가 렌더 트리에서 빼 버려 빈 페이지가 인쇄될 수 있다. 0×0 이면 어차피 안 보인다.
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
  frame.srcdoc = html;

  // 두 번 불려도 안전하다 — 이미 떨어져 나간 노드의 remove() 는 아무 일도 하지 않는다
  const cleanup = () => frame.remove();

  frame.onload = () => {
    const w = frame.contentWindow;
    if (!w) { cleanup(); return; }
    w.addEventListener('afterprint', cleanup);
    // **Safari 는 afterprint 를 부르지 않을 때가 있다.** 그러면 iframe 이 계속 쌓인다.
    // print() 는 대화상자가 닫힐 때까지 멈춰 있으므로, 이 10초는 닫힌 뒤부터 센다.
    setTimeout(cleanup, 10000);
    w.focus();
    w.print();
  };

  document.body.appendChild(frame);
}

// ─────────────────────────── 워드

/**
 * 진짜 `.docx`(OOXML) 를 만든다.
 *
 * HTML 에 `.doc` 확장자를 붙이는 흔한 편법은 쓰지 않는다 — Word 가 "파일 형식과 확장명이
 * 일치하지 않습니다" 경고를 띄우고 구글 문서에서는 깨진다. **받은 사람이 경고창부터 보는
 * 파일은 내보내기가 아니다.**
 *
 * `docx` 는 여기서 **동적으로 받는다.** 메뉴에서 워드를 고른 사람만 내려받으면 되고,
 * 정적으로 import 하면 워드를 한 번도 안 쓰는 사람의 첫 화면까지 무거워진다.
 */
export async function buildDocx(doc: TranscriptDoc): Promise<Blob> {
  const {
    Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType,
    Table, TableRow, TableCell, WidthType, BorderStyle,
  } = await import('docx');

  const NONE = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
  const cell = (children: InstanceType<typeof Paragraph>[], width: number) => new TableCell({
    children,
    width: { size: width, type: WidthType.PERCENTAGE },
    borders: { top: NONE, bottom: NONE, left: NONE, right: NONE },
    margins: { top: 0, bottom: 0, left: 0, right: 120 },
  });

  const metaTable = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: NONE, bottom: NONE, left: NONE, right: NONE,
      insideHorizontal: NONE, insideVertical: NONE,
    },
    rows: doc.meta.map((m) => new TableRow({
      children: [
        cell([new Paragraph({
          children: [new TextRun({ text: m.label, bold: true, color: '555555' })],
        })], 22),
        cell([new Paragraph({ text: m.value })], 78),
      ],
    })),
  });

  const body: InstanceType<typeof Paragraph>[] = [];
  for (const b of doc.blocks) {
    body.push(new Paragraph({
      children: [new TextRun({ text: b.speaker, bold: true })],
      spacing: { before: 160, after: 40 },
      // 화자 이름이 페이지 맨 아래 홀로 남지 않게 다음 문단과 붙인다
      keepNext: true,
    }));
    for (const line of b.lines) {
      body.push(new Paragraph({ text: line, spacing: { line: 276, after: 40 } }));
    }
  }

  const file = new Document({
    title: `${doc.title} — ${doc.subtitle}`,
    creator: 'SEP',
    description: doc.subtitle,
    styles: {
      default: {
        document: { run: { font: '맑은 고딕', size: 21 } },   // 21 half-point = 10.5pt
      },
    },
    sections: [{
      children: [
        // 비닉권 고지 (021). **맨 위다** — 받은 사람이 열자마자 봐야 한다.
        ...(doc.privileged ? [new Paragraph({
          children: [new TextRun({ text: PRIVILEGE_NOTICE, color: '991B1B', bold: true, size: 18 })],
          spacing: { after: 240 },
        })] : []),
        new Paragraph({
          text: doc.title,
          heading: HeadingLevel.HEADING_1,
          alignment: AlignmentType.LEFT,
        }),
        new Paragraph({
          children: [new TextRun({ text: doc.subtitle, color: '555555' })],
          spacing: { after: 200 },
        }),
        metaTable,
        new Paragraph({ text: '', spacing: { after: 120 } }),
        ...body,
      ],
    }],
  });

  return Packer.toBlob(file);
}

export const DOCX_MIME =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

// ─────────────────────────── 파일 이름 · 저장

/** Windows 가 거부하는 글자들(제어문자 포함). 안 걸러 내면 저장 자체가 실패한다. */
const ILLEGAL = /[\\/:*?"<>|\u0000-\u001f]/g;
const TITLE_MAX = 120;

/**
 * `위바이K 해외구매대행플렛폼 개발 기획논의_화자별대화_2026-08-14.txt`
 *
 * 날짜는 **미팅 날짜**다 — 같은 미팅을 두 번 받아도 같은 이름이어야 한다.
 */
export function safeFileName(title: string, dateKey: string, ext: string): string {
  let base = (title || '')
    .replace(ILLEGAL, '_')
    .replace(/\s+/g, ' ')
    .replace(/^[.\s]+|[.\s]+$/g, '');
  if (base.length > TITLE_MAX) base = base.slice(0, TITLE_MAX).trim();
  if (!base) base = '미팅';
  return `${base}_화자별대화_${dateKey}.${ext}`;
}

export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  // **바로 해제하면 사파리에서 저장이 취소된다.** 한 박자 뒤에 푼다.
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

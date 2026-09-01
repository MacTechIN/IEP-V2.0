// 녹음 재생기 (012)
//
// **왜 필요한가**: 녹취 편집을 넣었는데 원본을 들어볼 수 없었다.
// 전사가 틀린 것 같아도 고칠지 말지 판단할 근거가 화면에 없었다.
//
// **조사 하나에 녹음이 여러 개다.** 이어붙이지 않고 고르게 한다 —
// 이어붙이려면 오디오를 가공해야 하고, 그러면 기존 분석의 시각과 어긋난다.

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Box, MenuItem, Select, Typography } from '@mui/material';
import { apiClient } from '../services/api';

export interface Recording {
  id: string;
  label?: string | null;
  durationSeconds?: number | null;
}

export interface AudioPlayerHandle {
  /** 그 녹음의 그 시각으로. 녹취 줄의 `▶ 0:15` 버튼이 부른다. */
  playAt: (recordingId: string, ms: number) => void;
}

interface Props {
  recordings: Recording[];
  /** 재생 위치(초). 녹취 강조에 쓸 수 있게 밖으로 알린다. */
  onTime?: (recordingId: string, sec: number) => void;
}

export const fmtTime = (sec: number) => {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

export default forwardRef<AudioPlayerHandle, Props>(function AudioPlayer(
  { recordings, onTime }, ref,
) {
  const [current, setCurrent] = useState(recordings[0]?.id || '');
  const [error, setError] = useState('');
  const audioRef = useRef<HTMLAudioElement | null>(null);
  // 다른 녹음으로 바꾸고 나서 튀어야 할 위치. 로드가 끝나야 seek 할 수 있다.
  const pendingSeek = useRef<number | null>(null);

  useEffect(() => {
    if (!current && recordings[0]) setCurrent(recordings[0].id);
  }, [recordings, current]);

  useImperativeHandle(ref, () => ({
    playAt(recordingId, ms) {
      const sec = ms / 1000;
      if (recordingId !== current) {
        // 소스가 바뀌면 로드를 기다려야 한다. onLoadedMetadata 에서 이어받는다.
        pendingSeek.current = sec;
        setCurrent(recordingId);
        return;
      }
      const a = audioRef.current;
      if (!a) return;
      a.currentTime = sec;
      void a.play().catch(() => {});
    },
  }), [current]);

  // 녹음을 고를 때마다 **그 녹음의 티켓**을 새로 받는다.
  // 액세스 토큰을 URL 에 싣지 않는다 — 그건 계정 전체 권한이고 한 시간을 산다.
  const [src, setSrc] = useState('');
  useEffect(() => {
    if (!current) { setSrc(''); return; }
    let alive = true;
    (async () => {
      try {
        const r = await apiClient.getAudioTicket(current);
        const t = r?.data?.ticket;
        if (!alive) return;
        if (!t) { setError('재생 권한을 확인하지 못했습니다.'); return; }
        setError('');
        setSrc(`${import.meta.env.VITE_API_URL}/recordings/${current}/audio?t=${encodeURIComponent(t)}`);
      } catch {
        if (alive) setError('재생 권한을 확인하지 못했습니다.');
      }
    })();
    return () => { alive = false; };
  }, [current]);

  if (!recordings.length) return null;

  return (
    <Box sx={{ mb: 2 }}>
      {recordings.length > 1 && (
        <Select
          size="small" value={current} fullWidth
          onChange={(e) => { setCurrent(e.target.value); setError(''); }}
          sx={{ mb: 1 }}
        >
          {recordings.map((r) => (
            <MenuItem key={r.id} value={r.id}>
              {r.label || '녹음'}
              {r.durationSeconds ? ` · ${fmtTime(r.durationSeconds)}` : ''}
            </MenuItem>
          ))}
        </Select>
      )}

      <audio
        ref={audioRef}
        src={src}
        controls
        preload="metadata"
        style={{ width: '100%', height: 40 }}
        onLoadedMetadata={() => {
          setError('');
          // 녹음을 바꿔서 온 경우, 여기서 원하던 위치로 튄다
          if (pendingSeek.current != null && audioRef.current) {
            audioRef.current.currentTime = pendingSeek.current;
            pendingSeek.current = null;
            void audioRef.current.play().catch(() => {});
          }
        }}
        onTimeUpdate={() => {
          if (onTime && audioRef.current) onTime(current, audioRef.current.currentTime);
        }}
        onError={() => setError('녹음을 불러오지 못했습니다. 파일이 지워졌을 수 있습니다.')}
      />

      {error && (
        <Typography variant="caption" color="error" sx={{ display: 'block', mt: 0.5 }}>
          {error}
        </Typography>
      )}
    </Box>
  );
});

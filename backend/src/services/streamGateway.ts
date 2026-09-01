import { WebSocketServer, WebSocket } from 'ws';
import type { Server } from 'http';
import { AuthService } from './authService';
import { logger } from '../utils/logger';

// RT-1: 브라우저 오디오(linear16 16kHz) → Deepgram 스트리밍(실시간 화자분리) → 클라이언트로 전사 반환
const DEEPGRAM_API_KEY = process.env.DEEPGRAM_API_KEY;
const DG_LANGUAGE = process.env.DEEPGRAM_LANGUAGE || 'multi';
const DG_MODEL = process.env.DEEPGRAM_MODEL || 'nova-3';
const STREAM_PATH = '/api/v2/stream';

function deepgramUrl(): string {
  const params = new URLSearchParams({
    model: DG_MODEL,
    language: DG_LANGUAGE,
    diarize: 'true',
    punctuate: 'true',
    smart_format: 'true',
    interim_results: 'true',
    encoding: 'linear16',
    sample_rate: '16000',
    channels: '1',
  });
  return `wss://api.deepgram.com/v1/listen?${params.toString()}`;
}

export function attachStreamGateway(server: Server): void {
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    let url: URL;
    try { url = new URL(req.url || '', 'http://localhost'); } catch { socket.destroy(); return; }
    if (url.pathname !== STREAM_PATH) return; // 다른 업그레이드는 건드리지 않음

    const token = url.searchParams.get('token');
    try {
      if (!token) throw new Error('no token');
      AuthService.verifyToken(token);
    } catch {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (client) => wss.emit('connection', client, req));
  });

  wss.on('connection', (client: WebSocket) => {
    if (!DEEPGRAM_API_KEY) {
      client.send(JSON.stringify({ type: 'error', message: 'DEEPGRAM_API_KEY not configured' }));
      client.close();
      return;
    }

    const dg = new WebSocket(deepgramUrl(), { headers: { Authorization: `Token ${DEEPGRAM_API_KEY}` } });
    let dgReady = false;
    const pending: Buffer[] = [];
    let keepAlive: NodeJS.Timeout | null = null;

    dg.on('open', () => {
      dgReady = true;
      for (const b of pending) dg.send(b);
      pending.length = 0;
      client.send(JSON.stringify({ type: 'ready' }));
      // 무음 시 Deepgram 연결 유지
      keepAlive = setInterval(() => {
        try { if (dg.readyState === WebSocket.OPEN) dg.send(JSON.stringify({ type: 'KeepAlive' })); } catch { /* ignore */ }
      }, 8000);
      logger.info('Deepgram stream opened');
    });

    dg.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.channel?.alternatives?.length) {
          const alt = msg.channel.alternatives[0];
          if (alt.transcript && alt.transcript.trim()) {
            client.send(JSON.stringify({
              type: 'transcript',
              text: alt.transcript,
              is_final: !!msg.is_final,
              speech_final: !!msg.speech_final,
              speaker: alt.words?.[0]?.speaker ?? null,
              start: msg.start,
              duration: msg.duration,
            }));
          }
        }
      } catch { /* ignore non-JSON */ }
    });

    dg.on('error', (e) => {
      logger.error(`Deepgram stream error: ${e}`);
      try { client.send(JSON.stringify({ type: 'error', message: 'stt_error' })); } catch { /* ignore */ }
    });
    dg.on('close', () => {
      if (keepAlive) clearInterval(keepAlive);
      try { client.close(); } catch { /* ignore */ }
    });

    client.on('message', (data, isBinary) => {
      if (isBinary) {
        const buf = data as Buffer;
        if (dgReady) { try { dg.send(buf); } catch { /* ignore */ } }
        else pending.push(buf);
      } else {
        // 제어 메시지 (예: {"type":"stop"})
        try {
          const m = JSON.parse(data.toString());
          if (m.type === 'stop' && dg.readyState === WebSocket.OPEN) dg.send(JSON.stringify({ type: 'CloseStream' }));
        } catch { /* ignore */ }
      }
    });

    client.on('close', () => {
      if (keepAlive) clearInterval(keepAlive);
      try {
        if (dg.readyState === WebSocket.OPEN) { dg.send(JSON.stringify({ type: 'CloseStream' })); dg.close(); }
      } catch { /* ignore */ }
    });
  });

  logger.info(`✓ Stream gateway attached at ${STREAM_PATH}`);
}

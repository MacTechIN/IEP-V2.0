import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    open: true,
  },
  build: {
    outDir: 'dist',
    // 소스맵은 개발에서만. 공개 호스팅에 올리면 프런트엔드 전체 소스가 그대로 노출된다
    // (3.5MB 짜리 index.js.map 이 dist 에 같이 실려 있었다).
    sourcemap: process.env.NODE_ENV !== 'production',
    rollupOptions: {
      output: {
        /**
         * **동적 import 로 갈라진 청크는 `index-` 로 시작하면 안 된다.**
         *
         * 배포 워크플로는 "방금 빌드한 번들"을 `ls dist/assets | grep '^index-…\.js$' | head -1`
         * 로 고르고, 사이트가 그 이름을 서비스할 때까지 기다린다(`.github/workflows/deploy.yml`).
         * 그런데 청크 이름은 기본값이 모듈 파일 이름에서 나온다 — `docx/build/index.mjs` 를
         * 동적으로 부르자 청크 이름이 그대로 `index-<해시>.js` 가 됐고, 알파벳순 첫 줄이
         * **진짜 진입점이 아닌 docx 청크**가 됐다. 그 상태로 올리면 배포는 성공하는데
         * 확인 단계가 5분을 기다린 끝에 실패한다.
         *
         * 진입점만 `index-` 를 쓰게 하고 나머지는 `chunk-` 로 보낸다.
         */
        chunkFileNames: 'assets/chunk-[hash].js',
      },
    },
  },
});

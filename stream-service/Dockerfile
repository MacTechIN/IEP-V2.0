# 실시간 전사 게이트웨이 — Cloud Run
#
# 왜 컨테이너인가: Workers 에는 연결을 듣는 소켓이 없어 `ws` 가 돌지 않는다.
# Cloud Run 은 WebSocket 을 그대로 지원하므로 사내 원본 코드가 거의 그대로 돈다.

FROM node:22-slim AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=builder /app/dist ./dist
# Cloud Run 이 PORT 를 주입한다
ENV PORT=8080
EXPOSE 8080
CMD ["node", "dist/index.js"]

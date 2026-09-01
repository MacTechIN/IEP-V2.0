// Worker 가 받는 바인딩·시크릿의 정의 한 곳
//
// JWT_SECRET 은 **사내 Express 백엔드와 반드시 같은 값**이어야 한다.
// C-2~C-5 동안 두 백엔드가 나란히 도는데, 한쪽이 발급한 토큰을 다른 쪽이 받아야 하기 때문이다.
// 값이 어긋나면 경로에 따라 로그인이 풀리는, 재현하기 까다로운 증상이 된다.

export interface Env {
  HYPERDRIVE?: { connectionString: string }
  UPLOADS?: R2Bucket
  DATABASE_URL?: string
  PROBE_SECRET?: string
  JWT_SECRET?: string
  JWT_EXPIRE_IN?: string
  JWT_REFRESH_EXPIRE_IN?: string
  OPENAI_API_KEY?: string
  OPENAI_MODEL?: string
  /** 법률 상담 분석 전용 모델. 요건 분해는 영업 분석보다 어려워 기본이 한 단계 위다 (LEP) */
  OPENAI_LEGAL_MODEL?: string
  OPENAI_STT_MODEL?: string
  OPENAI_STT_DIARIZE_MODEL?: string
  /** 전사 언어. 안 주면 `ko`. **비우면 모델이 스스로 고른다 — 그러면 안 된다** (2026-08-20). */
  OPENAI_STT_LANGUAGE?: string
  ANALYSIS?: Workflow
  /** 녹음 하나를 전사한다. 업로드 요청에서 STT 를 떼어낸 뒤 생겼다 (2026-08-11). */
  TRANSCRIBE?: Workflow
  /** CORS 허용 오리진 (쉼표 구분). 비어 있으면 어떤 브라우저 오리진도 허용하지 않는다 */
  ALLOWED_ORIGINS?: string
}

// 실시간 전사(Deepgram·Google STT)는 여기 없다. Cloud Run 의 stream-service 가 맡는다 —
// Workers 에는 연결을 듣는 소켓이 없어 Durable Object 로 우회해야 했고, gRPC 도 못 해서
// Google 백업이 10초 버퍼 REST 였다. 그 제약이 둘 다 사라졌다.

export interface AuthUser {
  sub: string
  email: string
  role: string
}

/** Hono 컨텍스트에 실어 나르는 값들 */
export type Vars = {
  user: AuthUser
  /** 요청 하나의 로그를 묶는 식별자. requestLogger 가 넣는다. */
  rid: string
}

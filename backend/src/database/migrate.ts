// 마이그레이션 단독 실행기 — `npm run db:migrate` (빌드 후 dist/database/migrate.js)
//
// 왜 따로 있는가
//   예전에는 `initializeDatabase()` 가 서버 기동 중에 마이그레이션을 돌렸다. 세 가지가 문제였다.
//   · 백엔드를 두 개 이상 띄우면 같은 스키마를 동시에 건드린다
//   · 마이그레이션이 실패해도 서버는 그대로 떠서, 어긋난 스키마로 요청을 받는다
//   · Cloudflare Workers 에는 '기동' 이라는 시점도, 파일 시스템도 없다
//
//   배포는 "스키마를 맞춘다 → 앱을 띄운다" 두 단계여야 한다. 이 파일이 첫 단계다.
//   실패하면 **0 이 아닌 코드로 끝난다** — 그래야 배포가 거기서 멈춘다.

import * as dotenv from 'dotenv';
import { initializeDatabase, runMigrations, closeDatabase } from '../utils/database';

dotenv.config();

async function main(): Promise<void> {
  // 어디에 적용하는지 정확히 찍는다. DATABASE_URL 을 쓰는데 DB_NAME 기본값을 보여주면
  // 사내 DB 를 건드리는 줄 알고 안심하거나 그 반대가 된다 — 이전 작업 중에는 치명적이다.
  const { DATABASE_URL, DB_HOST = 'localhost', DB_NAME = 'sep_v2_dev' } = process.env;
  if (DATABASE_URL) {
    // **원문을 찍지 않는다.** 예전 방식은 정규식 치환이라, 값이 예상 형태가 아니면
    // 아무것도 못 지우고 그대로 출력했다 — 실제로 비밀번호가 컨테이너 로그에 남았다.
    // 이제는 파싱해서 host/db 만 꺼내고, 파싱이 안 되면 아예 아무것도 보여주지 않는다.
    let where: string;
    try {
      const u = new URL(DATABASE_URL);
      where = `${u.host}${u.pathname}`;
    } catch {
      where = '(형식이 올바르지 않음)';
    }
    console.log(`Migrating via DATABASE_URL → ${where}`);
  } else {
    console.log(`Migrating ${DB_NAME} at ${DB_HOST}…`);
  }

  await initializeDatabase();
  await runMigrations();
  await closeDatabase();
}

main()
  .then(() => process.exit(0))
  .catch(async (err) => {
    console.error('✘ Migration failed:', err?.message || err);
    // 어느 문장에서 멈췄는지 알아야 고칠 수 있다
    if (err?.code) console.error(`   SQLSTATE: ${err.code}`);
    if (err?.position) console.error(`   position: ${err.position}`);
    await closeDatabase().catch(() => {});
    process.exit(1);
  });

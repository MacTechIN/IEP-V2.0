import { Pool, PoolClient } from 'pg';
import * as fs from 'fs';
import * as path from 'path';

let pool: Pool | null = null;

export async function initializeDatabase(): Promise<Pool> {
  if (pool) {
    return pool;
  }

  const {
    DATABASE_URL,
    DB_HOST = 'localhost',
    DB_PORT = '5432',
    DB_NAME = 'sep_v2_dev',
    DB_USER = 'postgres',
    DB_PASSWORD = 'postgres',
    DB_POOL_MIN = '2',
    DB_POOL_MAX = '20',
  } = process.env;

  // 관리형 Postgres 는 연결 문자열 하나로 주고 **TLS 를 요구한다.**
  // 개별 필드 방식(DB_HOST 등)은 사내 컨테이너용으로 남겨 둔다 — 되돌릴 때 그대로 쓴다.
  // DATABASE_URL 이 있으면 그것이 이긴다.
  const common = {
    min: parseInt(DB_POOL_MIN, 10),
    max: parseInt(DB_POOL_MAX, 10),
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,   // 사내 소켓보다 멀다. 2초는 관리형에서 너무 짧다
  };

  // 값이 연결 문자열이 아니면 **여기서 멈춘다.**
  // 2026-08-08 에 비밀번호만 붙여넣은 적이 있는데, 그때 나온 오류가
  // `getaddrinfo EAI_AGAIN base` 였다 — 무엇이 잘못됐는지 전혀 알 수 없는 메시지다.
  if (DATABASE_URL && !/^postgres(ql)?:\/\//.test(DATABASE_URL)) {
    throw new Error(
      'DATABASE_URL 이 연결 문자열이 아닙니다. postgresql:// 로 시작해야 합니다.\n'
      + '   비밀번호만 붙여넣지 않았는지 확인하세요. 올바른 형태:\n'
      + '   postgresql://<user>:<password>@<host>/<db>?sslmode=verify-full',
    );
  }

  if (DATABASE_URL) {
    // node-postgres 는 sslmode 를 완전히 해석하지 않는다. 명시적으로 켠다.
    // sslmode=disable 을 적었다면 끄고 싶다는 뜻이므로 존중한다(로컬 테스트용).
    const wantsPlain = /[?&]sslmode=disable\b/.test(DATABASE_URL);
    pool = new Pool({
      connectionString: DATABASE_URL,
      ssl: wantsPlain ? false : { rejectUnauthorized: true },
      ...common,
    });
  } else {
    pool = new Pool({
      host: DB_HOST,
      port: parseInt(DB_PORT, 10),
      database: DB_NAME,
      user: DB_USER,
      password: DB_PASSWORD,
      ...common,
    });
  }

  pool.on('error', (err: Error) => {
    console.error('Unexpected error on idle client', err);
  });

  // 마이그레이션은 **여기서 돌지 않는다.** 별도 단계(`npm run db:migrate`)다.
  // 서버가 뜨면서 스키마를 바꾸면 (1) 컨테이너를 여러 개 띄울 때 서로 경쟁하고,
  // (2) 실패해도 서버는 그냥 떠서 어긋난 스키마로 요청을 받고,
  // (3) 서버리스(Workers)에는 '부팅'이라는 시점 자체가 없다.
  return pool;
}

export async function runMigrations(): Promise<void> {
  if (!pool) {
    throw new Error('Database pool not initialized');
  }

  const client = await pool.connect();

  try {
    // Migrations tracking table
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) UNIQUE NOT NULL,
        executed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      )
    `);

    // 배치에 따라 SQL 위치가 다르다 — 컨테이너는 /app/database, 저장소는 루트의 database/.
    // 예전 코드는 못 찾으면 경고만 남기고 넘어갔다. 스키마를 안 맞춘 채 성공으로 끝나는 셈이라
    // 지금은 실패로 본다. 그러려면 찾기부터 제대로 해야 한다.
    const migrationsDir = [
      process.env.MIGRATIONS_DIR,
      path.join(__dirname, '../../database'),      // dist/utils → /app/database (컨테이너)
      path.join(__dirname, '../../../database'),   // backend/dist/utils → 저장소 루트 (로컬)
    ].find((d): d is string => !!d && fs.existsSync(d));

    if (!migrationsDir) {
      throw new Error(
        'Migrations dir not found. Set MIGRATIONS_DIR or place database/*.sql next to the app.',
      );
    }
    console.log(`Migrations dir: ${migrationsDir}`);

    const files = fs
      .readdirSync(migrationsDir)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    for (const file of files) {
      const already = await client.query('SELECT 1 FROM schema_migrations WHERE name = $1', [file]);
      if (already.rows.length > 0) continue;

      console.log(`Running migration: ${file}`);
      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8');
      const statements = sql
        .split(';')
        .map((s) => s.trim())
        .filter((s) => s.length > 0)
        // 파일마다 끝에 맨 COMMIT 이 붙어 있다(BEGIN 도 없이). 예전에는 autocommit 이라 무해했지만
        // 이제 러너가 트랜잭션을 잡으므로, 이걸 그대로 실행하면 **파일 도중에 트랜잭션이 닫힌다.**
        // 트랜잭션 경계는 러너가 정한다 — 파일의 제어 문장은 걷어낸다.
        .filter((s) => {
          const bare = s
            .split('\n')
            .filter((line) => !line.trim().startsWith('--'))
            .join(' ')
            .trim()
            .toUpperCase();
          return !/^(BEGIN|COMMIT|END|ROLLBACK|START\s+TRANSACTION)$/.test(bare);
        });

      // 파일 하나가 통째로 적용되거나 통째로 없던 일이 되게 한다.
      // 예전에는 실패해도 로그만 찍고 넘어간 뒤 **적용됐다고 기록**했다 —
      // 깨진 마이그레이션이 성공으로 남아 다시는 실행되지 않았다.
      await client.query('BEGIN');
      try {
        for (const statement of statements) {
          // 001 은 Postgres initdb 마운트가 이미 적용했을 수 있다(compose 참고).
          // 그래서 "이미 있음" 만 넘어가고 나머지는 전부 실패로 본다.
          // SAVEPOINT 가 없으면 한 번의 오류로 트랜잭션 전체가 중단돼 넘어갈 수가 없다.
          await client.query('SAVEPOINT stmt');
          try {
            await client.query(statement);
            await client.query('RELEASE SAVEPOINT stmt');
          } catch (err: any) {
            // 42P07 테이블/인덱스, 42710 객체, 42701 컬럼 — 전부 "이미 존재한다"
            if (['42P07', '42710', '42701'].includes(err?.code)) {
              await client.query('ROLLBACK TO SAVEPOINT stmt');
              continue;
            }
            throw err;
          }
        }
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      }
      console.log(`✓ Migration applied: ${file}`);
    }

    console.log('✓ Migrations up to date');
  } finally {
    client.release();
  }
}

export async function getPool(): Promise<Pool> {
  if (!pool) {
    return await initializeDatabase();
  }
  return pool;
}

export async function query<T = any>(
  text: string,
  values?: any[]
): Promise<{ rows: T[]; rowCount: number }> {
  const pool = await getPool();
  const result = await pool.query(text, values);
  return {
    rows: result.rows as T[],
    rowCount: result.rowCount || 0,
  };
}

export async function queryOne<T = any>(
  text: string,
  values?: any[]
): Promise<T | null> {
  const result = await query<T>(text, values);
  return result.rows[0] || null;
}

export async function closeDatabase(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

export async function withTransaction<T>(
  callback: (client: PoolClient) => Promise<T>
): Promise<T> {
  const pool = await getPool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

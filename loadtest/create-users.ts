// Creates the stampede users through the REAL signup and login (D-25), in small
// batches (D-12), and saves their tokens to loadtest/tokens.json (D-29).
// Safe to run again: a user that already exists (409 email_taken) is only logged in.
//
// Run from the repo root:  npm run loadtest:users
// Optional settings (environment variables): USER_COUNT, BATCH_SIZE, BASE_URL
import { writeFileSync } from 'node:fs';

const BASE_URL = process.env.BASE_URL ?? 'http://127.0.0.1:3000';
const USER_COUNT = Number(process.env.USER_COUNT ?? 5000);
const BATCH_SIZE = Number(process.env.BATCH_SIZE ?? 10);
const PASSWORD = 'Passw0rd!123';
const OUT_FILE = 'loadtest/tokens.json';

type Reply = {
  token?: string;
  expiresInSeconds?: number;
  error?: { code: string };
};

type Ready = { token: string; expiresInSeconds: number };

function emailFor(n: number): string {
  return `stampede-${n}@example.com`;
}

async function postJson(
  path: string,
  body: unknown,
): Promise<{ status: number; json: Reply }> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as Reply;
  return { status: res.status, json };
}

async function createOne(n: number): Promise<Ready> {
  const creds = { email: emailFor(n), password: PASSWORD };

  const signup = await postJson('/api/auth/signup', creds);
  const alreadyExists =
    signup.status === 409 && signup.json.error?.code === 'email_taken';
  if (signup.status !== 201 && !alreadyExists) {
    throw new Error(`signup failed for user ${n}: HTTP ${signup.status}`);
  }

  const login = await postJson('/api/auth/login', creds);
  if (
    login.status !== 200 ||
    !login.json.token ||
    login.json.expiresInSeconds === undefined
  ) {
    throw new Error(`login failed for user ${n}: HTTP ${login.status}`);
  }
  return {
    token: login.json.token,
    expiresInSeconds: login.json.expiresInSeconds,
  };
}

async function main(): Promise<void> {
  const ready: Ready[] = [];
  const started = Date.now();
  let nextReport = 500;

  for (let first = 1; first <= USER_COUNT; first += BATCH_SIZE) {
    const last = Math.min(first + BATCH_SIZE - 1, USER_COUNT);
    const batch: Promise<Ready>[] = [];
    for (let n = first; n <= last; n++) batch.push(createOne(n));
    ready.push(...(await Promise.all(batch)));

    if (ready.length >= nextReport) {
      const secs = Math.round((Date.now() - started) / 1000);
      console.log(
        `${ready.length}/${USER_COUNT} users ready, ${secs} s elapsed`,
      );
      nextReport += 500;
    }
  }

  writeFileSync(OUT_FILE, JSON.stringify(ready.map((r) => r.token)));
  const secs = Math.round((Date.now() - started) / 1000);
  console.log(
    `done: ${ready.length} tokens saved to ${OUT_FILE} in ${secs} s, ` +
      `token life ${ready[0]?.expiresInSeconds} s`,
  );
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});

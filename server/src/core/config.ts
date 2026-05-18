import { randomBytes } from 'node:crypto';
import { appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { config as dotenvConfig } from 'dotenv';

const ENV_PATH = resolve(import.meta.dirname, '../../../.env');

dotenvConfig({ path: ENV_PATH });
ensureMasterKey();

function ensureMasterKey(): void {
  const existing = process.env.MASTER_KEY;
  if (existing) {
    const buf = Buffer.from(existing, 'base64');
    if (buf.length !== 32) {
      throw new Error(
        `MASTER_KEY must decode to 32 bytes; got ${buf.length}. ` +
          `Generate one with: node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`,
      );
    }
    return;
  }
  const key = randomBytes(32).toString('base64');
  try {
    appendFileSync(
      ENV_PATH,
      `\n# Auto-generated on first boot — back this up; tokens encrypted with this key cannot be recovered without it.\nMASTER_KEY=${key}\n`,
    );
  } catch (err) {
    throw new Error(
      `MASTER_KEY is not set and cannot be auto-generated (failed to write ${ENV_PATH}): ` +
        `${err instanceof Error ? err.message : String(err)}. ` +
        `Set MASTER_KEY explicitly via the environment.`,
    );
  }
  process.env.MASTER_KEY = key;
  console.error(
    `[bootstrap] MASTER_KEY was not set — generated a new one and appended to ${ENV_PATH}.`,
  );
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

export const config = {
  databaseUrl: required('DATABASE_URL'),
  port: Number(process.env.PORT ?? 3001),
  dataDir: process.env.DATA_DIR ?? './data',
};

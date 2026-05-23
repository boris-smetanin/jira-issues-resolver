import { promises as fsp } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanupOldLogs } from './cleanup.js';

// Slice 14: cleanupOldLogs is the pure unit of the retention sweeper.
// We exercise it against a real tmp dir with files whose mtimes we
// rewind via utimes — that's exactly how the timer reads "age" in
// production (file mtime), so this is a behaviourally faithful test.

const DAY_MS = 24 * 60 * 60 * 1000;

async function touch(path: string, ageDays: number): Promise<void> {
  await fsp.writeFile(path, 'x');
  const when = new Date(Date.now() - ageDays * DAY_MS);
  await fsp.utimes(path, when, when);
}

describe('cleanupOldLogs', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await fsp.mkdtemp(join(tmpdir(), 'jir-cleanup-'));
  });

  afterEach(async () => {
    await fsp.rm(dir, { recursive: true, force: true });
  });

  it('removes only files older than retentionDays', async () => {
    await touch(join(dir, 'old.ndjson'), 40);
    await touch(join(dir, 'fresh.ndjson'), 5);
    await touch(join(dir, 'borderline.ndjson'), 29);

    const result = await cleanupOldLogs(dir, 30);

    expect(result.scanned).toBe(3);
    expect(result.removed.sort()).toEqual(['old.ndjson']);
    const remaining = (await fsp.readdir(dir)).sort();
    expect(remaining).toEqual(['borderline.ndjson', 'fresh.ndjson']);
  });

  it('ignores non-.ndjson siblings (does not delete index.json, .gz archives, etc.)', async () => {
    await touch(join(dir, 'old.ndjson'), 100);
    await touch(join(dir, 'index.json'), 100);
    await touch(join(dir, 'old.ndjson.gz'), 100);

    const result = await cleanupOldLogs(dir, 30);

    expect(result.removed).toEqual(['old.ndjson']);
    const remaining = (await fsp.readdir(dir)).sort();
    expect(remaining).toEqual(['index.json', 'old.ndjson.gz']);
  });

  it('no-ops cleanly on a missing logsDir (fresh install, dir not yet created)', async () => {
    const missing = join(dir, 'does-not-exist');
    const result = await cleanupOldLogs(missing, 30);
    expect(result).toEqual({ scanned: 0, removed: [] });
  });

  it('returns empty result on an empty logsDir', async () => {
    const result = await cleanupOldLogs(dir, 30);
    expect(result).toEqual({ scanned: 0, removed: [] });
  });

  it('respects the cutoff edge: file mtime exactly == cutoff is kept', async () => {
    // utimes resolution is seconds on some platforms; nudge by 1ms so
    // we're definitively on one side of the cutoff. A file just under
    // 30 days old must survive a 30-day retention.
    await touch(join(dir, 'just-under.ndjson'), 29.999);
    await touch(join(dir, 'just-over.ndjson'), 30.001);

    const result = await cleanupOldLogs(dir, 30);

    expect(result.removed).toEqual(['just-over.ndjson']);
  });

  it('retentionDays=1 removes anything older than 24h', async () => {
    await touch(join(dir, 'hours-ago.ndjson'), 0.5);
    await touch(join(dir, 'two-days.ndjson'), 2);

    const result = await cleanupOldLogs(dir, 1);

    expect(result.removed).toEqual(['two-days.ndjson']);
  });
});

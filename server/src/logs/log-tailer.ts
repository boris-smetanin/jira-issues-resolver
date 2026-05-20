import fs from 'node:fs';

export type Tailer = {
  start: () => Promise<void>;
  stop: () => void;
};

export type TailerOptions = {
  filePath: string;
  pollIntervalMs?: number;
  onLine: (parsed: unknown) => void | Promise<void>;
  signal?: AbortSignal;
};

/**
 * Polls a log file from a saved byte offset, emits each newline-delimited
 * JSON line as it appears. Partial trailing lines are buffered for the
 * next read. Safe across multiple writers since we always seek from the
 * last known offset to current EOF.
 *
 * Lifted from the auto-bug-fixer reference (`server/src/logs/log-tailer.ts`).
 */
export function createTailer(opts: TailerOptions): Tailer {
  const pollMs = opts.pollIntervalMs ?? 250;
  let position = 0;
  let buffer = '';
  let stopped = false;
  let timer: NodeJS.Timeout | undefined;

  const readNew = async (): Promise<void> => {
    let stat: fs.Stats;
    try {
      stat = await fs.promises.stat(opts.filePath);
    } catch {
      return; // file doesn't exist yet
    }
    if (stat.size <= position) return;

    const need = stat.size - position;
    const fh = await fs.promises.open(opts.filePath, 'r');
    try {
      const chunk = Buffer.alloc(need);
      const { bytesRead } = await fh.read(chunk, 0, need, position);
      position += bytesRead;
      buffer += chunk.subarray(0, bytesRead).toString('utf-8');
    } finally {
      await fh.close();
    }

    while (true) {
      const nl = buffer.indexOf('\n');
      if (nl === -1) break;
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line) continue;
      try {
        const parsed = JSON.parse(line);
        await opts.onLine(parsed);
      } catch {
        // skip malformed lines silently
      }
    }
  };

  const scheduleNext = (): void => {
    if (stopped) return;
    timer = setTimeout(() => {
      void readNew().finally(scheduleNext);
    }, pollMs);
  };

  const stop = (): void => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };

  opts.signal?.addEventListener('abort', stop, { once: true });

  return {
    start: async () => {
      await readNew();
      scheduleNext();
    },
    stop,
  };
}

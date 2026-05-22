import fs from 'node:fs';
import path from 'node:path';
import { logger } from '../core/logger.js';

// Tag identifying which subsystem emitted a log line. Used by the UI's
// Pretty renderer to color-code lines.
export type LogSrc =
  | 'orchestrator'
  | 'git'
  | 'github'
  | 'jira'
  | 'sandcastle'
  | 'install' // Slice 16b: orchestrator-driven dep-install output
  | 'logs';

export type LogLevel = 'info' | 'warn' | 'error';

export type AttemptLogEvent = {
  ts: string;
  src: LogSrc;
  level: LogLevel;
  msg: string;
  data?: Record<string, unknown>;
};

export type AttemptLogger = {
  log: (level: LogLevel, src: LogSrc, msg: string, data?: Record<string, unknown>) => void;
  close: () => void;
};

// Opens an append-mode write stream at logFilePath and returns a logger.
// Each `log(...)` call appends ONE valid JSON line. Also forwards to the
// app-level logger so server stdout still sees what's happening (matches
// the auto-bug-fixer pattern).
export function createAttemptLog(args: {
  spaceId: string;
  attemptId: string;
  logFilePath: string;
}): AttemptLogger {
  fs.mkdirSync(path.dirname(args.logFilePath), { recursive: true });
  const stream = fs.createWriteStream(args.logFilePath, { flags: 'a' });
  stream.on('error', (err) => {
    process.stderr.write(`attempt log stream error: ${err.message}\n`);
  });

  return {
    log: (level, src, msg, data) => {
      const event: AttemptLogEvent = {
        ts: new Date().toISOString(),
        src,
        level,
        msg,
        ...(data ? { data } : {}),
      };
      stream.write(`${JSON.stringify(event)}\n`);
      // Surface to the app log too, with attempt/space ids so stdout is
      // still searchable across all in-flight attempts.
      const top = { spaceId: args.spaceId, attemptId: args.attemptId, src, ...(data ?? {}) };
      if (level === 'error') logger.error(msg, top);
      else if (level === 'warn') logger.warn(msg, top);
      else logger.info(msg, top);
    },
    close: () => stream.end(),
  };
}

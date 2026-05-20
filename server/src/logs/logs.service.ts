import { promises as fsp } from 'node:fs';
import type { SSEStreamingApi } from 'hono/streaming';
import {
  findAttemptById,
  findRunningForSpace,
} from '../resolve-attempts/resolve-attempts.service.js';
import { createTailer, type Tailer } from './log-tailer.js';

/**
 * Drive the SSE stream for a Space's live attempt logs. Pumps
 * `attempt_start` / `line` / `attempt_end` / `idle` events as the
 * Space's currently-running Resolve Attempt transitions.
 *
 * Keeps an internal tailer pinned to whichever attempt is non-terminal
 * for the Space; switches tailers when a new attempt becomes active;
 * emits `idle` during quiet periods.
 *
 * Lifted shape from the auto-bug-fixer reference's `streamFixAttemptLogs`.
 */
export async function streamLogs(spaceId: string, stream: SSEStreamingApi): Promise<void> {
  let currentAttemptId: string | undefined;
  let tailer: Tailer | undefined;

  stream.onAbort(() => {
    tailer?.stop();
    tailer = undefined;
  });

  const startTailing = async (attempt: {
    id: string;
    issueKey: string;
    branchName: string | null;
    logFilePath: string | null;
  }): Promise<void> => {
    if (!attempt.logFilePath) return; // attempt started before the orchestrator wrote the path
    currentAttemptId = attempt.id;
    await stream.writeSSE({
      event: 'attempt_start',
      data: JSON.stringify({
        attemptId: attempt.id,
        issueKey: attempt.issueKey,
        branchName: attempt.branchName,
      }),
    });
    tailer = createTailer({
      filePath: attempt.logFilePath,
      onLine: async (parsed) => {
        if (stream.aborted || stream.closed) return;
        try {
          await stream.writeSSE({ event: 'line', data: JSON.stringify(parsed) });
        } catch {
          // stream closed mid-write — ignore
        }
      },
    });
    await tailer.start();
  };

  const stopTailing = async (finalStatus: string | undefined): Promise<void> => {
    tailer?.stop();
    tailer = undefined;
    const endedId = currentAttemptId;
    currentAttemptId = undefined;
    if (endedId) {
      await stream.writeSSE({
        event: 'attempt_end',
        data: JSON.stringify({ attemptId: endedId, finalStatus }),
      });
    }
    await stream.writeSSE({ event: 'idle', data: '{}' });
  };

  // Initial state: if a non-terminal attempt exists, start tailing it.
  // Otherwise mark idle so the client knows the stream is alive.
  const initial = await findRunningForSpace(spaceId);
  if (initial) {
    await startTailing(initial);
  } else {
    await stream.writeSSE({ event: 'idle', data: '{}' });
  }

  while (!stream.aborted && !stream.closed) {
    await stream.sleep(1000);
    if (stream.aborted || stream.closed) break;

    const running = await findRunningForSpace(spaceId);

    if (running && running.id !== currentAttemptId) {
      // The active attempt changed. Close out the old one, switch.
      if (currentAttemptId) {
        const ended = await findAttemptById(currentAttemptId);
        await stopTailing(ended?.status);
      }
      await startTailing(running);
    } else if (!running && currentAttemptId) {
      const ended = await findAttemptById(currentAttemptId);
      await stopTailing(ended?.status);
    }
  }

  tailer?.stop();
}

/**
 * Read the historical NDJSON file for a finished Resolve Attempt. Returns
 * the file contents as a string, or `undefined` if the attempt doesn't
 * belong to the Space. An empty string is returned for an attempt whose
 * log file doesn't exist (e.g. very early attempts before slice 7 wired
 * the logger, or a swept-away file once slice 14 retention lands).
 */
export async function readHistoricalAttemptLog(
  spaceId: string,
  attemptId: string,
): Promise<string | undefined> {
  const attempt = await findAttemptById(attemptId);
  if (!attempt || attempt.spaceId !== spaceId) return undefined;
  if (!attempt.logFilePath) return '';
  try {
    return await fsp.readFile(attempt.logFilePath, 'utf-8');
  } catch {
    return '';
  }
}

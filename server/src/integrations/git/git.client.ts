import { execFile } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export type LsRemoteResult = { ok: true } | { ok: false; error: string };

// `git ls-remote --exit-code <url> HEAD` with the token supplied via
// GIT_ASKPASS — never via argv (would show in `ps aux`) and never via the URL
// (would land in the reflog). GitHub accepts the token as either the username
// or the password on HTTPS; the askpass script returns `x-access-token` when
// git prompts for a username and the token otherwise.
export async function lsRemote(repoUrl: string, token: string): Promise<LsRemoteResult> {
  const tmpDir = mkdtempSync(join(tmpdir(), 'git-askpass-'));
  const askpassPath = join(tmpDir, 'askpass.sh');
  writeFileSync(
    askpassPath,
    '#!/bin/sh\ncase "$1" in\n  *sername*) echo "x-access-token" ;;\n  *) echo "$GITHUB_TOKEN" ;;\nesac\n',
    { mode: 0o700 },
  );

  try {
    await execFileAsync('git', ['ls-remote', '--exit-code', repoUrl, 'HEAD'], {
      env: {
        ...process.env,
        GITHUB_TOKEN: token,
        GIT_ASKPASS: askpassPath,
        GIT_TERMINAL_PROMPT: '0',
      },
      timeout: 15_000,
    });
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message.split('\n').slice(0, 3).join(' ').slice(0, 300) };
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

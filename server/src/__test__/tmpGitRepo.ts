import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execFileP = promisify(execFile);

// Test helper: creates a tmp dir with a bare remote + a working seed
// clone that has one initial commit on the configured base branch. The
// orchestrator's git client can clone from `remoteUrl` end-to-end —
// it's a plain local path, so git treats it as a local clone (no
// network, no auth).
//
// Lifecycle: callers MUST call `cleanup()` in afterEach (or finally) —
// nothing else removes the tmp dir.
export type TmpGitRepo = {
  // Path the orchestrator clones from. Local path (not file://) so the
  // orchestrator's cloneRepo works without GIT_ASKPASS prompting.
  remoteUrl: string;
  // Same path; useful for assertions / sibling-bare-repo manipulation.
  remoteDir: string;
  // A separate working clone used to push branches into the remote.
  // Tests modify this clone to set up scenarios (e.g. push origin/RND-1).
  seedDir: string;
  // The base branch the remote was initialized with. Defaults to 'main'.
  baseBranch: string;
  // Push a fresh branch with one commit to the remote. Returns the
  // commit sha. Branch is created off origin/<base>.
  pushBranch: (branch: string, opts?: { message?: string; file?: string; content?: string }) => Promise<string>;
  // Run any git command against the seed working clone. Returns stdout.
  seedGit: (...args: string[]) => Promise<string>;
  // Idempotent cleanup. Safe to call multiple times.
  cleanup: () => Promise<void>;
};

export async function tmpGitRepo(opts?: { baseBranch?: string }): Promise<TmpGitRepo> {
  const baseBranch = opts?.baseBranch ?? 'main';
  const root = await mkdtemp(join(tmpdir(), 'jir-test-'));
  const remoteDir = join(root, 'remote.git');
  const seedDir = join(root, 'seed');

  // 1. Bare remote with the configured initial branch.
  await execFileP('git', ['init', '--bare', `--initial-branch=${baseBranch}`, remoteDir]);

  // 2. Working clone for seeding. We set user.email/name on this clone
  //    so commits succeed without depending on a global git config.
  await execFileP('git', ['clone', remoteDir, seedDir]);
  await execFileP('git', ['-C', seedDir, 'config', 'user.email', 'test@example.com']);
  await execFileP('git', ['-C', seedDir, 'config', 'user.name', 'Test User']);

  // 3. Seed first commit + push it so the remote has refs/heads/<base>.
  await writeFile(join(seedDir, 'README.md'), '# seed\n');
  await execFileP('git', ['-C', seedDir, 'add', 'README.md']);
  await execFileP('git', ['-C', seedDir, 'commit', '-m', 'seed']);
  await execFileP('git', ['-C', seedDir, 'push', 'origin', baseBranch]);

  async function pushBranch(
    branch: string,
    pbOpts?: { message?: string; file?: string; content?: string },
  ): Promise<string> {
    const message = pbOpts?.message ?? `work on ${branch}`;
    const file = pbOpts?.file ?? `${branch}.txt`;
    const content = pbOpts?.content ?? `hi from ${branch}\n`;
    await execFileP('git', ['-C', seedDir, 'fetch', 'origin']);
    await execFileP('git', ['-C', seedDir, 'checkout', '-B', branch, `origin/${baseBranch}`]);
    await writeFile(join(seedDir, file), content);
    await execFileP('git', ['-C', seedDir, 'add', file]);
    await execFileP('git', ['-C', seedDir, 'commit', '-m', message]);
    const { stdout } = await execFileP('git', ['-C', seedDir, 'rev-parse', 'HEAD']);
    await execFileP('git', ['-C', seedDir, 'push', 'origin', `${branch}:${branch}`]);
    // Leave the seed clone on baseBranch so subsequent pushBranch calls
    // are independent.
    await execFileP('git', ['-C', seedDir, 'checkout', baseBranch]);
    return stdout.trim();
  }

  async function seedGit(...args: string[]): Promise<string> {
    const { stdout } = await execFileP('git', ['-C', seedDir, ...args]);
    return stdout;
  }

  let cleaned = false;
  return {
    remoteUrl: remoteDir,
    remoteDir,
    seedDir,
    baseBranch,
    pushBranch,
    seedGit,
    cleanup: async () => {
      if (cleaned) return;
      cleaned = true;
      await rm(root, { recursive: true, force: true });
    },
  };
}

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Test helper: load a JSON fixture by name. Pass the calling test file's
// `import.meta.url` so the helper can resolve the conventional
// `__fixtures__/` sibling dir without callers having to compute paths
// themselves.
export function loadFixture<T = unknown>(testFileUrl: string, name: string): T {
  const fixturesDir = join(dirname(fileURLToPath(testFileUrl)), '__fixtures__');
  const file = name.endsWith('.json') ? name : `${name}.json`;
  return JSON.parse(readFileSync(join(fixturesDir, file), 'utf8')) as T;
}

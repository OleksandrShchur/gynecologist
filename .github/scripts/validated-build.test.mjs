import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { artifactName, findValidatedBuild, normalizeBasePath } from './validated-build.mjs';

const repository = 'owner/site';
const sha = 'a'.repeat(40);
const basePath = '/gynecologist/';
const now = '2026-10-22T12:00:00Z';
const run = (changes = {}) => ({
  id: 42, path: '.github/workflows/test.yml', head_sha: sha,
  head_repository: { full_name: repository }, status: 'completed', conclusion: 'success',
  event: 'push', run_attempt: 1, html_url: 'https://github.com/owner/site/actions/runs/42', ...changes,
});
const artifact = (changes = {}) => ({
  id: 321, name: artifactName(sha, basePath, 1), expired: false,
  expires_at: '2026-10-23T12:00:00Z', ...changes,
});

function lookup({ runs = [run()], artifacts = [artifact()], request } = {}) {
  const calls = [];
  const fakeRequest = async (path) => {
    calls.push(path);
    if (request) return request(path);
    return path.includes('/workflows/') ? { workflow_runs: runs } : { artifacts };
  };
  return { calls, result: findValidatedBuild({ request: fakeRequest, repository, sha, basePath, now }) };
}

test('base paths normalize consistently and reject output injection or invalid URL paths', () => {
  for (const value of ['gynecologist', '/gynecologist', ' /gynecologist/ ', '//gynecologist//']) {
    assert.equal(normalizeBasePath(value), basePath);
  }
  assert.equal(normalizeBasePath(), '/');
  assert.equal(normalizeBasePath(''), '/');
  for (const value of ['/x\nsource-run-id=42', '/x\r', '/x?query', '/x#hash', '\\x', '/a/../b', 'https://site.test/']) {
    assert.throws(() => normalizeBasePath(value));
  }
});

test('artifact identities bind the full SHA, normalized path and run attempt', () => {
  const name = artifactName(sha, basePath, 1);
  assert.match(name, /^validated-dist-v1-a{40}-[a-f0-9]{64}-1$/);
  assert.equal(name, artifactName(sha.toUpperCase(), 'gynecologist', '1'));
  assert.notEqual(name, artifactName('b'.repeat(40), basePath, 1));
  assert.notEqual(name, artifactName(sha, '/', 1));
  assert.notEqual(name, artifactName(sha, basePath, 2));
  assert.throws(() => artifactName('short', basePath, 1));
  for (const attempt of [0, -1, '1\n', '1.2', Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => artifactName(sha, basePath, attempt));
  }
});

test('reuses an unexpired artifact from successful complete CI of the exact commit', async () => {
  const { calls, result } = lookup();
  assert.deepEqual(await result, {
    runId: 42, artifactId: 321, artifactName: artifactName(sha, basePath, 1),
    runUrl: 'https://github.com/owner/site/actions/runs/42',
  });
  assert.equal(calls[0], `/repos/${repository}/actions/workflows/test.yml/runs?head_sha=${sha}&status=success&per_page=100&page=1`);
  assert.equal(calls[1], `/repos/${repository}/actions/runs/42/artifacts?per_page=100&page=1`);
});

test('accepts dispatch runs and case-insensitive repository identity', async () => {
  const { result } = lookup({ runs: [run({ event: 'workflow_dispatch', head_repository: { full_name: 'OWNER/SITE' } })] });
  assert.equal((await result).runId, 42);
});

for (const [reason, changes] of [
  ['another commit', { head_sha: 'b'.repeat(40) }],
  ['a fork', { head_repository: { full_name: 'someone/site' } }],
  ['missing repository identity', { head_repository: null }],
  ['pull requests', { event: 'pull_request' }],
  ['pull request targets', { event: 'pull_request_target' }],
  ['an incomplete matrix', { status: 'in_progress', conclusion: 'success' }],
  ['failed CI', { conclusion: 'failure' }],
  ['cancelled CI', { conclusion: 'cancelled' }],
  ['another workflow', { path: '.github/workflows/deploy-pages.yml' }],
  ['invalid attempts', { run_attempt: 0 }],
]) {
  test(`does not trust ${reason}`, async () => {
    const { calls, result } = lookup({ runs: [run(changes)] });
    assert.equal(await result, null);
    assert.equal(calls.length, 1, 'untrusted runs must not have their artifacts queried');
  });
}

for (const [reason, artifacts] of [
  ['missing artifacts', []],
  ['another base path', [artifact({ name: artifactName(sha, '/', 1) })]],
  ['another SHA', [artifact({ name: artifactName('b'.repeat(40), basePath, 1) })]],
  ['expired artifacts', [artifact({ expired: true })]],
  ['past expiration time', [artifact({ expires_at: '2026-10-21T12:00:00Z' })]],
  ['expiration at the current instant', [artifact({ expires_at: now })]],
  ['missing expiration metadata', [artifact({ expires_at: undefined })]],
  ['missing expiration flag', [artifact({ expired: undefined })]],
  ['another run attempt', [artifact({ name: artifactName(sha, basePath, 2) })]],
]) {
  test(`requires fresh validation for ${reason}`, async () => {
    assert.equal(await lookup({ artifacts }).result, null);
  });
}

test('a rerun only reuses an artifact uploaded by its current attempt', async () => {
  const rerun = run({ run_attempt: 2 });
  assert.equal(await lookup({ runs: [rerun] }).result, null);
  const { result } = lookup({ runs: [rerun], artifacts: [artifact({ name: artifactName(sha, basePath, 2) })] });
  assert.equal((await result).artifactName, artifactName(sha, basePath, 2));
});

test('paginates both workflow runs and artifacts', async () => {
  const rejected = Array.from({ length: 100 }, (_, index) => run({ id: index + 100, conclusion: 'failure' }));
  const unrelated = Array.from({ length: 100 }, (_, index) => artifact({ id: index + 1000, name: `other-${index}` }));
  const { calls, result } = lookup({ request: async (path) => {
    const page = new URL(`https://api.github.com${path}`).searchParams.get('page');
    if (path.includes('/workflows/')) return { workflow_runs: page === '1' ? rejected : [run()] };
    return { artifacts: page === '1' ? unrelated : [artifact()] };
  } });
  assert.equal((await result).artifactId, 321);
  assert.equal(calls.length, 4);
  assert.match(calls[1], /runs\?.*page=2$/);
  assert.match(calls[3], /artifacts\?.*page=2$/);
});

test('never searches beyond GitHub’s 1,000 matching run limit', async () => {
  const { calls, result } = lookup({ runs: Array.from({ length: 100 }, () => run({ event: 'pull_request' })) });
  assert.equal(await result, null);
  assert.equal(calls.length, 10);
});

test('can use an older successful run when the newest has no artifact', async () => {
  const { result } = lookup({ request: async (path) => {
    if (path.includes('/workflows/')) return { workflow_runs: [run({ id: 43 }), run()] };
    return { artifacts: path.includes('/43/') ? [] : [artifact()] };
  } });
  assert.equal((await result).runId, 42);
});

test('deleted artifacts, API failures and malformed responses safely fall back to fresh validation', async () => {
  for (const failingRequest of [
    async () => { throw new Error('token-secret must never be reported'); },
    async (path) => {
      if (path.includes('/workflows/')) return { workflow_runs: [run()] };
      throw new Error('404 deleted run or artifact');
    },
    async () => ({}),
    async () => null,
  ]) {
    assert.equal(await lookup({ request: failingRequest }).result, null);
  }
});

test('CLI writes normalized metadata and clean fallback outputs without exposing tokens', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'validated-build-'));
  try {
    const outputPath = join(directory, 'outputs');
    const summaryPath = join(directory, 'summary');
    const env = { ...process.env, GITHUB_SHA: sha, GITHUB_RUN_ATTEMPT: '2', VITE_BASE_PATH: 'gynecologist',
      GITHUB_OUTPUT: outputPath, GITHUB_STEP_SUMMARY: summaryPath, GITHUB_REPOSITORY: repository, GITHUB_TOKEN: '' };
    const cliPath = fileURLToPath(new URL('./validated-build.mjs', import.meta.url));
    const command = spawnSync(process.execPath, [cliPath, 'find'], { env, encoding: 'utf8' });
    assert.equal(command.status, 0, command.stderr);
    assert.equal(await readFile(outputPath, 'utf8'), `artifact-name=${artifactName(sha, basePath, 2)}\nbase-path=${basePath}\nsource-run-id=\nsource-artifact-id=\n`);
    assert.match(await readFile(summaryPath, 'utf8'), /build and test a fresh artifact/);
    assert.match(command.stdout, /fresh validation/);
    assert.equal(command.stderr, '');

    const invalid = spawnSync(process.execPath, [cliPath, 'name'], {
      env: { ...env, VITE_BASE_PATH: '/bad\nsource-run-id=42', GITHUB_TOKEN: 'token-secret' }, encoding: 'utf8',
    });
    assert.equal(invalid.status, 1);
    assert.doesNotMatch(invalid.stdout + invalid.stderr, /token-secret|source-run-id=42/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

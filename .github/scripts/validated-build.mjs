import { createHash } from 'node:crypto';
import { appendFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const WORKFLOW = '.github/workflows/test.yml';
const PAGE_SIZE = 100;

export function normalizeBasePath(value = '/') {
  if (typeof value !== 'string' || /[\x00-\x1f\x7f]/.test(value)) {
    throw new Error('Base path must be a single line path.');
  }
  const path = value.trim().replace(/\/{2,}/g, '/') || '/';
  if (/[\s?#\\]/.test(path) || /(^|\/)\.{1,2}(\/|$)/.test(path) || /^[a-z]+:/i.test(path)) {
    throw new Error('Base path must be a URL path without query, fragment, or dot segments.');
  }
  return `/${path.replace(/^\/+|\/+$/g, '')}/`.replace('//', '/');
}

function normalizeSha(sha) {
  if (typeof sha !== 'string' || !/^[a-f0-9]{40}$/i.test(sha)) {
    throw new Error('A full commit SHA is required.');
  }
  return sha.toLowerCase();
}

function positiveInteger(value) {
  return /^[1-9]\d*$/.test(String(value)) && Number.isSafeInteger(Number(value));
}

export function artifactName(sha, basePath, runAttempt) {
  if (!positiveInteger(runAttempt)) throw new Error('A positive run attempt is required.');
  const digest = createHash('sha256').update(normalizeBasePath(basePath)).digest('hex');
  return `validated-dist-v1-${normalizeSha(sha)}-${digest}-${Number(runAttempt)}`;
}

function trustedRun(run, repository, sha) {
  return positiveInteger(run.id)
    && run.path === WORKFLOW
    && run.head_sha?.toLowerCase() === sha
    && run.head_repository?.full_name?.toLowerCase() === repository.toLowerCase()
    && run.status === 'completed'
    && run.conclusion === 'success'
    && ['push', 'workflow_dispatch'].includes(run.event)
    && positiveInteger(run.run_attempt);
}

export async function findValidatedBuild({ request, repository, sha, basePath, now = new Date() }) {
  try {
    if (!/^[a-z0-9_.-]+\/[a-z0-9_.-]+$/i.test(repository)) return null;
    const commit = normalizeSha(sha);
    const base = normalizeBasePath(basePath);
    const currentTime = new Date(now).getTime();
    if (!Number.isFinite(currentTime)) return null;

    // GitHub's workflow-run search exposes at most 1,000 matching results.
    for (let page = 1; page <= 10; page++) {
      const query = new URLSearchParams({ head_sha: commit, status: 'success', per_page: String(PAGE_SIZE), page: String(page) });
      const result = await request(`/repos/${repository}/actions/workflows/test.yml/runs?${query}`);
      if (!Array.isArray(result.workflow_runs)) return null;
      for (const run of result.workflow_runs) {
        if (!trustedRun(run, repository, commit)) continue;
        const name = artifactName(commit, base, run.run_attempt);
        for (let artifactPage = 1; ; artifactPage++) {
          const artifacts = await request(`/repos/${repository}/actions/runs/${run.id}/artifacts?per_page=${PAGE_SIZE}&page=${artifactPage}`);
          if (!Array.isArray(artifacts.artifacts)) return null;
          const artifact = artifacts.artifacts.find((candidate) => candidate.name === name
            && positiveInteger(candidate.id)
            && candidate.expired === false
            && Date.parse(candidate.expires_at) > currentTime);
          if (artifact) {
            const fallbackUrl = `https://github.com/${repository}/actions/runs/${run.id}`;
            const runUrl = /^https:\/\/[a-z0-9.:-]+\/[a-z0-9_.%/-]+$/i.test(run.html_url ?? '') ? run.html_url : fallbackUrl;
            return { runId: run.id, artifactId: artifact.id, artifactName: name, runUrl };
          }
          if (artifacts.artifacts.length < PAGE_SIZE) break;
        }
      }
      if (result.workflow_runs.length < PAGE_SIZE) break;
    }
  } catch {
    // A lookup is an optimization: an unavailable API or deleted artifact means fresh validation.
  }
  return null;
}

function githubRequest(env) {
  const apiUrl = (env.GITHUB_API_URL || 'https://api.github.com').replace(/\/+$/, '');
  return async (path) => {
    if (!env.GITHUB_TOKEN) throw new Error('GitHub token unavailable.');
    const response = await fetch(`${apiUrl}${path}`, {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${env.GITHUB_TOKEN}`,
        'X-GitHub-Api-Version': '2022-11-28',
      },
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error('GitHub API lookup unavailable.');
    return response.json();
  };
}

async function main(command, env) {
  if (!['name', 'find'].includes(command)) throw new Error('Expected name or find.');
  const basePath = normalizeBasePath(env.VITE_BASE_PATH);
  const name = artifactName(env.GITHUB_SHA, basePath, env.GITHUB_RUN_ATTEMPT || '1');
  const outputs = { 'artifact-name': name, 'base-path': basePath };
  if (command === 'find') {
    const found = await findValidatedBuild({
      request: githubRequest(env), repository: env.GITHUB_REPOSITORY, sha: env.GITHUB_SHA, basePath,
    });
    outputs['source-run-id'] = found?.runId ?? '';
    outputs['source-artifact-id'] = found?.artifactId ?? '';
    const summary = found
      ? `A matching build passed the complete CI workflow in [run ${found.runId}](${found.runUrl}). Deployment will try to reuse its tested artifact; an unavailable download falls back to a fresh build and tests.\n`
      : 'No reusable successful CI build was available for this commit and base path. Deployment will build and test a fresh artifact.\n';
    if (env.GITHUB_STEP_SUMMARY) await appendFile(env.GITHUB_STEP_SUMMARY, summary);
    console.log(found ? `Found tested build in CI run ${found.runId}.` : 'No reusable tested build found; using fresh validation.');
  }
  const formatted = `${Object.entries(outputs).map(([key, value]) => `${key}=${value}`).join('\n')}\n`;
  if (env.GITHUB_OUTPUT) await appendFile(env.GITHUB_OUTPUT, formatted);
  else process.stdout.write(formatted);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv[2], process.env).catch(() => {
    console.error('Cannot prepare build metadata. Check the command, commit SHA, run attempt, and base path.');
    process.exitCode = 1;
  });
}

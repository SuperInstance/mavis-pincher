/**
 * mavis-pincher — the substrate walker for the SuperInstance fleet knowledge surface.
 *
 * Endpoints (all under /v1):
 *
 *   GET /v1/health              → liveness + chain tip + dataset generation timestamp
 *   GET /v1/repos               → list all repos (paginated, filterable)
 *   GET /v1/repos/:owner/:name  → full record for one repo
 *   GET /v1/search?q=...&k=10   → lexical + keyword search
 *   GET /v1/links/:owner/:name  → link graph (depends_on + depended_by)
 *   GET /v1/families            → family counts
 *
 * The dataset is shipped in data/repos.json (49 most-active SuperInstance repos,
 * refreshed nightly by the keeper's atlas cron). The Worker serves it.
 *
 * For the next round: pincher stores the dataset in D1 + Vectorize for semantic
 * search; this POC serves the static dataset.
 */

export interface Env {
  ASSETS: Fetcher;
  PINCHER_VERSION: string;
  PINCHER_GENERATED: string;
}

interface RepoRecord {
  owner: string;
  name: string;
  description: string;
  family: string;
  pushed_at: string;
  default_branch: string;
  size_kb: number;
  stargazers: number;
  open_issues: number;
  html_url: string;
  homepage: string | null;
  topics: string[];
  language: string | null;
  keywords: string[];
}

interface PincherDataset {
  generated: string;
  generator: string;
  count: number;
  families: Record<string, number>;
  records: RepoRecord[];
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function jsonResponse(data: any, status = 200, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=300',  // 5 min
      ...CORS,
      ...extraHeaders,
    },
  });
}

function errorResponse(message: string, status = 400): Response {
  return jsonResponse({ error: message, status }, status);
}

async function loadDataset(env: Env): Promise<PincherDataset> {
  // Fetch the dataset from the asset bundle.
  // The Worker has ASSETS binding set to ./data; the file is repos.json.
  const asset = await env.ASSETS.fetch('https://pincher.local/repos.json');
  if (!asset.ok) {
    throw new Error(`Failed to load dataset: HTTP ${asset.status}`);
  }
  return await asset.json() as PincherDataset;
}

function matchesQuery(repo: RepoRecord, q: string): boolean {
  const qLower = q.toLowerCase();
  if (repo.name.toLowerCase().includes(qLower)) return true;
  if (repo.description.toLowerCase().includes(qLower)) return true;
  for (const kw of repo.keywords) {
    if (kw.toLowerCase().includes(qLower)) return true;
  }
  return false;
}

function searchScore(repo: RepoRecord, terms: string[]): number {
  let score = 0;
  const nameLower = repo.name.toLowerCase();
  const descLower = repo.description.toLowerCase();
  for (const term of terms) {
    if (nameLower.includes(term)) score += 5;
    if (descLower.includes(term)) score += 2;
    for (const kw of repo.keywords) {
      if (kw.toLowerCase().includes(term)) score += 1;
    }
  }
  // Bonus: most-pushed recently
  return score;
}

async function handleHealth(env: Env, dataset: PincherDataset): Promise<Response> {
  return jsonResponse({
    status: 'ok',
    pincher_version: env.PINCHER_VERSION,
    pincher_generated: env.PINCHER_GENERATED,
    dataset_generated: dataset.generated,
    dataset_count: dataset.count,
    families: dataset.families,
    chain_tip: dataset.generated,  // dataset regen is the receipt chain tip
    timestamp: new Date().toISOString(),
  });
}

async function handleListRepos(dataset: PincherDataset, url: URL): Promise<Response> {
  let records = dataset.records;
  // Filter by family
  const family = url.searchParams.get('family');
  if (family) {
    records = records.filter(r => r.family === family);
  }
  // Sort
  const sort = url.searchParams.get('sort') ?? 'pushed_at';
  const dir = (url.searchParams.get('dir') ?? 'desc').toLowerCase() === 'asc' ? 1 : -1;
  records.sort((a, b) => {
    if (sort === 'name') return dir * a.name.localeCompare(b.name);
    if (sort === 'stars') return dir * (a.stargazers - b.stargazers);
    if (sort === 'size') return dir * (a.size_kb - b.size_kb);
    return dir * (a.pushed_at.localeCompare(b.pushed_at));
  });
  // Pagination
  const offset = parseInt(url.searchParams.get('offset') ?? '0', 10);
  const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '50', 10), 200);
  const total = records.length;
  records = records.slice(offset, offset + limit);
  return jsonResponse({
    total,
    offset,
    limit,
    count: records.length,
    records,
  });
}

async function handleGetRepo(dataset: PincherDataset, owner: string, name: string): Promise<Response> {
  const repo = dataset.records.find(r => r.owner === owner && r.name === name);
  if (!repo) {
    return errorResponse(`Repo not found: ${owner}/${name}`, 404);
  }
  return jsonResponse(repo);
}

async function handleSearch(dataset: PincherDataset, url: URL): Promise<Response> {
  const q = url.searchParams.get('q') ?? '';
  if (!q.trim()) {
    return errorResponse('Missing query: ?q=...', 400);
  }
  const k = Math.min(parseInt(url.searchParams.get('k') ?? '10', 10), 50);
  const terms = q.toLowerCase().split(/\s+/).filter(t => t.length > 1);
  const scored = dataset.records
    .map(r => ({ repo: r, score: searchScore(r, terms) }))
    .filter(({ repo, score }) => score > 0 && matchesQuery(repo, q))
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
  return jsonResponse({
    q,
    k,
    count: scored.length,
    results: scored.map(({ repo, score }) => ({
      owner: repo.owner,
      name: repo.name,
      family: repo.family,
      score,
      description: repo.description,
      html_url: repo.html_url,
    })),
  });
}

async function handleLinks(dataset: PincherDataset, owner: string, name: string): Promise<Response> {
  const repo = dataset.records.find(r => r.owner === owner && r.name === name);
  if (!repo) {
    return errorResponse(`Repo not found: ${owner}/${name}`, 404);
  }
  // Simple link graph from the keywords (POC — full graph comes from the package.json ingest).
  // For now: anything that mentions this name in its description or keywords is "depends on" it.
  const lower = name.toLowerCase();
  const dependedBy = dataset.records.filter(r =>
    r.name !== name && (
      r.description.toLowerCase().includes(lower) ||
      r.keywords.some(kw => kw.toLowerCase() === lower)
    )
  ).map(r => ({ owner: r.owner, name: r.name, html_url: r.html_url }));
  return jsonResponse({
    owner,
    name,
    depends_on: [],  // POC: empty; requires package.json ingest
    depended_by: dependedBy,
    note: 'depends_on is empty in POC; depends on package.json ingest from refresh pipeline',
  });
}

async function handleFamilies(dataset: PincherDataset): Promise<Response> {
  return jsonResponse({
    families: dataset.families,
    total: dataset.count,
    timestamp: new Date().toISOString(),
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS });
    }

    // Only GET supported
    if (request.method !== 'GET') {
      return errorResponse(`Method not allowed: ${request.method}`, 405);
    }

    // Load dataset once per request
    let dataset: PincherDataset;
    try {
      dataset = await loadDataset(env);
    } catch (e: any) {
      return errorResponse(`Dataset load failed: ${e.message}`, 500);
    }

    // Route
    if (path === '/v1/health' || path === '/' || path === '/health') {
      return handleHealth(env, dataset);
    }
    if (path === '/v1/repos' || path === '/v1/repos/') {
      return handleListRepos(dataset, url);
    }
    if (path === '/v1/families' || path === '/v1/families/') {
      return handleFamilies(dataset);
    }

    // /v1/repos/:owner/:name
    const repoMatch = path.match(/^\/v1\/repos\/([^/]+)\/([^/]+)\/?$/);
    if (repoMatch) {
      const [, owner, name] = repoMatch;
      return handleGetRepo(dataset, owner, name);
    }

    // /v1/links/:owner/:name
    const linksMatch = path.match(/^\/v1\/links\/([^/]+)\/([^/]+)\/?$/);
    if (linksMatch) {
      const [, owner, name] = linksMatch;
      return handleLinks(dataset, owner, name);
    }

    // /v1/search
    if (path === '/v1/search' || path === '/v1/search/') {
      return handleSearch(dataset, url);
    }

    return errorResponse(`Not found: ${path}`, 404);
  },
};

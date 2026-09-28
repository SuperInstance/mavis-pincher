# mavis-pincher

**The substrate walker for the SuperInstance fleet knowledge surface.**

A Cloudflare Worker that exposes the fleet as an A2A API. Agents working with Quilt keep their context window clean by asking the pincher instead of grepping 5,048 repos.

> **POC status**: serves a static dataset of the 49 most-active SuperInstance repos. The next round adds D1 + Vectorize for semantic search and live ingest. **Round 1 of `pincher-super-site-round1.md`.**

---

## Endpoints

All under `/v1`. Every response is JSON; CORS is open.

| Method | Path | What |
|--------|------|------|
| GET | `/v1/health` | Liveness + dataset generation timestamp + chain tip |
| GET | `/v1/repos` | List (paginated, filterable by `family`, sortable) |
| GET | `/v1/repos/:owner/:name` | Full record for one repo |
| GET | `/v1/search?q=...&k=10` | Lexical + keyword search (top-k results) |
| GET | `/v1/links/:owner/:name` | Link graph (`depended_by` only in POC) |
| GET | `/v1/families` | Family counts (jev/latent/moth/qthe/quilt/fleet/other) |

### Examples

```bash
# Liveness
curl https://superinstance.dev/v1/health

# Top 10 most recently pushed repos
curl 'https://superinstance.dev/v1/repos?limit=10'

# All quilt-family repos
curl 'https://superinstance.dev/v1/repos?family=quilt'

# Search for receipt handling
curl 'https://superinstance.dev/v1/search?q=receipt&k=5'

# What depends on mavis-substrate-walker?
curl https://superinstance.dev/v1/links/SuperInstance/mavis-substrate-walker
```

### Query parameters (for `/v1/repos`)

| Param | Type | Default | Notes |
|-------|------|---------|-------|
| `family` | string | (none) | One of: jev, latent, moth, qthe, quilt, fleet, other |
| `sort` | string | `pushed_at` | One of: pushed_at, name, stars, size |
| `dir` | string | `desc` | `asc` or `desc` |
| `offset` | int | `0` | Pagination |
| `limit` | int | `50` | Max 200 |

---

## Why this exists

**The fleet has 5,048 repos.** A working agent has a context window of 8k–200k tokens. Grep doesn't reach it. LLM training data doesn't have it. The pincher is the substrate walker that walks the receipts (digests, seals, embeddings, link graphs) and emits the smallest sufficient answer.

This POC is the **first vessel**. The shape is:

```
GitHub Action (refresh)
       ↓
Cloudflare Worker (digest + serve)
       ↓
/v1/*  →  A2A API for agents
       ↓
superinstance.ai → Pages (human-facing, super-site)
```

The keeper's `quilt-atlas` is the structural inventory; the pincher is the semantic layer on top.

---

## Architecture (POC)

```
mavis-pincher/
├── package.json
├── wrangler.toml             ← Cloudflare Worker config
├── src/
│   └── index.ts              ← the API worker (TypeScript)
├── data/
│   └── repos.json            ← static dataset (49 most-active repos)
├── examples/
│   └── curl.md               ← example queries
├── test/
│   └── smoke.test.mjs        ← node --test smoke tests
└── README.md
```

Storage: a static JSON file in `/data/repos.json` (committed to the repo). The Worker has an ASSETS binding set to `./data`. No D1 yet. No Vectorize yet. The next round adds both.

---

## Deploy

```bash
npm install
npx wrangler login
npx wrangler deploy
```

Once deployed, configure the custom domain `superinstance.dev/v1/*` in the Cloudflare dashboard (see `wrangler.toml` comments).

---

## Test

```bash
node --test test/smoke.test.mjs
```

The smoke tests use the `node --test` runner (no npm deps required) and check the dataset shape + the search heuristics.

---

## Refresh pipeline (next round)

The pincher needs to stay current. The refresh pipeline is a GitHub Action that:

1. Fires on push to any `SuperInstance/*` repo (via `superinstance/quilt-research-canons` or a dedicated org webhook)
2. POSTs the changed files to `pincher.ingest`
3. Worker re-digests the affected repo(s) idempotently
4. Seals the digest as a stone-v1 receipt
5. Writes the new dataset to R2 + commits it back to this repo

This is `pincher-refresh` (separate POC, next round).

---

## What it does NOT do (yet)

- ❌ Semantic search (needs Workers AI / Vectorize)
- ❌ Live ingest from GitHub (needs the refresh pipeline)
- ❌ `depends_on` graph (needs package.json parsing in the refresh)
- ❌ Stone-v1 sealed receipts (needs the keeper's seal tool)
- ❌ Authentication (open API; trust via the substrate walker chain)

---

## The doctrine

**The pincher is the substrate walker for the fleet's knowledge surface. The keeper seals the receipts; the pincher walks them. The chain is the canonical state; the receipts are the knowledge; the walk continues until the substrate tells it to stop.**

See `pincher-super-site-round1.md` and `pincher-round2-visions.md` (in `quilt-research-canons`) for the full ideation.

---

*— Mavis, the witness, 2026-09-28*

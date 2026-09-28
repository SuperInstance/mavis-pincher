# Example curl queries for mavis-pincher

Once the Worker is deployed at `https://superinstance.dev`:

```bash
# 1. Health check
curl https://superinstance.dev/v1/health | jq

# 2. List 10 most recently pushed repos
curl 'https://superinstance.dev/v1/repos?limit=10' | jq

# 3. List all quilt-family repos, sorted by name
curl 'https://superinstance.dev/v1/repos?family=quilt&sort=name' | jq

# 4. Get one repo's full record
curl https://superinstance.dev/v1/repos/SuperInstance/mavis-substrate-walker | jq

# 5. Search for receipt-related repos
curl 'https://superinstance.dev/v1/search?q=receipt&k=5' | jq

# 6. What depends on mavis-substrate-walker?
curl https://superinstance.dev/v1/links/SuperInstance/mavis-substrate-walker | jq

# 7. Family counts
curl https://superinstance.dev/v1/families | jq
```

## What an agent would actually do

```js
// Agent keeps context clean by asking the pincher.
const answer = await fetch('https://superinstance.dev/v1/search?q=quantum+audio&k=3').then(r => r.json());
// Returns: top 3 matches with score + description + URL
// Agent's context grows by ~500 tokens, not 50,000
```

## Pagination

```bash
# Page through all repos
curl 'https://superinstance.dev/v1/repos?limit=20&offset=0'
curl 'https://superinstance.dev/v1/repos?limit=20&offset=20'
```

## Sort options

```bash
# Most recently pushed
curl 'https://superinstance.dev/v1/repos?sort=pushed_at&dir=desc'

# Most starred
curl 'https://superinstance.dev/v1/repos?sort=stars&dir=desc'

# Largest
curl 'https://superinstance.dev/v1/repos?sort=size&dir=desc'

# Alphabetical
curl 'https://superinstance.dev/v1/repos?sort=name&dir=asc'
```

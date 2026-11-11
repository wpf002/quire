# Quire

Publishing workspace for indie authors. Upload a manuscript, run editing passes, get a KDP AI-disclosure report, get metadata recommendations, export for KDP and IngramSpark, then track rank and get re-optimization recommendations tied to each metadata change.

## Run It

Needs Node 22+, pnpm 10 and a local Postgres.

```bash
pnpm install
cp .env.example .env        # set DATABASE_URL and a 32+ char QUIRE_SESSION_SECRET
pnpm db:migrate
pnpm dev                    # API on :4000, web on :3000
```

Open http://localhost:3000 and sign up. Leave `ANTHROPIC_API_KEY` blank to run rule-only passes. AI passes and blurbs need a key and stay under the per-user and platform daily caps.

## Layout

| Path | What |
|---|---|
| `apps/web` | Next.js app. Proxies `/api/*` to the API, so keys and the session secret never reach the browser. |
| `apps/api` | Fastify API, job worker, spend ledger, plans. |
| `packages/core` | Manuscript model, stages, trim sizes. |
| `packages/ingest` | DOCX, EPUB, HTML and Markdown import. |
| `packages/editing` | Rule and model editing passes, blurbs. |
| `packages/compliance` | KDP AI disclosure and rights checklist. |
| `packages/discovery` | Keyword scoring, box packing, category fit, pricing. |
| `packages/export` | EPUB and print PDF, preflight. |
| `packages/tracking` | Rank observations, change attribution, re-optimize recs. |
| `packages/db` | Prisma schema and migrations. |

## Data Sources

- Keyword suggestions: live Amazon autocomplete (`QUIRE_DISCOVERY_PROVIDERS=amazon,sample`).
- Category and market data: deterministic sample providers. The UI tags them **Sample**.
- Rank data: `QUIRE_RANK_PROVIDER=sample` (default) simulates it. On sample, the Rank tab has **+7 / +14 / +30 Days** buttons to simulate time passing.
- `QUIRE_RANK_PROVIDER=amazon` reads public amazon.com pages once a day: BSR from the product page, keyword rank from Kindle search (organic results, top 100). It's against Amazon's terms and stops on a robot check. Expect about 2.5s per page load.
- Check the scraper by hand: `pnpm --filter @quire/tracking run probe <ASIN> "keyword"`.

## Checks

```bash
pnpm turbo run typecheck lint test
```

## Browser Testing

`.claude/launch.json` defines the `api` and `web` dev servers for the Claude desktop browser pane. `apps/web/test/fixtures/browser-account.json` holds a local-only test account (`@quire.test`) used for walking the flow in the browser. It's not a real credential.

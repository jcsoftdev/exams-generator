# GeneraExamen — landing

Marketing site for GeneraExamen (Astro, static). Part of the `exams-generator` monorepo.

## Structure

```text
apps/landing/
├── public/            # favicon, screenshots, robots.txt, site.webmanifest
├── src/
│   ├── layouts/        # Layout.astro — head/meta/OG/theme-init shared by every page
│   └── pages/           # index.astro (home), login.astro, 404.astro, privacidad.astro, terminos.astro
└── astro.config.mjs     # site URL + @astrojs/sitemap
```

## Commands

Run from `apps/landing/` (or via the root `pnpm --filter @exams-generator/landing <script>`):

| Command        | Action                                 |
| :------------- | :-------------------------------------- |
| `pnpm dev`     | Start the local dev server              |
| `pnpm build`   | Build the production site to `./dist/`  |
| `pnpm preview` | Preview the production build locally    |

## Refreshing the bank numbers

The central-bank stats (`bank.questions`, `bank.courses`, `bank.topics`, and the
per-course breakdown) are hardcoded in **`src/data/bank.ts`** — the page is
statically built and must not depend on the API being reachable at build time.
Re-run the query below and update that file when the numbers drift; publishing
a count we have not measured is worse than publishing none.

```sql
-- Headline figures: questions, topics, courses.
SELECT COUNT(*), COUNT(DISTINCT t.id), COUNT(DISTINCT t.course_id)
FROM questions q JOIN topics t ON t.id = q.topic_id
WHERE q.tenant_id IS NULL AND q.status = 'approved';

-- Per-course breakdown, most questions first.
SELECT c.name, COUNT(*) AS n
FROM questions q
JOIN topics t ON t.id = q.topic_id
JOIN courses c ON c.id = t.course_id
WHERE q.tenant_id IS NULL AND q.status = 'approved'
GROUP BY c.name ORDER BY n DESC;
```

`status = 'approved'` is load-bearing: archived questions never reach an exam,
so counting them would advertise stock a customer cannot actually draw from.

Against a local stack (`pnpm dev:infra` from the repo root, then the seed):

```bash
docker exec infra-postgres-1 psql -U exams -d exams_generator -c "<query>"
```

**`src/data/bank.spec.ts` guards these numbers** — run
`pnpm --filter @exams-generator/landing test` after editing. It asserts the
label matches the figure, that the per-course breakdown sums to the headline,
and that both stay in range of the seed corpus in
`apps/api/src/db/data/collected/`. It exists because the previous figure (1,066,
measured 2026-07-30) sat 60x stale on the live site for two weeks after the bulk
harvest took the bank past 64k, and nothing failed to say so.

## Notes

- Brand/contact placeholders were fixed in the P0 pass — see `docs/audit-todo.md` at the repo root.
- **The production domain is `creaexamen.com`** and it is live. Verified 2026-08-14 across all
  three systems that define it: the Cloudflare zone (`creaexamen.com`, active, A records for
  root/`api`/`*` → `45.8.132.213`, all proxied), the Dokploy compose `exams-stack`
  (`creaexamen.com` → the `landing` service, `api.creaexamen.com` → `api`), and
  `astro.config.mjs`'s `site`. An earlier note here claimed `site` was still the placeholder
  `generaexamen.pe` — that was already stale when written.
- `/privacidad` and `/terminos` still carry a TODO banner (real razón social/RUC pending), so
  they are **unlinked from the footer and `noindex`** until that content is real. See the
  `legalFooterReady` flag in `src/pages/index.astro` and `NOINDEXED` in `astro.config.mjs`.
  The site being live is exactly why they had to come down.

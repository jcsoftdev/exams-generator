# GeneraExamen — landing

Marketing site for GeneraExamen (Astro, static). Part of the `exams-generator` monorepo.

## Structure

```text
apps/landing/
├── public/            # favicon, screenshots, robots.txt, site.webmanifest
├── src/
│   ├── layouts/        # Layout.astro — head/meta/OG/theme-init shared by every page
│   └── pages/           # index.astro (home), 404.astro, privacidad.astro, terminos.astro
└── astro.config.mjs     # site URL + @astrojs/sitemap
```

## Commands

Run from `apps/landing/` (or via the root `pnpm --filter @exams-generator/landing <script>`):

| Command        | Action                                 |
| :------------- | :-------------------------------------- |
| `pnpm dev`     | Start the local dev server              |
| `pnpm build`   | Build the production site to `./dist/`  |
| `pnpm preview` | Preview the production build locally    |

## Notes

- Brand/contact placeholders were fixed in the P0 pass — see `docs/audit-todo.md` at the repo root.
- `astro.config.mjs`'s `site` is still a placeholder domain (`generaexamen.pe`) until the real production domain is registered.
- `/privacidad` and `/terminos` have generic legal content with a TODO banner — swap in the real razón social/RUC before publishing.

# EmDash Bun App

Copy of `demos/cloudflare` adapted for **Bun / Node** — SQLite on disk, local file storage, no Wrangler, no D1/R2/Workers.

Lives under `apps/` so Turborepo treats it as an app that **depends on built workspace packages**. `pnpm dev` from the repo root runs `turbo run dev --filter=@emdash-cms/demo-bun`, which builds `emdash` / admin / auth / … first (`dev.dependsOn: ["^build"]`) and then starts Astro.

It keeps the blog UI (posts, pages, tags, RSS) and adds a Docusaurus-style **docs** collection beside them.

## What is different from `demos/cloudflare`

| Cloudflare demo                   | This app                                                |
| --------------------------------- | ------------------------------------------------------- |
| `@astrojs/cloudflare` + `workerd` | `@astrojs/node` standalone                              |
| D1 + R2 + Access + AI Search      | `sqlite({ url: "file:./data.db" })` + `local()` uploads |
| `wrangler.jsonc`, `worker.ts`     | none                                                    |
| `pnpm start` via Workers          | `node ./dist/server/entry.mjs`                          |

## Setup

From the monorepo root (installs Node 22 / pnpm if needed, then the demo-bun graph):

```bash
./start.sh              # dev  — also: pnpm start
./start.sh prod         # production build + node dist/server/entry.mjs
./start.sh check        # boot dev and smoke-test admin / versions / docs
```

On Windows: `start.cmd`, `start.cmd prod`, or `node scripts/start.mjs`.

`pnpm dev` still works: it is `turbo run dev --filter=@emdash-cms/demo-bun`. Turbo builds workspace packages, then `scripts/dev-apps-bun.mjs` starts Astro:

| Process                              | SQLite driver                  |
| ------------------------------------ | ------------------------------ |
| `bun` on PATH (or already under Bun) | `bun:sqlite`                   |
| Node 22.5+                           | `node:sqlite` (`DatabaseSync`) |
| otherwise                            | `better-sqlite3`               |

Force a runtime with `pnpm --filter @emdash-cms/demo-bun dev:bun` or `dev:node`.

Requirements: **Node.js 22+** and **pnpm 10+**. `better-sqlite3` is only the last-resort native addon — prefer Bun or `node:sqlite` on Windows so you do not need Visual Studio C++ build tools.

Open:

- Site: http://localhost:4321
- Docs: http://localhost:4321/docs
- Admin: http://localhost:4321/_emdash/admin

EmDash runs migrations and applies `seed/seed.json` on first request. No manual DB step.

## Production-style run

```bash
./start.sh prod
# same as:
#   pnpm turbo run build --filter=@emdash-cms/demo-bun...
#   HOST=0.0.0.0 PORT=4321 node apps/bun/dist/server/entry.mjs
```

## Docs UI components

New components under `src/components/docs/`:

| Component                         | Role                                                                 |
| --------------------------------- | -------------------------------------------------------------------- |
| `DocsLayout`                      | Three-column docs chrome (sidebar, article, outline) + mobile drawer |
| `DocsSidebar` / `DocsSidebarNode` | Arbitrary-depth ordered tree; folders are links                      |
| `DocsVersionSwitcher`             | Catalog select; default version stays unprefixed                     |
| `DocsBreadcrumbs`                 | Crumbs from `getEmDashBreadcrumbs`                                   |
| `DocsPager`                       | Prev / next from `getEmDashNeighbors`                                |
| `DocsToc`                         | On-this-page outline from `h2`/`h3`                                  |
| `DocsSearch`                      | Local FTS search scoped to docs (`/search?in=docs`)                  |

Public helpers used: `getEmDashTree`, `getEmDashEntryByPath`, `getEmDashBreadcrumbs`, `getEmDashNeighbors`, `getEmDashVersions`.

Seed includes a writable **Next** version (`current`) and a frozen **1.0** snapshot so the switcher has something to compare.

## Notes

- Pages and posts stay flat. Only `docs` is `hierarchical` + `versioned`.
- `{path}` is server-computed. The client never sends it.
- Search uses EmDash FTS, not Cloudflare AI Search.
- Forms plugin runs in-process (no sandbox worker).

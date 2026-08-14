# EmDash Templates

Starter templates for building sites with EmDash CMS. Each template includes a seed file with demo content, so you can see how everything works right away.

## Available Templates

### Docs

A documentation site with pages, posts, and a hierarchical docs tree (Docusaurus / Mintlify / Fumadocs style).

**Features:**

- Arbitrary-depth docs tree beside pages and posts
- Ordered sidebar with folders as real pages
- Versioned docs (`/docs/{path}` URLs)
- Breadcrumbs and previous/next navigation
- SEO metadata

**Pages:** Homepage, docs catch-all (`/docs/{path}`), 404

## Using a Template

Most templates have two variants:

- **Bun / Node.js** (`templates/blog`, `templates/marketing`, `templates/portfolio`, `templates/docs`) — SQLite and local file storage
- **Cloudflare** (`templates/blog-cloudflare`, etc.) — D1 and R2

The **Docs** template is Bun/Node only (no Cloudflare / D1 / R2). Run it locally with Bun:

### Quick Start

```bash
# Copy the template you want
cp -r templates/docs my-site
cd my-site

# Install dependencies
bun install

# Start the dev server
bun dev
```

Open http://localhost:4321 to see your site, and http://localhost:4321/\_emdash/admin for the CMS.

### Template Structure

```
templates/blog/
├── src/
│   ├── components/     # Astro components
│   ├── layouts/        # Page layouts
│   ├── pages/          # Route pages
│   ├── utils/          # Helper functions
│   └── live.config.ts  # EmDash content loader
├── seed/
│   └── seed.json       # Demo content
├── astro.config.mjs    # Astro + EmDash config
├── package.json
└── tsconfig.json
```

## Contributing

### Cloudflare Variants

The cloudflare variants share most of their code with the base templates. Only these files differ:

- `astro.config.mjs` (cloudflare adapter, D1/R2 storage)
- `package.json` (different dependencies)
- `wrangler.jsonc` (cloudflare config)

Everything else is synced from the base template using a script:

```bash
./scripts/sync-cloudflare-templates.sh
```

**Run this after making changes** to `src/`, `seed/`, `tsconfig.json`, `emdash-env.d.ts`, or `.gitignore` in any base template. It copies those files to the corresponding cloudflare variant.

The primary Node demo is also synced from the blog template:

```bash
./scripts/sync-blog-demos.sh
```

This script does two kinds of sync:

- full template sync for `templates/blog` -> `demos/simple`
- frontend-only sync (keeping runtime-specific files) for:
  - `templates/blog-cloudflare` -> `demos/cloudflare`
  - `templates/blog-cloudflare` -> `demos/preview`
  - `templates/blog` -> `demos/postgres`

`apps/bun` is a hand-maintained Bun/Node copy of `demos/cloudflare`. It is **not** overwritten by the sync scripts. It swaps D1/R2/Workers for SQLite + local files and adds the public docs UI (`src/components/docs/`) for hierarchical / versioned collections. Start it with `pnpm dev` from the repo root (Turborepo builds workspace packages first).

### Taking Screenshots

Template screenshots live in `assets/templates/{template}/latest/` and are used in the README. To update them after making visual changes:

```bash
# Screenshot all templates (starts each dev server automatically)
pnpm screenshots

# Screenshot specific templates
pnpm screenshots blog
pnpm screenshots blog marketing
```

The script starts each template's dev server, captures screenshots, then stops the server before moving to the next template.

Page definitions are in `templates/screenshots.json`. Each page is captured at desktop (1440x900) and mobile (390x844) in both light and dark mode at 2x resolution. Screenshots are JPEG at 80% quality.

Output goes to `assets/templates/{template}/{datetime}/` and is copied to `assets/templates/{template}/latest/`. The dated directories are gitignored; only `latest/` is committed. The README references images from `latest/`.

Filenames follow the pattern `{page}-{mode}-{breakpoint}.jpg`, e.g. `homepage-light-desktop.jpg`, `post-dark-mobile.jpg`.

To add pages for a template, edit `templates/screenshots.json`.

### Adding a New Template

1. Create the base template in `templates/{name}/`
2. Include a seed file at `seed/seed.json` (or configure the path in `package.json` under `emdash.seed`)
3. Add the `typecheck` script to `package.json`
4. Create the cloudflare variant in `templates/{name}-cloudflare/` with the appropriate adapter config
5. Add the template pair to `scripts/sync-cloudflare-templates.sh`
6. Add the template's pages to `templates/screenshots.json` and run the screenshot script
7. Update the README template gallery

### Seed Files

Each template includes a seed file with demo content. The seed file format is documented in the CLI (`emdash seed --help`). Key points:

- Use `status: "published"` and include `published_at` for content that should appear on the site
- Reference media by URL — the seeder downloads and uploads images automatically
- Use the `taxonomies` object for categories and tags
- The `emdash.seed` field in `package.json` specifies the seed file location

### Testing Templates

Templates are covered by smoke tests that verify:

- Seed files parse correctly
- Seeds apply without errors
- The database passes doctor checks after seeding

Run the smoke tests:

```bash
pnpm --filter emdash exec vitest run --config vitest.smoke.config.ts
```

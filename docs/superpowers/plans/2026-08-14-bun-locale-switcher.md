# Bun App Locale Switcher Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a locale switcher to the Bun Astro demo app navbar that smoothly transitions between configured languages (`en` and `ja`) while preserving the active route.

**Architecture:** A standalone `LocaleSwitcher.astro` component and an i18n utility module `src/utils/i18n.ts` integrated into `Base.astro` header navigation.

**Tech Stack:** Astro, TypeScript, Vanilla CSS (with CSS variables and `@layer base` theme tokens).

## Global Constraints

- Must not introduce any new queries to the logged-out hot path.
- Respect existing dark/light mode and layout variables (`--color-bg`, `--color-border`, `--color-accent`, etc.).
- Follow Astro and Kumo design conventions.
- Pass `pnpm lint:quick` and `pnpm typecheck:demos`.

---

### Task 1: Create i18n Path and Label Utilities with Unit Tests

**Files:**

- Create: `apps/bun/src/utils/i18n.ts`
- Create: `apps/bun/src/utils/i18n.test.ts`

**Interfaces:**

- Produces:
  - `SUPPORTED_LOCALES: Array<{ code: string; label: string }>`
  - `getLocalizedPath(pathname: string, targetLocale: string, currentLocale?: string, search?: string): string`
  - `getLocaleLabel(code: string): string`

- [ ] **Step 1: Write the failing unit tests for i18n utilities**
- [ ] **Step 2: Run test to verify it fails**
- [ ] **Step 3: Implement `apps/bun/src/utils/i18n.ts`**
- [ ] **Step 4: Run test to verify it passes**

---

### Task 2: Create `LocaleSwitcher.astro` Component

**Files:**

- Create: `apps/bun/src/components/LocaleSwitcher.astro`

**Interfaces:**

- Consumes: `SUPPORTED_LOCALES`, `getLocalizedPath` from `../utils/i18n`
- Produces: `<LocaleSwitcher locale={locale} />` Astro component

- [ ] **Step 1: Implement `LocaleSwitcher.astro` with accessible `<select>` and globe SVG icon**
- [ ] **Step 2: Add client-side script for instant URL redirection on change and Astro page load listener**
- [ ] **Step 3: Add CSS styling matching `.nav-search-btn` and theme tokens**

---

### Task 3: Integrate `LocaleSwitcher` into `Base.astro` and Update Page Routes

**Files:**

- Modify: `apps/bun/src/layouts/Base.astro`
- Modify: `apps/bun/src/pages/[locale]/index.astro`
- Modify: `apps/bun/src/pages/[locale]/docs/[version]/index.astro`
- Modify: `apps/bun/src/pages/[locale]/docs/[version]/[...path].astro`

- [ ] **Step 1: Update `Base.astro` to import `LocaleSwitcher` and render it in `.nav-right`**
- [ ] **Step 2: Update `<html lang={locale}>` in `Base.astro`**
- [ ] **Step 3: Pass `locale` prop from pages to `Base.astro` where applicable**

---

### Task 4: Verification and Quality Checks

**Files:**

- Test all pages in dev server or via automated test suites

- [ ] **Step 1: Run `pnpm typecheck:demos`**
- [ ] **Step 2: Run `pnpm lint:quick` and `pnpm format`**
- [ ] **Step 3: Run unit tests via vitest**
- [ ] **Step 4: Verify in browser (homepage, docs, search in both en and ja)**

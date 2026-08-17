# Bun App Locale Switcher Design

## Overview

Add a locale switcher component to the header navigation in the `apps/bun` Astro demo application. This allows users to switch between configured locales (`en` and `ja`) seamlessly while preserving the current page path, query params, and doc version context.

## Goals

1. Add an accessible, styled `LocaleSwitcher.astro` component in `apps/bun/src/components/LocaleSwitcher.astro`.
2. Include the locale switcher in the global header (`apps/bun/src/layouts/Base.astro`) within `.nav-right`.
3. Support path-preserving URL translation (e.g. `/en/docs/current/getting-started/introduction` $\rightarrow$ `/ja/docs/current/getting-started/introduction`).
4. Update document HTML root `<html lang={locale}>` dynamically based on the active locale.
5. Provide clean styling matching existing header controls (`nav-search-btn`) with support for dark/light themes.

## Architecture & Components

### 1. `apps/bun/src/components/LocaleSwitcher.astro`

- **Props**:
  - `locale?: string` (active locale, default `en`)
  - `locales?: Array<{ code: string; label: string }>` (list of available locales)
- **Features**:
  - Globe SVG icon matching Kumo/Lucide aesthetics.
  - `<select>` dropdown with language names (`English`, `日本語`).
  - Pre-computes destination URLs for each locale option based on `Astro.url.pathname` and `Astro.url.search`.
  - Client-side navigation handler on change, supporting `astro:page-load` lifecycle.

### 2. `apps/bun/src/utils/i18n.ts`

- Helper utilities for:
  - `getLocalizedPath(pathname: string, targetLocale: string, currentLocale: string, search?: string): string`
  - Mapping locale codes to display labels (`en` $\rightarrow$ `English`, `ja` $\rightarrow$ `日本語`).
  - List of supported locales.

### 3. `apps/bun/src/layouts/Base.astro`

- Accept optional `locale` prop, fallback to `Astro.currentLocale || Astro.params.locale || "en"`.
- Set `<html lang={locale}>`.
- Embed `<LocaleSwitcher locale={locale} />` in `<nav class="nav">` within `<div class="nav-right">`.
- Pass `locale` from page routes where applicable.

## Verification Plan

1. **Type Checks**: Run `pnpm typecheck:demos` to ensure all Astro and TypeScript files typecheck cleanly.
2. **Lint**: Run `pnpm lint:quick` to verify formatting and linting.
3. **Manual Verification / Browser**:
   - Verify switcher displays on homepage `/en/` and switching to `ja` navigates to `/ja/`.
   - Verify switcher on deep doc path `/en/docs/current/getting-started/introduction` switches to `/ja/docs/current/getting-started/introduction`.
   - Verify theme toggle works alongside the locale switcher.

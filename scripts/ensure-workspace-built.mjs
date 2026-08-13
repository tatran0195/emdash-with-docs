#!/usr/bin/env node
/**
 * Make `pnpm dev` work on a fresh checkout (including Windows).
 *
 * Workspace packages export built files (`dist/index.mjs`). Vite/Astro load
 * `emdash/astro` while evaluating astro.config, so a missing dist becomes:
 *
 *   Failed to resolve entry for package "emdash"
 *
 * This script is a no-op when dist already exists, and a no-op outside the
 * monorepo (published npm `emdash` already ships dist).
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const corePkg = path.join(root, "packages", "core", "package.json");

if (!existsSync(corePkg)) {
	process.exit(0);
}

const required = [
	"packages/core/dist/index.mjs",
	"packages/core/dist/astro/index.mjs",
	"packages/core/dist/db/index.mjs",
	"packages/core/dist/db/sqlite.mjs",
	"packages/admin/dist/index.js",
	"packages/auth/dist/index.mjs",
];

const missing = required.filter((rel) => !existsSync(path.join(root, rel)));
if (missing.length === 0) {
	process.exit(0);
}

console.log("[emdash] Workspace packages are not built yet.");
console.log("[emdash] Missing:");
for (const rel of missing) {
	console.log(`         ${rel}`);
}
console.log("[emdash] Building emdash and its workspace dependencies (once after install).");
console.log("[emdash] This is the same as:  pnpm build");

const result = spawnSync("pnpm", ["run", "--filter", "emdash...", "build"], {
	cwd: root,
	stdio: "inherit",
	// Windows resolves pnpm.cmd only when the command is run through a shell.
	shell: true,
	env: process.env,
});

if (result.error) {
	console.error("[emdash] Failed to start pnpm:", result.error.message);
	console.error("[emdash] From the repo root run:  pnpm build");
	process.exit(1);
}

if ((result.status ?? 1) !== 0) {
	console.error("[emdash] Package build failed.");
	console.error("[emdash] From the repo root run:  pnpm build");
	process.exit(result.status ?? 1);
}

const stillMissing = required.filter((rel) => !existsSync(path.join(root, rel)));
if (stillMissing.length > 0) {
	console.error("[emdash] Build finished but these files are still missing:");
	for (const rel of stillMissing) {
		console.error(`         ${rel}`);
	}
	process.exit(1);
}

console.log("[emdash] Workspace packages built. Starting the app.");

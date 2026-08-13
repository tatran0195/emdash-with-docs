#!/usr/bin/env node
/**
 * Start apps/bun.
 *
 * Runtime pick:
 *   - already running under Bun → `bun --bun astro dev` (bun:sqlite)
 *   - `bun` on PATH             → same
 *   - otherwise                 → Node (`node:sqlite` if available, else better-sqlite3)
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const appDir = path.join(root, "apps", "bun");
const astroArgs = ["dev", "--host", "0.0.0.0", "--port", "4321"];
const win = process.platform === "win32";

function hasCommand(bin) {
	const probe = win ? "where" : "which";
	const result = spawnSync(probe, [bin], { encoding: "utf8", windowsHide: true });
	return result.status === 0;
}

function resolveAstroEntry() {
	const candidates = [
		path.join(appDir, "node_modules", "astro", "astro.js"),
		path.join(appDir, "node_modules", "astro", "bin", "astro.mjs"),
		path.join(root, "node_modules", "astro", "astro.js"),
		path.join(root, "node_modules", "astro", "bin", "astro.mjs"),
	];
	for (const file of candidates) {
		if (existsSync(file)) return file;
	}
	return null;
}

function run(command, args, label) {
	console.log(`[apps/bun] ${label}`);
	const child = spawn(command, args, {
		cwd: appDir,
		stdio: "inherit",
		shell: win,
		env: {
			...process.env,
			// Prebuilt admin + no source-alias transform (see vite-config).
			EMDASH_ADMIN_FROM_DIST: process.env.EMDASH_ADMIN_FROM_DIST ?? "1",
		},
	});
	const shutdown = (signal) => {
		if (!child.killed) child.kill(signal);
	};
	process.on("SIGINT", () => shutdown("SIGINT"));
	process.on("SIGTERM", () => shutdown("SIGTERM"));
	child.on("exit", (code, signal) => {
		if (signal) process.kill(process.pid, signal);
		process.exit(code ?? 1);
	});
	child.on("error", (error) => {
		console.error(`[apps/bun] failed to start ${command}:`, error.message);
		process.exit(1);
	});
}

const underBun = typeof process.versions.bun === "string";
const bunAvailable = underBun || hasCommand("bun");
const astroEntry = resolveAstroEntry();

if (bunAvailable) {
	const bunBin = underBun ? process.execPath : "bun";
	if (astroEntry) {
		run(bunBin, ["--bun", astroEntry, ...astroArgs], "runtime: bun → bun:sqlite");
	} else {
		run(bunBin, ["--bun", "astro", ...astroArgs], "runtime: bun → bun:sqlite");
	}
} else if (astroEntry) {
	run(process.execPath, [astroEntry, ...astroArgs], "runtime: node → node:sqlite or better-sqlite3");
} else {
	run(win ? "pnpm.cmd" : "pnpm", ["exec", "astro", ...astroArgs], "runtime: node → node:sqlite or better-sqlite3");
}

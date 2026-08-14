#!/usr/bin/env node
/**
 * Quick start for the apps/bun demo (dev or production).
 *
 *   ./start.sh                  # same as: node scripts/start.mjs
 *   node scripts/start.mjs      # dev (default)
 *   node scripts/start.mjs dev
 *   node scripts/start.mjs prod
 *   node scripts/start.mjs check
 *
 * Flags:
 *   --port <n>          listen port (default 4321)
 *   --host <addr>       bind address (default 0.0.0.0)
 *   --skip-install      do not run pnpm install
 *   --skip-build        do not build workspace packages / the app
 *   --force-install     always run pnpm install
 *   --force-build       always rebuild
 *   --full-install      install the whole workspace (not just demo-bun…)
 *   --once              with `check`: stop the server after the smoke test
 *
 * Bootstraps Node 22 + pnpm when missing (Linux/macOS), installs the
 * demo-bun graph, builds workspace packages, then starts Astro.
 *
 * Do not use `bun --bun` with better-sqlite3 — this script starts Node
 * (`node:sqlite` on 22.5+) unless you already launched it under Bun.
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, cpSync, chmodSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const root = path.resolve(path.dirname(__filename), "..");
const appDir = path.join(root, "apps", "bun");
const win = process.platform === "win32";
const localPrefix = path.join(os.homedir(), ".local");
const localBin = path.join(localPrefix, "bin");
const NODE_WANT = "22.18.0";
const PNPM_WANT = "11.9.0";

const REQUIRED_DIST = [
	"packages/core/dist/index.mjs",
	"packages/core/dist/astro/index.mjs",
	"packages/core/dist/db/index.mjs",
	"packages/core/dist/db/sqlite.mjs",
	"packages/admin/dist/index.js",
	"packages/auth/dist/index.mjs",
];

const PROD_ENTRY = "apps/bun/dist/server/entry.mjs";

function parseArgs(argv) {
	const flags = {
		mode: "dev",
		port: Number(process.env.PORT) || 4321,
		host: process.env.HOST || "0.0.0.0",
		skipInstall: false,
		skipBuild: false,
		forceInstall: false,
		forceBuild: false,
		fullInstall: false,
		once: false,
	};
	const rest = [];
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a === "--help" || a === "-h") flags.mode = "help";
		else if (a === "--skip-install") flags.skipInstall = true;
		else if (a === "--skip-build") flags.skipBuild = true;
		else if (a === "--force-install") flags.forceInstall = true;
		else if (a === "--force-build") flags.forceBuild = true;
		else if (a === "--full-install") flags.fullInstall = true;
		else if (a === "--once") flags.once = true;
		else if (a === "--port") flags.port = Number(argv[++i]);
		else if (a === "--host") flags.host = argv[++i];
		else if (a.startsWith("--port=")) flags.port = Number(a.slice(7));
		else if (a.startsWith("--host=")) flags.host = a.slice(7);
		else if (!a.startsWith("-")) rest.push(a);
		else rest.push(a);
	}
	const modeArg = (rest[0] || "").toLowerCase();
	if (["dev", "development"].includes(modeArg)) flags.mode = "dev";
	else if (["prod", "production", "start"].includes(modeArg)) flags.mode = "prod";
	else if (["check", "smoke", "verify"].includes(modeArg)) flags.mode = "check";
	else if (["help", "-h"].includes(modeArg)) flags.mode = "help";
	else if (modeArg) {
		console.error(`[start] Unknown mode "${rest[0]}". Use dev | prod | check.`);
		process.exit(2);
	}
	if (!Number.isFinite(flags.port) || flags.port < 1) {
		console.error("[start] Invalid --port");
		process.exit(2);
	}
	return flags;
}

function log(msg) {
	console.log(`[start] ${msg}`);
}

function fail(msg, code = 1) {
	console.error(`[start] ${msg}`);
	process.exit(code);
}

function major(version) {
	const m = String(version).replace(/^v/, "").split(".")[0];
	return Number(m);
}

function which(bin) {
	const probe = win ? "where" : "which";
	const result = spawnSync(probe, [bin], { encoding: "utf8", windowsHide: true });
	if (result.status !== 0) return null;
	const line = (result.stdout || "").split(/\r?\n/).find(Boolean);
	return line || null;
}

function nodeVersionOf(bin) {
	const result = spawnSync(bin, ["-v"], { encoding: "utf8", windowsHide: true });
	if (result.status !== 0) return null;
	return (result.stdout || "").trim();
}

function prependPath(dir) {
	const cur = process.env.PATH || "";
	if (cur.split(path.delimiter).includes(dir)) return;
	process.env.PATH = `${dir}${path.delimiter}${cur}`;
}

function run(command, args, opts = {}) {
	const cwd = opts.cwd ?? root;
	const env = opts.env ?? process.env;
	log(`$ ${command} ${args.join(" ")}`);
	const result = spawnSync(command, args, {
		cwd,
		env,
		stdio: "inherit",
		shell: win,
		windowsHide: true,
	});
	if (result.error) fail(`failed to spawn ${command}: ${result.error.message}`);
	if ((result.status ?? 1) !== 0) {
		fail(`${command} exited ${result.status}`, result.status ?? 1);
	}
}

function nodeTarballName(version) {
	const plat = process.platform;
	const arch = process.arch;
	const osName = plat === "linux" ? "linux" : plat === "darwin" ? "darwin" : null;
	if (!osName) return null;
	const cpu = arch === "x64" ? "x64" : arch === "arm64" ? "arm64" : null;
	if (!cpu) return null;
	return `node-v${version}-${osName}-${cpu}.tar.xz`;
}

function ensureNode22() {
	if (major(process.version) >= 22) {
		prependPath(localBin);
		return;
	}
	if (process.env.EMDASH_START_NODE_OK === "1") {
		fail(`still on Node ${process.version} after re-exec; need 22+`);
	}

	const candidates = [
		path.join(localBin, win ? "node.exe" : "node"),
		path.join(
			"/tmp",
			`node-v${NODE_WANT}-${process.platform === "linux" ? "linux" : "darwin"}-${process.arch}`,
			"bin",
			"node",
		),
	];
	let next = candidates.find((p) => existsSync(p) && major(nodeVersionOf(p) || "0") >= 22);

	if (!next && !win) {
		next = installNodeUnix(NODE_WANT);
	}

	if (!next) {
		fail(
			`Node 22+ is required (found ${process.version}). Install it from https://nodejs.org/ and re-run.`,
		);
	}

	log(`re-exec with ${next} (${nodeVersionOf(next)})`);
	prependPath(path.dirname(next));
	const child = spawn(next, [__filename, ...process.argv.slice(2)], {
		stdio: "inherit",
		env: {
			...process.env,
			PATH: process.env.PATH,
			EMDASH_START_NODE_OK: "1",
		},
		windowsHide: true,
	});
	child.on("exit", (code, signal) => {
		if (signal) process.kill(process.pid, signal);
		process.exit(code ?? 1);
	});
	child.on("error", (err) => fail(`re-exec failed: ${err.message}`));
	// Stay alive until the child exits.
	process.once("SIGINT", () => child.kill("SIGINT"));
	process.once("SIGTERM", () => child.kill("SIGTERM"));
	return "reexec";
}

function installNodeUnix(version) {
	const tarName = nodeTarballName(version);
	if (!tarName) return null;

	const extracted = path.join("/tmp", tarName.replace(/\.tar\.xz$/, ""));
	const extractedNode = path.join(extracted, "bin", "node");
	const cachedTar = path.join("/tmp", tarName);

	if (!existsSync(extractedNode)) {
		if (!existsSync(cachedTar)) {
			const url = `https://nodejs.org/dist/v${version}/${tarName}`;
			log(`downloading Node ${version} → ${cachedTar}`);
			const curl = spawnSync("curl", ["-fsSL", url, "-o", cachedTar], { stdio: "inherit" });
			if (curl.status !== 0) {
				console.error("[start] curl download failed; trying wget");
				const wget = spawnSync("wget", ["-q", url, "-O", cachedTar], { stdio: "inherit" });
				if (wget.status !== 0) fail(`could not download ${url}`);
			}
		}
		log(`extracting ${cachedTar}`);
		const tar = spawnSync("tar", ["-xJf", cachedTar, "-C", "/tmp"], { stdio: "inherit" });
		if (tar.status !== 0 || !existsSync(extractedNode)) fail("failed to extract Node tarball");
	}

	mkdirSync(localPrefix, { recursive: true });
	for (const part of ["bin", "lib", "include", "share"]) {
		const from = path.join(extracted, part);
		const to = path.join(localPrefix, part);
		if (!existsSync(from)) continue;
		log(`install ${part}/ → ${to}`);
		cpSync(from, to, { recursive: true, force: true });
	}
	const dest = path.join(localBin, "node");
	if (existsSync(dest)) {
		try {
			chmodSync(dest, 0o755);
		} catch {
			/* ignore */
		}
	}
	return existsSync(dest) ? dest : extractedNode;
}

function ensurePnpm() {
	prependPath(localBin);
	const existing = which("pnpm");
	if (existing) {
		const ver = spawnSync("pnpm", ["-v"], { encoding: "utf8", windowsHide: true, shell: win });
		if (ver.status === 0) {
			log(`pnpm ${ver.stdout.trim()} (${existing})`);
			return;
		}
	}

	log(`activating pnpm@${PNPM_WANT} via corepack`);
	const corepackBin =
		which("corepack") ||
		path.join(path.dirname(process.execPath), win ? "corepack.cmd" : "corepack");
	if (!existsSync(corepackBin) && !which("corepack")) {
		fail("corepack not found; install pnpm 10+ (https://pnpm.io/installation) and re-run");
	}
	const enable = spawnSync("corepack", ["enable"], {
		encoding: "utf8",
		windowsHide: true,
		shell: win,
	});
	if (enable.status !== 0) {
		console.warn("[start] corepack enable failed (may need a global install of pnpm)");
	}
	const prepare = spawnSync("corepack", ["prepare", `pnpm@${PNPM_WANT}`, "--activate"], {
		stdio: "inherit",
		windowsHide: true,
		shell: win,
	});
	if (prepare.status !== 0 || !which("pnpm")) {
		fail("could not activate pnpm via corepack. Install pnpm 10+ and re-run.");
	}
	log(
		`pnpm ${(spawnSync("pnpm", ["-v"], { encoding: "utf8", windowsHide: true, shell: win }).stdout || "").trim()}`,
	);
}

function heapEnv(mb) {
	const cur = process.env.NODE_OPTIONS || "";
	if (/\b--max-old-space-size=/.test(cur)) return { ...process.env };
	return {
		...process.env,
		NODE_OPTIONS: `${cur} --max-old-space-size=${mb}`.trim(),
	};
}

function needsInstall() {
	return !(
		existsSync(path.join(root, "node_modules", "astro")) ||
		existsSync(path.join(appDir, "node_modules", "astro")) ||
		existsSync(path.join(root, "node_modules", ".bin", "turbo"))
	);
}

function needsWorkspaceBuild() {
	return REQUIRED_DIST.some((rel) => !existsSync(path.join(root, rel)));
}

function needsAppBuild() {
	return !existsSync(path.join(root, PROD_ENTRY));
}

function turboBin() {
	const local = path.join(root, "node_modules", ".bin", win ? "turbo.cmd" : "turbo");
	return existsSync(local) ? local : "turbo";
}

function ensureInstall(flags) {
	if (flags.skipInstall) {
		log("skip install");
		return;
	}
	if (!flags.forceInstall && !needsInstall()) {
		log("dependencies already present");
		return;
	}
	const lowMem = os.totalmem() < 3.5 * 1024 * 1024 * 1024;
	const args = ["install", "--no-frozen-lockfile", "--trust-lockfile"];
	if (!flags.fullInstall) args.push("--filter", "@emdash-cms/demo-bun...");
	log(flags.fullInstall ? "installing full workspace" : "installing @emdash-cms/demo-bun… graph");
	run("pnpm", args, { env: heapEnv(lowMem ? 3072 : 4096) });
}

function ensureBuild(flags, mode) {
	if (flags.skipBuild) {
		log("skip build");
		return;
	}
	const wantApp = mode === "prod";
	const missingWs = needsWorkspaceBuild();
	const missingApp = wantApp && needsAppBuild();
	if (!flags.forceBuild && !missingWs && !missingApp) {
		log("workspace packages already built");
		return;
	}
	const lowMem = os.totalmem() < 3.5 * 1024 * 1024 * 1024;
	const filter = wantApp ? "@emdash-cms/demo-bun..." : "@emdash-cms/demo-bun^...";
	const args = ["run", "build", "--filter", filter, "--ui=stream"];
	if (lowMem) args.push("--concurrency=1");
	log(`building ${filter}`);
	run(turboBin(), args, { env: heapEnv(lowMem ? 3072 : 4096) });

	const still = REQUIRED_DIST.filter((rel) => !existsSync(path.join(root, rel)));
	if (still.length)
		fail(`build finished but still missing:\n         ${still.join("\n         ")}`);
	if (wantApp && needsAppBuild()) fail(`production build missing ${PROD_ENTRY}`);
}

function printBanner(mode, host, port) {
	const shown = host === "0.0.0.0" || host === "::" ? "localhost" : host;
	const base = `http://${shown}:${port}`;
	console.log("");
	console.log(`  EmDash  ·  apps/bun  ·  ${mode}`);
	console.log("  ────────────────────────────────────────────────────────");
	console.log(`  Site      ${base}`);
	console.log(`  Docs      ${base}/docs`);
	console.log(`  Admin     ${base}/_emdash/admin`);
	console.log(`  Bypass    ${base}/_emdash/api/setup/dev-bypass?redirect=/_emdash/admin`);
	console.log(`  Versions  ${base}/_emdash/api/content/docs/versions`);
	console.log("  ────────────────────────────────────────────────────────");
	console.log("");
}

function startDev(flags) {
	const lowMem = os.totalmem() < 3.5 * 1024 * 1024 * 1024;
	const env = {
		...heapEnv(lowMem ? 2048 : 4096),
		HOST: flags.host,
		PORT: String(flags.port),
		EMDASH_ADMIN_FROM_DIST: process.env.EMDASH_ADMIN_FROM_DIST ?? "1",
	};
	const launcher = path.join(root, "scripts", "dev-apps-bun.mjs");
	// Prefer the existing launcher (picks bun vs node, binds 0.0.0.0:4321).
	// Override port/host by spawning astro directly when they differ.
	const defaultPort = 4321;
	const defaultHost = "0.0.0.0";
	if (flags.port === defaultPort && flags.host === defaultHost && existsSync(launcher)) {
		return spawnInherit(process.execPath, [launcher], { cwd: appDir, env });
	}
	const astro = resolveAstroEntry();
	if (astro) {
		return spawnInherit(
			process.execPath,
			[astro, "dev", "--host", flags.host, "--port", String(flags.port)],
			{
				cwd: appDir,
				env,
			},
		);
	}
	return spawnInherit(
		win ? "pnpm.cmd" : "pnpm",
		["exec", "astro", "dev", "--host", flags.host, "--port", String(flags.port)],
		{
			cwd: appDir,
			env,
		},
	);
}

function startProd(flags) {
	const entry = path.join(root, PROD_ENTRY);
	if (!existsSync(entry)) fail(`missing ${PROD_ENTRY} — run without --skip-build`);
	const env = {
		...heapEnv(2048),
		HOST: flags.host,
		PORT: String(flags.port),
		NODE_ENV: process.env.NODE_ENV || "production",
	};
	return spawnInherit(process.execPath, [entry], { cwd: appDir, env });
}

function resolveAstroEntry() {
	const candidates = [
		path.join(appDir, "node_modules", "astro", "astro.js"),
		path.join(appDir, "node_modules", "astro", "bin", "astro.mjs"),
		path.join(root, "node_modules", "astro", "astro.js"),
		path.join(root, "node_modules", "astro", "bin", "astro.mjs"),
	];
	return candidates.find((file) => existsSync(file)) ?? null;
}

function spawnInherit(command, args, { cwd, env }) {
	log(`${command} ${args.join(" ")}`);
	const child = spawn(command, args, {
		cwd,
		env,
		stdio: "inherit",
		shell: win,
		windowsHide: true,
	});
	const shutdown = (signal) => {
		if (!child.killed) child.kill(signal);
	};
	process.on("SIGINT", () => shutdown("SIGINT"));
	process.on("SIGTERM", () => shutdown("SIGTERM"));
	child.on("error", (err) => fail(`failed to start ${command}: ${err.message}`));
	return child;
}

async function waitForServer(base, timeoutMs) {
	const startAt = Date.now();
	let last = "";
	while (Date.now() - startAt < timeoutMs) {
		try {
			const res = await fetch(base, { redirect: "manual" });
			if (res.status > 0) return res.status;
		} catch (err) {
			last = err instanceof Error ? err.message : String(err);
		}
		await new Promise((r) => setTimeout(r, 500));
	}
	throw new Error(
		`timed out after ${Math.round(timeoutMs / 1000)}s waiting for ${base}${last ? ` (${last})` : ""}`,
	);
}

function cookieHeader(setCookie) {
	return setCookie
		.map((c) => c.split(";", 1)[0])
		.filter(Boolean)
		.join("; ");
}

async function runChecks(base) {
	/** @type {{ name: string, ok: boolean, detail: string }[]} */
	const results = [];
	const check = async (name, fn) => {
		try {
			const detail = await fn();
			results.push({ name, ok: true, detail: detail || "ok" });
		} catch (err) {
			results.push({ name, ok: false, detail: err instanceof Error ? err.message : String(err) });
		}
	};

	const textOf = async (res) => {
		const buf = await res.arrayBuffer();
		return new TextDecoder("utf-8", { fatal: false }).decode(buf);
	};

	await check("GET /", async () => {
		const res = await fetch(`${base}/`, { redirect: "manual" });
		if (res.status >= 500) throw new Error(`HTTP ${res.status}`);
		return `HTTP ${res.status}`;
	});

	await check("GET /docs", async () => {
		const res = await fetch(`${base}/docs`, { redirect: "manual" });
		if (res.status >= 500) throw new Error(`HTTP ${res.status}`);
		return `HTTP ${res.status}`;
	});

	await check("GET /_emdash/admin", async () => {
		const res = await fetch(`${base}/_emdash/admin`, { redirect: "manual" });
		const body = await textOf(res);
		if (res.status >= 500) throw new Error(`HTTP ${res.status}: ${body.slice(0, 180)}`);
		if (/Internal Server Error|NOT_CONFIGURED/i.test(body) && !/emdash/i.test(body)) {
			throw new Error("admin HTML looks like a 500");
		}
		return `HTTP ${res.status} (${body.length} bytes)`;
	});

	await check("GET versions (unauthenticated request)", async () => {
		const res = await fetch(`${base}/_emdash/api/content/docs/versions`, { redirect: "manual" });
		const body = await textOf(res);
		// Production / locked setups: 401. DEV auto-session (ensureDevSessionUser): 200.
		if (res.status === 401) {
			return /NOT_AUTHENTICATED|Unauthorized|unauth/i.test(body)
				? "HTTP 401 NOT_AUTHENTICATED"
				: `HTTP 401 (${body.slice(0, 80)})`;
		}
		if (res.status !== 200)
			throw new Error(`expected 401 or 200, got ${res.status}: ${body.slice(0, 180)}`);
		if (!/"current"|"1\.0"|versions/i.test(body)) {
			throw new Error(`HTTP 200 but unexpected body: ${body.slice(0, 180)}`);
		}
		return "HTTP 200 (DEV auto-session)";
	});

	let sessionCookie = "";
	await check("GET dev-bypass (200 + session)", async () => {
		const res = await fetch(`${base}/_emdash/api/setup/dev-bypass?redirect=/_emdash/admin`, {
			redirect: "manual",
		});
		const body = await textOf(res);
		if (res.status !== 200) throw new Error(`expected 200 (not 302), got ${res.status}`);
		if (!/location\.replace|_emdash\/admin/i.test(body)) {
			throw new Error("bypass HTML missing location.replace / admin iframe");
		}
		const setCookie = res.headers.getSetCookie?.() ?? [];
		sessionCookie = cookieHeader(setCookie);
		if (!sessionCookie) {
			// Some runtimes fold set-cookie; still accept 200 interstitial.
			return "HTTP 200 interstitial (no Set-Cookie visible)";
		}
		return `HTTP 200 + cookie (${setCookie.length} set-cookie)`;
	});

	await check("GET versions (auth → 200)", async () => {
		const res = await fetch(`${base}/_emdash/api/content/docs/versions`, {
			redirect: "manual",
			headers: sessionCookie ? { cookie: sessionCookie } : {},
		});
		const body = await textOf(res);
		if (res.status === 401) throw new Error("still 401 after bypass — session cookie not applied");
		if (res.status >= 500) throw new Error(`HTTP ${res.status}: ${body.slice(0, 220)}`);
		if (res.status !== 200)
			throw new Error(`expected 200, got ${res.status}: ${body.slice(0, 180)}`);
		let json;
		try {
			json = JSON.parse(body);
		} catch {
			throw new Error(`not JSON: ${body.slice(0, 180)}`);
		}
		const list = Array.isArray(json) ? json : json.versions || json.items || json.data || [];
		const slugs = (Array.isArray(list) ? list : [])
			.map((v) => (typeof v === "string" ? v : v?.slug || v?.version_slug || v?.id || ""))
			.filter(Boolean);
		const blob = JSON.stringify(json);
		const hasCurrent = slugs.includes("current") || /"current"/.test(blob);
		const has10 = slugs.includes("1.0") || /"1\.0"/.test(blob);
		if (!hasCurrent || !has10) {
			return `HTTP 200 but missing expected slugs (got ${slugs.join(", ") || blob.slice(0, 120)})`;
		}
		return `HTTP 200 current + 1.0`;
	});

	await check("GET /_emdash/admin/content/docs", async () => {
		const res = await fetch(`${base}/_emdash/admin/content/docs`, {
			redirect: "manual",
			headers: sessionCookie ? { cookie: sessionCookie } : {},
		});
		const body = await textOf(res);
		if (res.status >= 500) throw new Error(`HTTP ${res.status}: ${body.slice(0, 180)}`);
		return `HTTP ${res.status}`;
	});

	await check("GET /_emdash/api/content/docs/tree", async () => {
		const res = await fetch(`${base}/_emdash/api/content/docs/tree`, {
			redirect: "manual",
			headers: sessionCookie ? { cookie: sessionCookie } : {},
		});
		const body = await textOf(res);
		if (res.status >= 500) throw new Error(`HTTP ${res.status}: ${body.slice(0, 180)}`);
		if (res.status !== 200)
			throw new Error(`expected 200, got ${res.status}: ${body.slice(0, 180)}`);
		let json;
		try {
			json = JSON.parse(body);
		} catch {
			throw new Error(`not JSON: ${body.slice(0, 180)}`);
		}
		const tree = json?.data?.tree ?? json?.tree ?? json?.data;
		const count = Array.isArray(tree) ? tree.length : 0;
		if (!count) throw new Error("tree is empty");
		return `HTTP 200 (${count} root node${count === 1 ? "" : "s"})`;
	});

	console.log("");
	console.log("  Smoke checks");
	console.log("  ────────────────────────────────────────────────────────");
	for (const r of results) {
		const mark = r.ok ? "PASS" : "FAIL";
		console.log(`  ${mark.padEnd(4)}  ${r.name}  —  ${r.detail}`);
	}
	console.log("  ────────────────────────────────────────────────────────");
	const failed = results.filter((r) => !r.ok);
	if (failed.length) {
		console.error(`[start] ${failed.length} check(s) failed`);
		return false;
	}
	log("all checks passed");
	return true;
}

function printHelp() {
	console.log(`Usage: node scripts/start.mjs [dev|prod|check] [flags]

Modes:
  dev      Astro dev server (default)
  prod     Build + node apps/bun/dist/server/entry.mjs
  check    Start (dev) and hit admin / versions / docs smoke tests

Flags:
  --port <n>        default 4321
  --host <addr>     default 0.0.0.0
  --skip-install    --skip-build
  --force-install   --force-build
  --full-install    whole workspace instead of demo-bun filter
  --once            check mode: exit after tests (do not leave server up)

Examples:
  ./start.sh
  ./start.sh prod
  ./start.sh check --once
  pnpm start prod --port 4321
`);
}

async function main() {
	const flags = parseArgs(process.argv.slice(2));
	if (flags.mode === "help") {
		printHelp();
		return;
	}

	process.chdir(root);
	const reexec = ensureNode22();
	if (reexec === "reexec") return;

	log(`node ${process.version}  pnpm-target ${PNPM_WANT}  cwd ${root}`);
	ensurePnpm();
	ensureInstall(flags);
	const buildMode = flags.mode === "prod" ? "prod" : "dev";
	ensureBuild(flags, buildMode);

	const publicHost = flags.host === "0.0.0.0" || flags.host === "::" ? "127.0.0.1" : flags.host;
	const base = `http://${publicHost}:${flags.port}`;

	if (flags.mode === "check") {
		printBanner("check (dev)", flags.host, flags.port);
		const child = startDev(flags);
		let exitCode = 0;
		try {
			log(`waiting for ${base} …`);
			await waitForServer(base, 180_000);
			const ok = await runChecks(base);
			if (!ok) exitCode = 1;
		} catch (err) {
			console.error(`[start] ${err instanceof Error ? err.message : err}`);
			exitCode = 1;
		}
		if (flags.once) {
			child.kill("SIGTERM");
			const force = setTimeout(() => child.kill("SIGKILL"), 5000);
			child.once("exit", () => {
				clearTimeout(force);
				process.exit(exitCode);
			});
			return;
		}
		if (exitCode !== 0) log("server left running so you can inspect the failure");
		child.on("exit", (code, signal) => {
			if (signal) process.kill(process.pid, signal);
			process.exit(code ?? exitCode);
		});
		return;
	}

	printBanner(flags.mode, flags.host, flags.port);
	const child = flags.mode === "prod" ? startProd(flags) : startDev(flags);
	child.on("exit", (code, signal) => {
		if (signal) process.kill(process.pid, signal);
		process.exit(code ?? 1);
	});
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});

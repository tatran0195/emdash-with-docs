/**
 * SQLite runtime adapter
 *
 * Creates a Kysely dialect. Driver selection (first match):
 *   1. `bun:sqlite` when running under Bun
 *   2. `node:sqlite` (`DatabaseSync`) when the module is available
 *   3. `better-sqlite3` as the last-resort native addon
 *
 * Kysely's SqliteDialect expects the better-sqlite3 statement shape
 * (`reader` + `all`/`run`/`iterate` taking a parameter *array*).
 * bun:sqlite and node:sqlite take spread bindings, so they are wrapped.
 */

import { type Dialect, SqliteDialect } from "kysely";

import type { SqliteConfig } from "./adapters.js";

export type SqliteBackend = "bun:sqlite" | "node:sqlite" | "better-sqlite3";

/** Subset of better-sqlite3 that Kysely's SqliteDialect calls. */
interface KyselySqliteDatabase {
	close(): void;
	prepare(sql: string): {
		readonly reader: boolean;
		all(parameters: ReadonlyArray<unknown>): unknown[];
		run(parameters: ReadonlyArray<unknown>): {
			changes: number | bigint;
			lastInsertRowid: number | bigint;
		};
		iterate(parameters: ReadonlyArray<unknown>): IterableIterator<unknown>;
	};
}

export function isBunRuntime(): boolean {
	return typeof process.versions.bun === "string";
}

/** True when `node:sqlite` exports `DatabaseSync` (Node 22.5+). */
export async function isNodeSqliteAvailable(): Promise<boolean> {
	try {
		const mod = await import("node:sqlite");
		return typeof (mod as { DatabaseSync?: unknown }).DatabaseSync === "function";
	} catch {
		return false;
	}
}

/**
 * Which backend `createDialect` will pick in this process.
 * Useful for logs and tests; does not open a database.
 */
export async function detectSqliteBackend(): Promise<SqliteBackend> {
	if (isBunRuntime()) return "bun:sqlite";
	if (await isNodeSqliteAvailable()) return "node:sqlite";
	return "better-sqlite3";
}

export function parseSqliteFilePath(url: string): string {
	return url.startsWith("file:") ? url.slice("file:".length) : url;
}

/** SELECT / WITH / PRAGMA / EXPLAIN / VALUES, or any statement with RETURNING. */
export function sqliteStatementIsReader(sql: string): boolean {
	const trimmed = sql.trimStart().toLowerCase();
	if (
		trimmed.startsWith("select") ||
		trimmed.startsWith("with") ||
		trimmed.startsWith("pragma") ||
		trimmed.startsWith("explain") ||
		trimmed.startsWith("values")
	) {
		return true;
	}
	return /\breturning\b/.test(trimmed);
}

function wrapSpreadStatement(stmt: {
	all: (...params: unknown[]) => unknown[];
	run: (...params: unknown[]) => { changes?: number | bigint; lastInsertRowid?: number | bigint };
	iterate?: (...params: unknown[]) => IterableIterator<unknown>;
	finalize?: () => void;
	reader?: boolean;
}): KyselySqliteDatabase["prepare"] extends (sql: string) => infer S ? S : never {
	return {
		get reader() {
			return stmt.reader === true;
		},
		all(parameters) {
			return stmt.all(...parameters);
		},
		run(parameters) {
			const result = stmt.run(...parameters);
			return {
				changes: result.changes ?? 0,
				lastInsertRowid: result.lastInsertRowid ?? 0,
			};
		},
		iterate(parameters) {
			if (!stmt.iterate) {
				return stmt.all(...parameters)[Symbol.iterator]();
			}
			return stmt.iterate(...parameters);
		},
	};
}

async function openBunSqlite(filePath: string): Promise<KyselySqliteDatabase> {
	const { Database } = await import("bun:sqlite");
	const database = new Database(filePath);
	return {
		close: () => database.close(),
		prepare(sql: string) {
			const stmt = database.prepare(sql);
			return wrapSpreadStatement({
				reader: sqliteStatementIsReader(sql),
				all: (...params) => stmt.all(...params) as unknown[],
				run: (...params) => {
					const info = stmt.run(...params) as {
						changes?: number;
						lastInsertRowid?: number | bigint;
					};
					return {
						changes: info.changes ?? 0,
						lastInsertRowid: info.lastInsertRowid ?? 0,
					};
				},
				iterate: (...params) =>
					(stmt.iterate
						? stmt.iterate(...params)
						: stmt.all(...params)[Symbol.iterator]()) as IterableIterator<unknown>,
			});
		},
	};
}

async function openNodeSqlite(filePath: string): Promise<KyselySqliteDatabase> {
	const { DatabaseSync } = await import("node:sqlite");
	const database = new DatabaseSync(filePath);
	return {
		close: () => database.close(),
		prepare(sql: string) {
			const stmt = database.prepare(sql);
			return wrapSpreadStatement({
				reader: sqliteStatementIsReader(sql),
				all: (...params) => stmt.all(...params) as unknown[],
				run: (...params) => {
					const info = stmt.run(...params);
					return {
						changes: (info.changes as number | bigint | undefined) ?? 0,
						lastInsertRowid: (info.lastInsertRowid as number | bigint | undefined) ?? 0,
					};
				},
				iterate: (...params) => stmt.iterate(...params) as IterableIterator<unknown>,
			});
		},
	};
}

async function openBetterSqlite3(filePath: string): Promise<KyselySqliteDatabase> {
	const { default: BetterSqlite3 } = await import("better-sqlite3");
	const database = new BetterSqlite3(filePath);
	return database as unknown as KyselySqliteDatabase;
}

function applySqlitePragmas(database: KyselySqliteDatabase, filePath: string): void {
	// PRAGMA returns a row, so go through `all` (reader).
	if (filePath !== ":memory:") {
		database.prepare("PRAGMA journal_mode = WAL").all([]);
	}
	database.prepare("PRAGMA foreign_keys = ON").all([]);
}

export async function openSqliteDatabase(
	config: SqliteConfig,
): Promise<{ backend: SqliteBackend; database: KyselySqliteDatabase }> {
	const filePath = parseSqliteFilePath(config.url);
	const backend = await detectSqliteBackend();

	const database =
		backend === "bun:sqlite"
			? await openBunSqlite(filePath)
			: backend === "node:sqlite"
				? await openNodeSqlite(filePath)
				: await openBetterSqlite3(filePath);

	applySqlitePragmas(database, filePath);
	return { backend, database };
}

/**
 * Create a SQLite dialect from config.
 *
 * Driver is chosen lazily on the first query so config-time evaluation
 * (astro.config) does not load a native addon.
 */
export function createDialect(config: SqliteConfig): Dialect {
	return new SqliteDialect({
		database: async () => {
			const { backend, database } = await openSqliteDatabase(config);
			console.info(`[emdash] sqlite driver: ${backend}`);
			return database;
		},
	});
}

import { describe, expect, it } from "vitest";

import {
	detectSqliteBackend,
	isBunRuntime,
	isNodeSqliteAvailable,
	openSqliteDatabase,
	parseSqliteFilePath,
	sqliteStatementIsReader,
} from "../../../src/db/sqlite.js";

describe("sqlite driver selection", () => {
	it("strips the file: prefix from sqlite URLs", () => {
		expect(parseSqliteFilePath("file:./data.db")).toBe("./data.db");
		expect(parseSqliteFilePath("./data.db")).toBe("./data.db");
	});

	it("classifies reader vs writer statements the way better-sqlite3.reader does", () => {
		expect(sqliteStatementIsReader("SELECT 1")).toBe(true);
		expect(sqliteStatementIsReader("  with x as (select 1) select * from x")).toBe(true);
		expect(sqliteStatementIsReader("PRAGMA table_info(t)")).toBe(true);
		expect(sqliteStatementIsReader("INSERT INTO t (a) VALUES (1) RETURNING id")).toBe(true);
		expect(sqliteStatementIsReader("INSERT INTO t (a) VALUES (1)")).toBe(false);
		expect(sqliteStatementIsReader("UPDATE t SET a = 1")).toBe(false);
	});

	it("never reports bun:sqlite when process.versions.bun is unset", async () => {
		expect(isBunRuntime()).toBe(false);
		const backend = await detectSqliteBackend();
		expect(backend === "node:sqlite" || backend === "better-sqlite3").toBe(true);
	});

	it("opens an in-memory database with the selected backend and runs SQL", async () => {
		const { backend, database } = await openSqliteDatabase({ url: ":memory:" });
		expect(backend === "node:sqlite" || backend === "better-sqlite3").toBe(true);

		database.prepare("CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT)").run([]);
		database.prepare("INSERT INTO t (name) VALUES (?)").run(["hello"]);
		const rows = database.prepare("SELECT name FROM t").all([]) as Array<{ name: string }>;
		expect(rows).toEqual([{ name: "hello" }]);
		database.close();
	});

	it("detects node:sqlite when DatabaseSync is exported", async () => {
		const available = await isNodeSqliteAvailable();
		const backend = await detectSqliteBackend();
		if (available) {
			expect(backend).toBe("node:sqlite");
		} else {
			expect(backend).toBe("better-sqlite3");
		}
	});
});

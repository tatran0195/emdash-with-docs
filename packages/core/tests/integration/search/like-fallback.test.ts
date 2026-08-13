import type { Kysely } from "kysely";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ContentRepository } from "../../../src/database/repositories/content.js";
import type { Database } from "../../../src/database/types.js";
import { SchemaRegistry } from "../../../src/schema/registry.js";
import { FTSManager } from "../../../src/search/fts-manager.js";
import { getSuggestions, searchWithDb } from "../../../src/search/query.js";
import { createPostFixture } from "../../utils/fixtures.js";
import { setupTestDatabaseWithCollections, teardownTestDatabase } from "../../utils/test-db.js";

/**
 * Public `search()` / `searchCollection()` prefer FTS5 MATCH + BM25. When the
 * virtual table is missing they must still return results via LIKE — otherwise
 * Postgres, a collection enabled before its index is built, or a dropped
 * `_emdash_fts_*` table silently serve an empty site search.
 */
describe("search LIKE fallback when FTS5 is not configured", () => {
	let db: Kysely<Database>;
	let repo: ContentRepository;
	let fts: FTSManager;

	beforeEach(async () => {
		db = await setupTestDatabaseWithCollections();
		repo = new ContentRepository(db);
		fts = new FTSManager(db);

		const registry = new SchemaRegistry(db);
		await registry.updateField("post", "title", { searchable: true });
		await registry.updateField("post", "content", { searchable: true });

		// Mark search enabled without creating the FTS virtual table.
		await fts.setSearchConfig("post", { enabled: true });

		await repo.create(
			createPostFixture({
				slug: "getting-started",
				status: "published",
				data: { title: "Needle Headline" },
			}),
		);
		await repo.create(
			createPostFixture({
				slug: "unrelated",
				status: "published",
				data: { title: "Something else entirely" },
			}),
		);
		await repo.create(
			createPostFixture({
				slug: "draft-only",
				status: "draft",
				data: { title: "Needle draft" },
			}),
		);
	});

	afterEach(async () => {
		await teardownTestDatabase(db);
	});

	it("finds mid-word title matches that FTS5 token search would miss", async () => {
		const { items } = await searchWithDb(db, "eedle", { collections: ["post"] });
		expect(items.map((item) => item.slug)).toEqual(["getting-started"]);
		expect(items[0]!.title).toBe("Needle Headline");
		expect(items[0]!.score).toBeGreaterThan(0);
	});

	it("wraps the matched term in a sanitized <mark> snippet", async () => {
		const { items } = await searchWithDb(db, "Needle", { collections: ["post"] });
		expect(items).toHaveLength(1);
		expect(items[0]!.snippet).toMatch(/<mark>Needle<\/mark>/);
	});

	it("escapes HTML in LIKE snippets the same way FTS5 snippets are sanitized", async () => {
		await repo.create(
			createPostFixture({
				slug: "xss",
				status: "published",
				data: { title: "Hello <script>alert(1)</script> world" },
			}),
		);

		const { items } = await searchWithDb(db, "script", { collections: ["post"] });
		expect(items).toHaveLength(1);
		const snippet = items[0]!.snippet ?? "";
		expect(snippet).not.toContain("<script>");
		expect(snippet).toContain("&lt;");
		expect(snippet).toContain("&gt;");
		expect(snippet).toMatch(/<mark>script<\/mark>/i);
	});

	it("treats LIKE wildcards in the query literally", async () => {
		await repo.create(
			createPostFixture({
				slug: "percent-off",
				status: "published",
				data: { title: "Save 50% today" },
			}),
		);

		const wildcard = await searchWithDb(db, "%", { collections: ["post"] });
		expect(wildcard.items.map((item) => item.slug)).toEqual(["percent-off"]);

		const noMatch = await searchWithDb(db, "Needl_", { collections: ["post"] });
		expect(noMatch.items).toHaveLength(0);
	});

	it("still finds matches after the FTS table is dropped", async () => {
		await fts.enableSearch("post");
		expect(await fts.ftsTableExists("post")).toBe(true);
		await fts.dropFtsTable("post");
		expect(await fts.ftsTableExists("post")).toBe(false);

		const { items } = await searchWithDb(db, "Needle", { collections: ["post"] });
		expect(items.map((item) => item.slug)).toEqual(["getting-started"]);
	});

	it("suggests titles via LIKE prefix when the FTS table is missing", async () => {
		const suggestions = await getSuggestions(db, "Need", { collections: ["post"] });
		expect(suggestions.map((item) => item.title)).toEqual(["Needle Headline"]);
	});

	it("does not return drafts through the LIKE fallback", async () => {
		const { items } = await searchWithDb(db, "draft", { collections: ["post"] });
		expect(items).toHaveLength(0);
	});
});

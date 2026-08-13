import Database from "better-sqlite3";
import { Kysely, SqliteDialect } from "kysely";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ContentRepository } from "../../../src/database/repositories/content.js";
import { runMigrations } from "../../../src/database/migrations/runner.js";
import type { Database as EmDashDatabase } from "../../../src/database/types.js";
import { SchemaRegistry } from "../../../src/schema/registry.js";

describe("hierarchical docs collection", () => {
	let db: Kysely<EmDashDatabase>;
	let registry: SchemaRegistry;
	let repo: ContentRepository;

	beforeEach(async () => {
		const sqlite = new Database(":memory:");
		db = new Kysely<EmDashDatabase>({
			dialect: new SqliteDialect({ database: sqlite }),
		});
		await runMigrations(db);
		registry = new SchemaRegistry(db);
		repo = new ContentRepository(db);
	});

	afterEach(async () => {
		await db.destroy();
	});

	it("creates a docs tree beside pages and posts", async () => {
		await registry.createCollection({
			slug: "pages",
			label: "Pages",
			supports: ["drafts"],
			urlPattern: "/{slug}",
		});
		await registry.createCollection({
			slug: "posts",
			label: "Posts",
			supports: ["drafts"],
			urlPattern: "/posts/{slug}",
		});
		const docs = await registry.createCollection({
			slug: "docs",
			label: "Docs",
			supports: ["drafts", "hierarchical"],
			urlPattern: "/docs/{path}",
		});
		expect(docs.supports).toContain("hierarchical");

		await registry.createField("docs", { slug: "title", label: "Title", type: "string" });
		await registry.createField("pages", { slug: "title", label: "Title", type: "string" });

		const about = await repo.create({
			type: "pages",
			slug: "about",
			status: "published",
			data: { title: "About" },
		});
		expect(about.path).toBeNull();

		const guides = await repo.create({
			type: "docs",
			slug: "guides",
			status: "published",
			nodeKind: "section",
			data: { title: "Guides" },
		});
		expect(guides.path).toBe("guides");
		expect(guides.nodeKind).toBe("section");

		const install = await repo.create({
			type: "docs",
			slug: "install",
			status: "published",
			parentId: guides.translationGroup,
			data: { title: "Install" },
		});
		expect(install.path).toBe("guides/install");
		expect(install.parentId).toBe(guides.translationGroup);

		const config = await repo.create({
			type: "docs",
			slug: "config",
			status: "published",
			parentId: guides.translationGroup,
			data: { title: "Configure" },
		});
		expect(config.path).toBe("guides/config");

		const byPath = await repo.findByPath("docs", "guides/install");
		expect(byPath?.id).toBe(install.id);

		const tree = await repo.findTree("docs", { status: "published" });
		expect(tree).toHaveLength(1);
		expect(tree[0].path).toBe("guides");
		expect(tree[0].kind).toBe("section");
		expect(tree[0].children.map((c) => c.slug)).toEqual(["install", "config"]);

		await expect(
			repo.create({
				type: "docs",
				slug: "install",
				parentId: guides.translationGroup,
				data: { title: "Install again" },
			}),
		).rejects.toThrow(/sibling/i);

		const overview = await repo.create({
			type: "docs",
			slug: "install",
			status: "published",
			data: { title: "Root install" },
		});
		expect(overview.path).toBe("install");

		await expect(repo.delete("docs", guides.id)).rejects.toThrow(/children/i);

		await repo.update("docs", guides.id, { slug: "howto" });
		const moved = await repo.findByPath("docs", "howto/install");
		expect(moved?.id).toBe(install.id);
		expect(await repo.findByPath("docs", "guides/install")).toBeNull();
	});

	it("rejects versioned without hierarchical", async () => {
		await expect(
			registry.createCollection({
				slug: "broken",
				label: "Broken",
				supports: ["versioned"],
			}),
		).rejects.toThrow(/hierarchical/i);
	});

	it("cuts a frozen version snapshot with remapped groups", async () => {
		await registry.createCollection({
			slug: "docs",
			label: "Docs",
			supports: ["drafts", "hierarchical", "versioned"],
			urlPattern: "/docs/{path}",
		});
		await registry.createField("docs", { slug: "title", label: "Title", type: "string" });

		const guides = await repo.create({
			type: "docs",
			slug: "guides",
			status: "published",
			nodeKind: "section",
			data: { title: "Guides" },
		});
		const install = await repo.create({
			type: "docs",
			slug: "install",
			status: "published",
			parentId: guides.translationGroup,
			data: { title: "Install" },
		});

		const { version, copies } = await repo.cutVersion("docs", { slug: "1.0", label: "1.0" });
		expect(version.slug).toBe("1.0");
		expect(version.isFrozen).toBe(true);
		expect(copies).toHaveLength(2);

		const currentGuides = await repo.findByPath("docs", "guides", { versionSlug: "current" });
		expect(currentGuides?.id).toBe(guides.id);

		const frozenGuides = await repo.findByPath("docs", "guides", { versionSlug: "1.0" });
		expect(frozenGuides).not.toBeNull();
		expect(frozenGuides?.id).not.toBe(guides.id);
		expect(frozenGuides?.translationGroup).not.toBe(guides.translationGroup);
		expect(frozenGuides?.versionSlug).toBe("1.0");

		const frozenInstall = await repo.findByPath("docs", "guides/install", { versionSlug: "1.0" });
		expect(frozenInstall).not.toBeNull();
		expect(frozenInstall?.parentId).toBe(frozenGuides?.translationGroup);
		expect(frozenInstall?.id).not.toBe(install.id);

		await expect(repo.update("docs", frozenGuides!.id, { slug: "howto" })).rejects.toThrow(/frozen/i);
		await expect(repo.delete("docs", frozenInstall!.id)).rejects.toThrow(/frozen/i);

		await expect(repo.cutVersion("docs", { slug: "1.0", label: "1.0 again" })).rejects.toThrow(
			/already exists/i,
		);

		const renamed = await repo.update("docs", guides.id, { slug: "howto" });
		expect(renamed.path).toBe("howto");
		expect(await repo.findByPath("docs", "howto/install", { versionSlug: "current" })).not.toBeNull();
		expect(await repo.findByPath("docs", "guides/install", { versionSlug: "1.0" })).not.toBeNull();
	});
});

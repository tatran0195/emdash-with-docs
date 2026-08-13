import { describe, it, expect } from "vitest";

import {
	applySiblingReorder,
	assertNoChildren,
	assertNoCycle,
	assertSiblingSlugUnique,
	availableParents,
	breadcrumbs,
	buildTree,
	computePath,
	flattenTree,
	neighbors,
	rebuildPaths,
	rowFromPartial,
	TreeError,
} from "../../../src/content/tree.js";
import {
	contentUrl,
	interpolateUrlPattern,
	matchUrlPath,
	patternToRegex,
	validateUrlPattern,
	withOptionalVersionPrefix,
	UrlPatternError,
} from "../../../src/content/url-pattern.js";

function sample() {
	const guides = rowFromPartial({
		id: "g",
		slug: "guides",
		title: "Guides",
		nodeKind: "section",
		path: "guides",
		sortOrder: 0,
	});
	const install = rowFromPartial({
		id: "i",
		slug: "install",
		title: "Install",
		parentId: "g",
		path: "guides/install",
		sortOrder: 0,
	});
	const config = rowFromPartial({
		id: "c",
		slug: "config",
		title: "Configure",
		parentId: "g",
		path: "guides/config",
		sortOrder: 1,
	});
	const reference = rowFromPartial({
		id: "r",
		slug: "reference",
		title: "Reference",
		nodeKind: "section",
		path: "reference",
		sortOrder: 1,
	});
	const cli = rowFromPartial({
		id: "cli",
		slug: "cli",
		title: "CLI",
		parentId: "r",
		path: "reference/cli",
	});
	return { guides, install, config, reference, cli, rows: [guides, install, config, reference, cli] };
}

describe("buildTree", () => {
	it("nests children under the parent's translation group", () => {
		const { rows } = sample();
		const tree = buildTree(rows);
		expect(tree).toHaveLength(2);
		expect(tree[0].path).toBe("guides");
		expect(tree[0].kind).toBe("section");
		expect(tree[0].children.map((c) => c.slug)).toEqual(["install", "config"]);
		expect(tree[1].children[0].path).toBe("reference/cli");
	});

	it("promotes stranded children (missing parent locale) to root", () => {
		const child = rowFromPartial({
			id: "orphan",
			slug: "orphan",
			title: "Orphan",
			parentId: "missing-group",
			path: "orphan",
		});
		const tree = buildTree([child]);
		expect(tree).toHaveLength(1);
		expect(tree[0].stranded).toBe(true);
		expect(tree[0].slug).toBe("orphan");
	});
});

describe("flatten / crumbs / neighbors", () => {
	it("DFS pre-order includes sections (folder-as-page)", () => {
		const tree = buildTree(sample().rows);
		expect(flattenTree(tree).map((n) => n.path)).toEqual([
			"guides",
			"guides/install",
			"guides/config",
			"reference",
			"reference/cli",
		]);
	});

	it("breadcrumbs follow tree position", () => {
		const crumbs = breadcrumbs(buildTree(sample().rows), "guides/config");
		expect(crumbs.map((c) => c.path)).toEqual(["guides", "guides/config"]);
	});

	it("prev/next walk the flattened sidebar", () => {
		const { prev, next } = neighbors(buildTree(sample().rows), "guides/config");
		expect(prev?.path).toBe("guides/install");
		expect(next?.path).toBe("reference");
	});
});

describe("cycle + path", () => {
	it("rejects reparenting under a descendant", () => {
		const { rows, guides } = sample();
		expect(() => assertNoCycle(rows, "g", "i")).toThrow(TreeError);
		expect(() => assertNoCycle(rows, guides.translationGroup, null)).not.toThrow();
	});

	it("rebuilds descendant paths when a slug changes", () => {
		const { rows } = sample();
		const renamed = rows.map((r) => (r.id === "g" ? { ...r, slug: "howto" } : r));
		const next = rebuildPaths(renamed, "g");
		expect(next.find((r) => r.id === "g")?.path).toBe("howto");
		expect(next.find((r) => r.id === "i")?.path).toBe("howto/install");
		expect(next.find((r) => r.id === "c")?.path).toBe("howto/config");
		expect(next.find((r) => r.id === "cli")?.path).toBe("reference/cli");
	});

	it("computePath joins ancestor slugs", () => {
		const { rows, cli } = sample();
		expect(computePath(rows, cli)).toBe("reference/cli");
	});
});

describe("sibling uniqueness + reorder + delete", () => {
	it("allows the same slug under different parents", () => {
		const { rows } = sample();
		expect(() =>
			assertSiblingSlugUnique(rows, {
				id: "new",
				slug: "install",
				parentId: "r",
				locale: "en",
				versionSlug: "current",
			}),
		).not.toThrow();
	});

	it("rejects the same slug among siblings", () => {
		const { rows } = sample();
		expect(() =>
			assertSiblingSlugUnique(rows, {
				id: "new",
				slug: "install",
				parentId: "g",
				locale: "en",
				versionSlug: "current",
			}),
		).toThrow(TreeError);
	});

	it("reorder requires the exact sibling set", () => {
		const { rows } = sample();
		const next = applySiblingReorder(rows, "g", ["c", "i"], "en", "current");
		expect(next.find((r) => r.id === "c")?.sortOrder).toBe(0);
		expect(next.find((r) => r.id === "i")?.sortOrder).toBe(1);
		expect(() => applySiblingReorder(rows, "g", ["c"], "en", "current")).toThrow(TreeError);
	});

	it("blocks deleting a section that still has children", () => {
		const { rows } = sample();
		expect(() => assertNoChildren(rows, "g")).toThrow(TreeError);
		expect(() => assertNoChildren(rows, "i")).not.toThrow();
	});

	it("availableParents excludes self and descendants", () => {
		const { rows, guides, reference } = sample();
		const opts = availableParents(rows, guides);
		expect(opts.every((r) => r.id !== "g" && r.id !== "i" && r.id !== "c")).toBe(true);
		expect(opts.some((r) => r.id === reference.id)).toBe(true);
	});
});

describe("urlPattern", () => {
	it("rejects bare /{path} and {path} not last", () => {
		expect(() => validateUrlPattern("/{path}")).toThrow(UrlPatternError);
		expect(() => validateUrlPattern("/{path}/edit")).toThrow(UrlPatternError);
		expect(() => validateUrlPattern("/docs/{path}")).not.toThrow();
		expect(() => validateUrlPattern("/blog/{slug}")).not.toThrow();
	});

	it("interpolates path and drops default version", () => {
		expect(
			interpolateUrlPattern("/docs/{version}/{path}", {
				version: "",
				path: "guides/install",
			}),
		).toBe("/docs/guides/install");
		expect(
			contentUrl("docs", { path: "guides/install", version: "current" }, "/docs/{version}/{path}"),
		).toBe("/docs/guides/install");
		expect(
			contentUrl("docs", { path: "guides/install", version: "1.2" }, "/docs/{version}/{path}"),
		).toBe("/docs/1.2/guides/install");
	});

	it("matches versioned then default patterns", () => {
		const patterns = withOptionalVersionPrefix("/docs/{path}").map((pattern) => {
			const { regex, paramNames } = patternToRegex(pattern);
			return { collection: "docs", pattern, regex, paramNames };
		});
		const known = new Map([["docs", new Set(["1.2", "current"])]]);
		const defaults = new Map([["docs", "current"]]);

		const versioned = matchUrlPath("/docs/1.2/guides/install", patterns, {
			knownVersions: known,
			defaultVersion: defaults,
		});
		expect(versioned?.params.version).toBe("1.2");
		expect(versioned?.params.path).toBe("guides/install");

		const current = matchUrlPath("/docs/guides/install", patterns, {
			knownVersions: known,
			defaultVersion: defaults,
		});
		expect(current?.params.version).toBe("current");
		expect(current?.params.path).toBe("guides/install");
	});
});

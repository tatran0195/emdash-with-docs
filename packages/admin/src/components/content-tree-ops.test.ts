import { describe, expect, it } from "vitest";

import type { DocTreeNode } from "../lib/api";
import {
	applyTreeMove,
	countTreeNodes,
	flattenVisible,
	planIndent,
	planOutdent,
	planReorder,
	planTreeMove,
} from "./content-tree-ops.js";

function node(
	id: string,
	kind: "doc" | "section",
	children: DocTreeNode[] = [],
): DocTreeNode {
	return {
		id,
		translationGroup: `tg-${id}`,
		slug: id,
		path: id,
		title: id,
		kind,
		status: "published",
		stranded: false,
		children,
	};
}

const sample: DocTreeNode[] = [
	node("guides", "section", [node("intro", "doc"), node("install", "doc")]),
	node("api", "section", [node("auth", "doc")]),
	node("faq", "doc"),
];

describe("content-tree-ops", () => {
	it("counts every nested node", () => {
		expect(countTreeNodes(sample)).toBe(6);
	});

	it("hides children of collapsed sections", () => {
		const flat = flattenVisible(sample, new Set());
		expect(flat.map((row) => row.id)).toEqual(["guides", "api", "faq"]);
	});

	it("nests a page under another page", () => {
		const flat = flattenVisible(sample, new Set(["guides"]));
		const move = planTreeMove(flat, "install", "intro", "inside");
		expect(move).toEqual({
			id: "install",
			fromParentId: "tg-guides",
			toParentId: "tg-intro",
			toSiblingIds: ["install"],
		});
		const next = applyTreeMove(sample, move!);
		const intro = next[0]?.children.find((child) => child.id === "intro");
		expect(intro?.children.map((child) => child.id)).toEqual(["install"]);
	});

	it("refuses to drop a section into its own descendant", () => {
		const flat = flattenVisible(sample, new Set(["guides"]));
		expect(planTreeMove(flat, "guides", "intro", "inside")).toBeNull();
	});

	it("indents under the previous sibling", () => {
		const flat = flattenVisible(sample, new Set());
		const move = planIndent(flat, "api");
		expect(move?.toParentId).toBe("tg-guides");
		expect(move?.toSiblingIds).toContain("api");
	});

	it("outdents to sit after the parent", () => {
		const flat = flattenVisible(sample, new Set(["guides"]));
		const move = planOutdent(flat, "intro");
		expect(move?.toParentId).toBeNull();
		expect(move?.toSiblingIds).toEqual(["guides", "intro", "api", "faq"]);
	});

	it("reorders siblings up", () => {
		const flat = flattenVisible(sample, new Set());
		const move = planReorder(flat, "api", -1);
		expect(move?.toSiblingIds).toEqual(["api", "guides", "faq"]);
	});
});

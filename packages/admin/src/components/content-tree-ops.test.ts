import { describe, expect, it } from "vitest";

import type { DocTreeNode } from "../lib/api";
import {
	applyTreeMove,
	arrayMove,
	countTreeNodes,
	flattenVisible,
	getProjection,
	planIndent,
	planMoveFromProjection,
	planOutdent,
	planReorder,
	planTreeMove,
	TREE_INDENT_PX,
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

	it("arrayMove inserts without mutating", () => {
		const input = ["a", "b", "c"];
		expect(arrayMove(input, 0, 2)).toEqual(["b", "c", "a"]);
		expect(input).toEqual(["a", "b", "c"]);
	});

	it("projects a right-drag as nest under the previous sibling", () => {
		const flat = flattenVisible(sample, new Set());
		const projection = getProjection(flat, "api", "api", TREE_INDENT_PX);
		expect(projection?.depth).toBe(1);
		expect(projection?.parentId).toBe("tg-guides");
		const move = planMoveFromProjection(flat, "api", projection!);
		expect(move?.toParentId).toBe("tg-guides");
		expect(move?.toSiblingIds).toContain("api");
	});

	it("projects a left-drag on the last child as an outdent", () => {
		const flat = flattenVisible(sample, new Set(["guides"]));
		const projection = getProjection(flat, "install", "install", -TREE_INDENT_PX);
		expect(projection?.depth).toBe(0);
		expect(projection?.parentId).toBeNull();
		const move = planMoveFromProjection(flat, "install", projection!);
		expect(move?.toParentId).toBeNull();
		expect(move?.toSiblingIds).toEqual(["guides", "install", "api", "faq"]);
	});

	it("keeps a middle child nested when the next sibling is still indented", () => {
		const flat = flattenVisible(sample, new Set(["guides"]));
		const projection = getProjection(flat, "intro", "intro", -TREE_INDENT_PX);
		expect(projection?.depth).toBe(1);
		expect(planMoveFromProjection(flat, "intro", projection!)).toBeNull();
	});

	it("projects a vertical drag as a same-level reorder", () => {
		const flat = flattenVisible(sample, new Set());
		const projection = getProjection(flat, "faq", "guides", 0);
		expect(projection?.depth).toBe(0);
		const move = planMoveFromProjection(flat, "faq", projection!);
		expect(move?.toParentId).toBeNull();
		expect(move?.toSiblingIds[0]).toBe("faq");
	});

	it("refuses to project a section into its own descendant", () => {
		const flat = flattenVisible(sample, new Set(["guides"]));
		expect(getProjection(flat, "guides", "intro", TREE_INDENT_PX)).toBeNull();
	});
});

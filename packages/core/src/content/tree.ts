/**
 * Pure tree algorithms for hierarchical collections.
 *
 * No DB, no Astro. Copy into packages/core/src/content/tree.ts and call
 * from ContentRepository / query.ts / admin.
 *
 * parentId is a translation_group (taxonomy/menu i18n pattern).
 */

import {
	MAX_TREE_DEPTH,
	type DocCrumb,
	type DocNeighbors,
	type DocNodeKind,
	type DocTreeNode,
	type TreeRow,
} from "./tree-types.js";

export class TreeError extends Error {
	constructor(
		message: string,
		readonly code:
			| "CYCLE"
			| "HAS_CHILDREN"
			| "SIBLING_SLUG_CONFLICT"
			| "MAX_DEPTH"
			| "PARENT_NOT_FOUND"
			| "REORDER_MISMATCH",
	) {
		super(message);
		this.name = "TreeError";
	}
}

export function nodeGroup(row: Pick<TreeRow, "translationGroup" | "id">): string {
	return row.translationGroup || row.id;
}

export function isStranded(row: Pick<TreeRow, "parentId">, renderedParentId: string | null): boolean {
	return renderedParentId === null && !!row.parentId;
}

/** Adjacency list keyed by parent translation_group (null = roots). */
export function childrenByParent(rows: TreeRow[]): Map<string | null, TreeRow[]> {
	const map = new Map<string | null, TreeRow[]>();
	const sorted = [...rows].toSorted((a, b) => {
		if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
		return a.id.localeCompare(b.id);
	});
	for (const row of sorted) {
		const key = row.parentId;
		const siblings = map.get(key) ?? [];
		siblings.push(row);
		map.set(key, siblings);
	}
	return map;
}

/**
 * Build a forest. Children whose parent is missing in this locale are
 * promoted to the root list and marked stranded (TaxonomyManager rule).
 */
export function buildTree(rows: TreeRow[]): DocTreeNode[] {
	const byGroup = new Map<string, TreeRow>();
	for (const row of rows) byGroup.set(nodeGroup(row), row);

	const grouped = childrenByParent(rows);
	const visited = new Set<string>();

	function toNode(row: TreeRow, stranded: boolean): DocTreeNode {
		visited.add(row.id);
		const kids = grouped.get(nodeGroup(row)) ?? [];
		return {
			id: row.id,
			translationGroup: nodeGroup(row),
			slug: row.slug,
			path: row.path,
			title: row.title,
			kind: row.nodeKind,
			status: row.status,
			stranded,
			children: kids.map((child) => toNode(child, false)),
		};
	}

	const roots: DocTreeNode[] = [];
	for (const row of grouped.get(null) ?? []) {
		roots.push(toNode(row, false));
	}
	// Stranded: parentId set but that group has no row in `rows`.
	for (const row of rows) {
		if (visited.has(row.id)) continue;
		if (row.parentId && !byGroup.has(row.parentId)) {
			roots.push(toNode(row, true));
		}
	}
	return roots;
}

/** Depth-first pre-order flatten. Sections participate (they are pages). */
export function flattenTree(nodes: DocTreeNode[]): DocTreeNode[] {
	const out: DocTreeNode[] = [];
	function walk(list: DocTreeNode[]) {
		for (const node of list) {
			out.push(node);
			walk(node.children);
		}
	}
	walk(nodes);
	return out;
}

export function findNode(nodes: DocTreeNode[], path: string): DocTreeNode | null {
	for (const node of flattenTree(nodes)) {
		if (node.path === path) return node;
	}
	return null;
}

export function breadcrumbs(nodes: DocTreeNode[], path: string): DocCrumb[] {
	const crumbs: DocCrumb[] = [];
	function walk(list: DocTreeNode[], trail: DocCrumb[]): boolean {
		for (const node of list) {
			const next = [
				...trail,
				{ id: node.id, title: node.title, path: node.path, kind: node.kind },
			];
			if (node.path === path) {
				crumbs.push(...next);
				return true;
			}
			if (walk(node.children, next)) return true;
		}
		return false;
	}
	walk(nodes, []);
	return crumbs;
}

export function neighbors(nodes: DocTreeNode[], path: string): DocNeighbors {
	const flat = flattenTree(nodes);
	const index = flat.findIndex((n) => n.path === path);
	if (index < 0) return { prev: null, next: null };
	return {
		prev: flat[index - 1] ?? null,
		next: flat[index + 1] ?? null,
	};
}

/**
 * Walk ancestors via parentId (translation_group). Returns groups from
 * parent up to root. Throws CYCLE / MAX_DEPTH.
 */
export function ancestorGroups(
	rows: TreeRow[],
	startParentId: string | null,
): string[] {
	if (!startParentId) return [];
	const byGroup = new Map<string, TreeRow>();
	for (const row of rows) byGroup.set(nodeGroup(row), row);

	const walked: string[] = [];
	const seen = new Set<string>();
	let current: string | null = startParentId;
	let steps = 0;
	while (current) {
		if (seen.has(current)) {
			throw new TreeError("Parent chain contains a cycle", "CYCLE");
		}
		if (steps++ >= MAX_TREE_DEPTH) {
			throw new TreeError(`Tree exceeds max depth of ${MAX_TREE_DEPTH}`, "MAX_DEPTH");
		}
		seen.add(current);
		walked.push(current);
		const row = byGroup.get(current);
		current = row?.parentId ?? null;
	}
	return walked;
}

export function assertNoCycle(
	rows: TreeRow[],
	nodeGroupId: string,
	proposedParentId: string | null,
): void {
	if (!proposedParentId) return;
	if (proposedParentId === nodeGroupId) {
		throw new TreeError("A node cannot be its own parent", "CYCLE");
	}
	const ancestors = ancestorGroups(rows, proposedParentId);
	if (ancestors.includes(nodeGroupId)) {
		throw new TreeError("Cannot reparent under a descendant", "CYCLE");
	}
}

export function computePath(rows: TreeRow[], row: TreeRow): string {
	const byGroup = new Map<string, TreeRow>();
	for (const r of rows) byGroup.set(nodeGroup(r), r);

	const segments: string[] = [row.slug];
	let current: string | null = row.parentId;
	const seen = new Set<string>();
	let steps = 0;
	while (current) {
		if (seen.has(current) || steps++ >= MAX_TREE_DEPTH) {
			throw new TreeError("Cannot compute path: cycle or max depth", "CYCLE");
		}
		seen.add(current);
		const parent = byGroup.get(current);
		if (!parent) break; // stranded — path is just the remaining suffix
		segments.unshift(parent.slug);
		current = parent.parentId;
	}
	return segments.join("/");
}

/** Rebuild path for `changed` and every descendant. Returns updated copies. */
export function rebuildPaths(rows: TreeRow[], changedId: string): TreeRow[] {
	const next = rows.map((r) => ({ ...r }));
	const byId = new Map(next.map((r) => [r.id, r]));
	const changed = byId.get(changedId);
	if (!changed) return next;

	changed.path = computePath(next, changed);

	const grouped = childrenByParent(next);
	const queue = [...(grouped.get(nodeGroup(changed)) ?? [])];
	while (queue.length) {
		const child = queue.shift()!;
		child.path = computePath(next, child);
		queue.push(...(grouped.get(nodeGroup(child)) ?? []));
	}
	return next;
}

export function assertSiblingSlugUnique(
	rows: TreeRow[],
	candidate: Pick<TreeRow, "id" | "slug" | "parentId" | "locale" | "versionSlug">,
): void {
	const clash = rows.find(
		(r) =>
			r.id !== candidate.id &&
			r.slug === candidate.slug &&
			r.parentId === candidate.parentId &&
			r.locale === candidate.locale &&
			r.versionSlug === candidate.versionSlug,
	);
	if (clash) {
		throw new TreeError(
			`Slug "${candidate.slug}" is already used by a sibling`,
			"SIBLING_SLUG_CONFLICT",
		);
	}
}

export function assertNoChildren(rows: TreeRow[], groupId: string): void {
	if (rows.some((r) => r.parentId === groupId)) {
		throw new TreeError("Cannot delete a node that still has children", "HAS_CHILDREN");
	}
}

/**
 * `ids` must be exactly the live sibling set for `parentId` (same
 * locale+version), in the desired order. Throws REORDER_MISMATCH otherwise.
 */
export function applySiblingReorder(
	rows: TreeRow[],
	parentId: string | null,
	ids: string[],
	locale: string,
	versionSlug: string,
): TreeRow[] {
	const siblings = rows.filter(
		(r) => r.parentId === parentId && r.locale === locale && r.versionSlug === versionSlug,
	);
	const current = new Set(siblings.map((r) => r.id));
	const next = new Set(ids);
	if (current.size !== next.size || [...current].some((id) => !next.has(id))) {
		throw new TreeError(
			"Reorder ids must be exactly the current sibling set",
			"REORDER_MISMATCH",
		);
	}
	const order = new Map(ids.map((id, i) => [id, i]));
	return rows.map((r) =>
		order.has(r.id) ? { ...r, sortOrder: order.get(r.id)! } : r,
	);
}

export function availableParents(
	rows: TreeRow[],
	current?: TreeRow,
): TreeRow[] {
	if (!current) return rows;
	const tree = buildTree(rows);
	const self = findNode(tree, current.path);
	const excluded = new Set<string>(
		self ? [self.translationGroup, ...flattenTree(self.children).map((n) => n.translationGroup)] : [],
	);
	return rows.filter((r) => !excluded.has(nodeGroup(r)));
}

export function rowFromPartial(
	input: {
		id: string;
		slug: string;
		title: string;
		parentId?: string | null;
		sortOrder?: number;
		nodeKind?: DocNodeKind;
		locale?: string;
		translationGroup?: string;
		versionSlug?: string;
		status?: string;
		path?: string;
	},
): TreeRow {
	return {
		id: input.id,
		slug: input.slug,
		title: input.title,
		status: input.status ?? "published",
		locale: input.locale ?? "en",
		translationGroup: input.translationGroup ?? input.id,
		parentId: input.parentId ?? null,
		sortOrder: input.sortOrder ?? 0,
		nodeKind: input.nodeKind ?? "doc",
		path: input.path ?? input.slug,
		versionSlug: input.versionSlug ?? "current",
	};
}

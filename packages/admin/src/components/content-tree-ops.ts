import type { DocTreeNode } from "../lib/api";

export type DropPosition = "before" | "after" | "inside";

export interface FlatTreeNode {
	id: string;
	node: DocTreeNode;
	/** Parent's translation group, or null for a root. */
	parentId: string | null;
	depth: number;
	index: number;
	siblingIds: string[];
	ancestorIds: ReadonlySet<string>;
}

export interface TreeMove {
	id: string;
	fromParentId: string | null;
	toParentId: string | null;
	toSiblingIds: string[];
}

export function countTreeNodes(nodes: DocTreeNode[]): number {
	let count = 0;
	const walk = (list: DocTreeNode[]) => {
		for (const node of list) {
			count += 1;
			if (node.children.length > 0) walk(node.children);
		}
	};
	walk(nodes);
	return count;
}

/** Flatten only expanded branches. Descendants of `collapsedId` stay hidden. */
export function flattenVisible(
	nodes: DocTreeNode[],
	expanded: ReadonlySet<string>,
	options: {
		parentId?: string | null;
		depth?: number;
		ancestorIds?: string[];
		collapsedId?: string | null;
	} = {},
): FlatTreeNode[] {
	const parentId = options.parentId ?? null;
	const depth = options.depth ?? 0;
	const ancestorIds = options.ancestorIds ?? [];
	const ancestorSet = new Set(ancestorIds);
	const siblingIds = nodes.filter((node) => !node.stranded).map((node) => node.id);
	const out: FlatTreeNode[] = [];

	nodes.forEach((node, index) => {
		out.push({
			id: node.id,
			node,
			parentId,
			depth,
			index,
			siblingIds,
			ancestorIds: ancestorSet,
		});
		const showChildren =
			node.children.length > 0 && expanded.has(node.id) && node.id !== options.collapsedId;
		if (showChildren) {
			out.push(
				...flattenVisible(node.children, expanded, {
					parentId: node.translationGroup,
					depth: depth + 1,
					ancestorIds: [...ancestorIds, node.id],
					collapsedId: options.collapsedId,
				}),
			);
		}
	});

	return out;
}

/** Ancestors (and matching sections) that should stay open for a search hit. */
export function collectMatchAncestorIds(nodes: DocTreeNode[], query: string): Set<string> {
	const needle = query.trim().toLowerCase();
	const open = new Set<string>();
	if (!needle) return open;

	const walk = (list: DocTreeNode[], ancestors: string[]): boolean => {
		let any = false;
		for (const node of list) {
			const self =
				node.title.toLowerCase().includes(needle) ||
				node.slug.toLowerCase().includes(needle) ||
				node.path.toLowerCase().includes(needle);
			const childHit = walk(node.children, [...ancestors, node.id]);
			if (self || childHit) {
				any = true;
				for (const id of ancestors) open.add(id);
				if (childHit) open.add(node.id);
			}
		}
		return any;
	};

	walk(nodes, []);
	return open;
}

export function filterTree(nodes: DocTreeNode[], query: string): DocTreeNode[] {
	const needle = query.trim().toLowerCase();
	if (!needle) return nodes;
	const out: DocTreeNode[] = [];
	for (const node of nodes) {
		const children = filterTree(node.children, query);
		const matches =
			node.title.toLowerCase().includes(needle) ||
			node.slug.toLowerCase().includes(needle) ||
			node.path.toLowerCase().includes(needle);
		if (matches || children.length > 0) {
			out.push({ ...node, children: matches ? node.children : children });
		}
	}
	return out;
}

export function planTreeMove(
	flat: readonly FlatTreeNode[],
	activeId: string,
	overId: string,
	position: DropPosition,
): TreeMove | null {
	const active = flat.find((row) => row.id === activeId);
	const over = flat.find((row) => row.id === overId);
	if (!active || !over || active.node.stranded || over.node.stranded) return null;
	if (over.ancestorIds.has(activeId)) return null;

	if (position === "inside") {
		if (overId === activeId) return null;
		const children = over.node.children
			.filter((child) => !child.stranded && child.id !== activeId)
			.map((child) => child.id);
		return {
			id: activeId,
			fromParentId: active.parentId,
			toParentId: over.node.translationGroup,
			toSiblingIds: [...children, activeId],
		};
	}

	if (overId === activeId) return null;

	const siblings = over.siblingIds.filter((id) => id !== activeId);
	const overIndex = siblings.indexOf(overId);
	if (overIndex < 0) return null;
	const insertAt = position === "before" ? overIndex : overIndex + 1;
	const toSiblingIds = [...siblings];
	toSiblingIds.splice(insertAt, 0, activeId);

	return {
		id: activeId,
		fromParentId: active.parentId,
		toParentId: over.parentId,
		toSiblingIds,
	};
}

/** Nest under the previous sibling (indent / move right). */
export function planIndent(flat: readonly FlatTreeNode[], id: string): TreeMove | null {
	const row = flat.find((item) => item.id === id);
	if (!row || row.index <= 0) return null;
	const previousId = row.siblingIds[row.index - 1];
	if (!previousId) return null;
	return planTreeMove(flat, id, previousId, "inside");
}

/** Become the next sibling of the current parent (outdent / move left). */
export function planOutdent(flat: readonly FlatTreeNode[], id: string): TreeMove | null {
	const row = flat.find((item) => item.id === id);
	if (!row || row.parentId === null) return null;
	const parent = flat.find((item) => item.node.translationGroup === row.parentId);
	if (!parent) return null;
	return planTreeMove(flat, id, parent.id, "after");
}

export function planReorder(
	flat: readonly FlatTreeNode[],
	id: string,
	direction: -1 | 1,
): TreeMove | null {
	const row = flat.find((item) => item.id === id);
	if (!row) return null;
	const next = row.index + direction;
	if (next < 0 || next >= row.siblingIds.length) return null;
	const ids = [...row.siblingIds];
	const [moved] = ids.splice(row.index, 1);
	if (!moved) return null;
	ids.splice(next, 0, moved);
	return {
		id,
		fromParentId: row.parentId,
		toParentId: row.parentId,
		toSiblingIds: ids,
	};
}

export function applyTreeMove(tree: DocTreeNode[], move: TreeMove): DocTreeNode[] {
	const { tree: without, removed } = removeNode(tree, move.id);
	if (!removed) return tree;
	return insertAtParent(without, move.toParentId, move.toSiblingIds, removed);
}

function removeNode(
	nodes: DocTreeNode[],
	id: string,
): { tree: DocTreeNode[]; removed: DocTreeNode | null } {
	const tree: DocTreeNode[] = [];
	let removed: DocTreeNode | null = null;
	for (const node of nodes) {
		if (node.id === id) {
			removed = node;
			continue;
		}
		const child = removeNode(node.children, id);
		if (child.removed) removed = child.removed;
		tree.push(child.removed ? { ...node, children: child.tree } : node);
	}
	return { tree, removed };
}

function insertAtParent(
	tree: DocTreeNode[],
	parentId: string | null,
	siblingIds: string[],
	node: DocTreeNode,
): DocTreeNode[] {
	if (parentId === null) return orderSiblings(tree, siblingIds, node);
	return tree.map((item) => {
		if (item.translationGroup === parentId) {
			return { ...item, children: orderSiblings(item.children, siblingIds, node) };
		}
		return { ...item, children: insertAtParent(item.children, parentId, siblingIds, node) };
	});
}

function orderSiblings(
	list: DocTreeNode[],
	siblingIds: string[],
	extra: DocTreeNode,
): DocTreeNode[] {
	const byId = new Map(list.map((node) => [node.id, node]));
	byId.set(extra.id, extra);
	const ordered = siblingIds
		.map((id) => byId.get(id))
		.filter((node): node is DocTreeNode => node !== undefined);
	const leftovers = list.filter((node) => !siblingIds.includes(node.id) && node.id !== extra.id);
	return [...ordered, ...leftovers];
}

export function dropPositionFromOffset(offsetRatio: number): DropPosition {
	if (offsetRatio < 0.28) return "before";
	if (offsetRatio > 0.72) return "after";
	return "inside";
}

export const TREE_INDENT_PX = 20;

export interface TreeProjection {
	depth: number;
	parentId: string | null;
	parentNodeId: string | null;
	overId: string;
}

export function arrayMove<T>(items: readonly T[], from: number, to: number): T[] {
	const next = items.slice();
	const [item] = next.splice(from, 1);
	if (item === undefined) return next;
	next.splice(to, 0, item);
	return next;
}

/**
 * dnd-kit tree projection: vertical over-id reorders the flat list, horizontal
 * offset changes depth (indent / outdent). Matches the official sortable-tree
 * example so rows make space like a real list while still nesting.
 */
export function getProjection(
	flat: readonly FlatTreeNode[],
	activeId: string,
	overId: string,
	dragOffsetX: number,
	indentationWidth: number = TREE_INDENT_PX,
): TreeProjection | null {
	const activeIndex = flat.findIndex((row) => row.id === activeId);
	const overIndex = flat.findIndex((row) => row.id === overId);
	const active = flat[activeIndex];
	const over = flat[overIndex];
	if (!active || !over || activeIndex < 0 || overIndex < 0) return null;
	if (active.node.stranded || over.node.stranded) return null;
	if (over.ancestorIds.has(activeId)) return null;

	const moved = arrayMove(flat, activeIndex, overIndex);
	const previous = moved[overIndex - 1];
	const next = moved[overIndex + 1];
	const maxDepth = previous ? previous.depth + 1 : 0;
	const minDepth = next ? next.depth : 0;
	const projected = active.depth + Math.round(dragOffsetX / indentationWidth);
	const depth = Math.min(maxDepth, Math.max(minDepth, projected, 0));

	const parent = resolveProjectedParent(moved, overIndex, depth, activeId);
	if (parent.parentNodeId === activeId) return null;
	if (parent.parentNodeId) {
		const parentRow = flat.find((row) => row.id === parent.parentNodeId);
		if (parentRow?.ancestorIds.has(activeId)) return null;
	}

	return {
		depth,
		parentId: parent.parentId,
		parentNodeId: parent.parentNodeId,
		overId,
	};
}

function resolveProjectedParent(
	moved: readonly FlatTreeNode[],
	overIndex: number,
	depth: number,
	activeId: string,
): { parentId: string | null; parentNodeId: string | null } {
	if (depth <= 0) return { parentId: null, parentNodeId: null };
	for (let index = overIndex - 1; index >= 0; index--) {
		const item = moved[index];
		if (!item || item.id === activeId) continue;
		if (item.depth === depth - 1) {
			return { parentId: item.node.translationGroup, parentNodeId: item.id };
		}
	}
	return { parentId: null, parentNodeId: null };
}

/** Turn a live projection into the reparent + sibling-order payload. */
export function planMoveFromProjection(
	flat: readonly FlatTreeNode[],
	activeId: string,
	projection: TreeProjection,
): TreeMove | null {
	const active = flat.find((row) => row.id === activeId);
	if (!active || active.node.stranded) return null;

	const activeIndex = flat.findIndex((row) => row.id === activeId);
	const overIndex = flat.findIndex((row) => row.id === projection.overId);
	if (activeIndex < 0 || overIndex < 0) return null;

	const moved = arrayMove(flat, activeIndex, overIndex);
	const depthOf = (row: FlatTreeNode) => (row.id === activeId ? projection.depth : row.depth);

	const toSiblingIds: string[] = [];
	if (projection.parentId === null) {
		for (const row of moved) {
			if (depthOf(row) === 0) toSiblingIds.push(row.id);
		}
	} else {
		const parentIndex = moved.findIndex((row) => row.id === projection.parentNodeId);
		if (parentIndex < 0) return null;
		const parentDepth = depthOf(moved[parentIndex]!);
		for (let index = parentIndex + 1; index < moved.length; index++) {
			const row = moved[index]!;
			const depth = depthOf(row);
			if (depth <= parentDepth) break;
			if (depth === projection.depth) toSiblingIds.push(row.id);
		}
	}

	if (!toSiblingIds.includes(activeId)) toSiblingIds.push(activeId);

	const sameParent = active.parentId === projection.parentId;
	const sameOrder =
		sameParent &&
		active.siblingIds.length === toSiblingIds.length &&
		active.siblingIds.every((id, index) => id === toSiblingIds[index]);
	if (sameOrder) return null;

	return {
		id: activeId,
		fromParentId: active.parentId,
		toParentId: projection.parentId,
		toSiblingIds,
	};
}

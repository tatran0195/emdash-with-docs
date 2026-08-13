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
			node.children.length > 0 &&
			expanded.has(node.id) &&
			node.id !== options.collapsedId;
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

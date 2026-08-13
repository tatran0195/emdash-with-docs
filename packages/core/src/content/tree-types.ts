/**
 * Hierarchical / versioned content types.
 *
 * Drop into packages/core/src/content/tree-types.ts (or extend
 * database/repositories/types.ts + query.ts).
 */

export type DocNodeKind = "doc" | "section";

export interface ContentVersion {
	id: string;
	collection: string;
	slug: string;
	label: string;
	isDefault: boolean;
	isFrozen: boolean;
	sortOrder: number;
	createdAt: string;
}

/** Flat row as stored on ec_<slug> / returned by ContentRepository. */
export interface TreeRow {
	id: string;
	slug: string;
	title: string;
	status: string;
	locale: string;
	/** Stable identity across locales. parentId stores THIS, not id. */
	translationGroup: string;
	parentId: string | null;
	sortOrder: number;
	nodeKind: DocNodeKind;
	path: string;
	versionSlug: string;
}

export interface DocTreeNode {
	id: string;
	translationGroup: string;
	slug: string;
	path: string;
	title: string;
	kind: DocNodeKind;
	status: string;
	/** True when parentId is set but the parent has no row in this locale. */
	stranded: boolean;
	children: DocTreeNode[];
}

export interface DocCrumb {
	id: string;
	title: string;
	path: string;
	kind: DocNodeKind;
}

export interface DocNeighbors {
	prev: DocTreeNode | null;
	next: DocTreeNode | null;
}

export const MAX_TREE_DEPTH = 32;

export const TREE_SYSTEM_COLUMNS = [
	"parent_id",
	"sort_order",
	"node_kind",
	"path",
	"version_slug",
] as const;

export const TREE_INCLUDE_IN_DATA: Record<string, string> = {
	parent_id: "parentId",
	sort_order: "sortOrder",
	node_kind: "nodeKind",
	path: "path",
	version_slug: "versionSlug",
};

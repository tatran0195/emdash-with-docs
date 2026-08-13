import type { ContentVersion, DocTreeNode } from "emdash";

export interface DocsRoute {
	/** Version slug being viewed (`current` when unprefixed). */
	version: string;
	/** Nested path inside the tree, e.g. `guides/install`. */
	path: string;
	/** Public URL prefix: `/docs` or `/docs/1.0`. */
	prefix: string;
	/** True when the URL is showing a non-default version. */
	isVersionedUrl: boolean;
}

/**
 * Peel a leading version slug from `/docs/{...path}` the same way the
 * catch-all template does: default version stays unprefixed.
 */
export function parseDocsRoute(
	rawPath: string | undefined,
	versions: ContentVersion[],
): DocsRoute {
	const segments = (rawPath ?? "").split("/").filter(Boolean);
	const known = new Set(versions.map((version) => version.slug));
	const defaultVersion = versions.find((version) => version.isDefault)?.slug ?? "current";

	let version = defaultVersion;
	let path = segments.join("/");
	if (segments.length >= 1 && known.has(segments[0]) && segments[0] !== defaultVersion) {
		version = segments[0];
		path = segments.slice(1).join("/");
	}

	const isVersionedUrl = version !== defaultVersion;
	return {
		version,
		path,
		prefix: isVersionedUrl ? `/docs/${version}` : "/docs",
		isVersionedUrl,
	};
}

export function docsHref(prefix: string, docPath: string): string {
	const trimmed = docPath.replace(/^\/+|\/+$/g, "");
	return trimmed ? `${prefix}/${trimmed}` : prefix;
}

/** Depth-first walk used by search and the version fallback. */
export function flattenTree(nodes: DocTreeNode[]): DocTreeNode[] {
	const out: DocTreeNode[] = [];
	const walk = (list: DocTreeNode[]) => {
		for (const node of list) {
			out.push(node);
			if (node.children.length > 0) walk(node.children);
		}
	};
	walk(nodes);
	return out;
}

export function findNodeBySlug(nodes: DocTreeNode[], slug: string): DocTreeNode | null {
	return flattenTree(nodes).find((node) => node.slug === slug) ?? null;
}

export function findNodeByPath(nodes: DocTreeNode[], path: string): DocTreeNode | null {
	return flattenTree(nodes).find((node) => node.path === path) ?? null;
}

/** First leaf-or-section that exists in `tree` for a preferred path. */
export function resolveFallbackPath(tree: DocTreeNode[], preferred: string): string {
	if (preferred && findNodeByPath(tree, preferred)) return preferred;
	const flat = flattenTree(tree);
	return flat[0]?.path ?? "";
}

export function countTreeNodes(nodes: DocTreeNode[]): { sections: number; docs: number } {
	let sections = 0;
	let docs = 0;
	for (const node of flattenTree(nodes)) {
		if (node.kind === "section") sections += 1;
		else docs += 1;
	}
	return { sections, docs };
}

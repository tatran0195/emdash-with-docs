import type { ContentVersion, DocTreeNode } from "emdash";

export interface DocsRoute {
	/** Locale code, e.g. `en` or `ja`. */
	locale: string;
	/** Version slug being viewed, e.g. `current` or `1.0`. */
	version: string;
	/** Nested path inside the tree, e.g. `guides/install`. */
	path: string;
	/** Public URL prefix: `/:locale/docs/:version`. */
	prefix: string;
	/** True when the URL is showing a non-default version. */
	isVersionedUrl: boolean;
}

/**
 * Parse route parameters for `/:locale/docs/:version/{...path}`.
 */
export function parseDocsRoute(
	rawPath: string | undefined,
	versions: ContentVersion[],
	locale = "en",
	specifiedVersion?: string,
): DocsRoute {
	const defaultVersion = versions.find((version) => version.isDefault)?.slug ?? "current";
	const isKnownVersion =
		specifiedVersion !== undefined && versions.some((v) => v.slug === specifiedVersion);

	const version = isKnownVersion ? specifiedVersion : defaultVersion;
	const rawPrefix = !isKnownVersion && specifiedVersion ? specifiedVersion : "";
	const combinedPath = [rawPrefix, rawPath ?? ""].filter(Boolean).join("/");
	const path = combinedPath.replace(/^\/+|\/+$/g, "");
	const isVersionedUrl = version !== defaultVersion;

	return {
		locale,
		version,
		path,
		prefix: `/${locale}/docs/${version}`,
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

/**
 * Shared urlPattern interpolator / matcher.
 *
 * Replaces the four independent `{slug}`-only implementations:
 *   - packages/core/src/query.ts          patternToRegex
 *   - packages/core/src/menus/index.ts    interpolateUrlPattern
 *   - packages/core/src/database/repositories/redirect.ts
 *   - packages/admin/src/lib/url.ts       contentUrl
 *   - packages/core/src/preview/urls.ts   (does not use urlPattern today)
 */

const TOKEN_SOURCE: Record<string, string> = {
	slug: "([^/]+)",
	id: "([^/]+)",
	version: "([^/]+)",
	locale: "([^/]+)",
	collection: "([^/]+)",
	// Must be the last token in the pattern. Greedy across slashes.
	path: "(.+)",
};

const TOKEN_RE = /\{(\w+)\}/g;
const REPEATED_SLASHES = /\/{2,}/g;

export class UrlPatternError extends Error {
	constructor(
		message: string,
		readonly code: "MISSING_IDENTITY" | "PATH_NOT_LAST" | "BARE_PATH" | "VERSION_WITHOUT_IDENTITY",
	) {
		super(message);
		this.name = "UrlPatternError";
	}
}

export interface PatternTokens {
	slug?: string;
	id?: string;
	path?: string;
	version?: string;
	locale?: string;
	collection?: string;
}

export function validateUrlPattern(pattern: string): void {
	const tokens = new Set(Array.from(pattern.matchAll(TOKEN_RE), (m) => m[1]));
	const hasIdentity = tokens.has("slug") || tokens.has("path") || tokens.has("id");
	if (!hasIdentity) {
		throw new UrlPatternError("Pattern must include {slug}, {path}, or {id}", "MISSING_IDENTITY");
	}
	if (tokens.has("path")) {
		if (!pattern.endsWith("{path}")) {
			throw new UrlPatternError("{path} must be the last token", "PATH_NOT_LAST");
		}
		const stripped = pattern.slice(0, -"{path}".length).replace(REPEATED_SLASHES, "/");
		if (stripped === "/" || stripped === "") {
			throw new UrlPatternError(
				"/{path} is too greedy; prefix it (e.g. /docs/{path})",
				"BARE_PATH",
			);
		}
	}
	if (tokens.has("version") && !tokens.has("path") && !tokens.has("slug")) {
		throw new UrlPatternError("{version} requires {path} or {slug}", "VERSION_WITHOUT_IDENTITY");
	}
}

export function interpolateUrlPattern(pattern: string, tokens: PatternTokens): string {
	let path = pattern.replace(TOKEN_RE, (_m, name: string) => {
		const value = tokens[name as keyof PatternTokens];
		return value ?? "";
	});
	path = path.replace(REPEATED_SLASHES, "/");
	if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);
	return path || "/";
}

export function patternToRegex(pattern: string): { regex: RegExp; paramNames: string[] } {
	const paramNames: string[] = [];
	const regexStr = pattern.replace(TOKEN_RE, (_m, name: string) => {
		paramNames.push(name);
		const source = TOKEN_SOURCE[name] ?? "([^/]+)";
		return source;
	});
	return { regex: new RegExp(`^${regexStr}$`), paramNames };
}

export interface CompiledPattern {
	collection: string;
	pattern: string;
	regex: RegExp;
	paramNames: string[];
	supports?: string[];
}

/**
 * Resolve a request path against compiled collection patterns.
 *
 * Versioned docs: try `/docs/{version}/{path}` first only when the first
 * captured segment is in `knownVersions`. Otherwise fall through to
 * `/docs/{path}` and fill version = defaultVersion.
 */
export function matchUrlPath(
	path: string,
	patterns: CompiledPattern[],
	options: {
		knownVersions?: Map<string, Set<string>>; // collection → version slugs
		defaultVersion?: Map<string, string>;
	} = {},
): { collection: string; params: Record<string, string> } | null {
	for (const compiled of patterns) {
		const match = path.match(compiled.regex);
		if (!match) continue;
		const params: Record<string, string> = {};
		for (let i = 0; i < compiled.paramNames.length; i++) {
			params[compiled.paramNames[i]] = match[i + 1];
		}

		if (params.version) {
			const allowed = options.knownVersions?.get(compiled.collection);
			if (allowed && !allowed.has(params.version)) continue;
		} else {
			const fallback = options.defaultVersion?.get(compiled.collection);
			if (fallback) params.version = fallback;
		}

		return { collection: compiled.collection, params };
	}
	return null;
}

/**
 * Admin / preview helper. Prefer {path} when present, else {slug}, else {id}.
 * Omit {version} when it is the default so the public URL stays unprefixed.
 */
export function contentUrl(
	collection: string,
	tokens: PatternTokens,
	urlPattern?: string | null,
	defaultVersion = "current",
): string {
	const pattern = urlPattern || `/${collection}/{slug}`;
	const interpolated = interpolateUrlPattern(pattern, {
		collection,
		...tokens,
		version: tokens.version && tokens.version !== defaultVersion ? tokens.version : "",
	});
	return interpolated;
}

/**
 * Optional versioned pattern used internally by resolveEmDashPath.
 * `/docs/{path}` → also try `/docs/{version}/{path}`.
 */
export function withOptionalVersionPrefix(pattern: string): string[] {
	if (pattern.includes("{version}") || !pattern.includes("{path}")) return [pattern];
	const versioned = pattern.replace("{path}", "{version}/{path}");
	return [versioned, pattern];
}

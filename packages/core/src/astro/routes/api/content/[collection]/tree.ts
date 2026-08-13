/**
 * Content tree endpoint - injected by EmDash integration
 *
 * GET /_emdash/api/content/{collection}/tree - Hierarchical sidebar tree
 */

import { hasPermission } from "@emdash-cms/auth";
import type { APIRoute } from "astro";

import { requirePerm } from "#api/authorize.js";
import { apiError, unwrapResult } from "#api/error.js";
import { parseQuery, isParseError } from "#api/parse.js";
import { contentTreeQuery } from "#api/schemas.js";

export const prerender = false;

export const GET: APIRoute = async ({ params, url, locals }) => {
	const { emdash, user } = locals;
	if (!emdash?.handleContentTree) {
		return apiError("NOT_CONFIGURED", "EmDash is not initialized", 500);
	}
	const denied = requirePerm(user, "content:read");
	if (denied) return denied;
	const collection = params.collection!;
	const query = parseQuery(url, contentTreeQuery);
	if (isParseError(query)) return query;

	const status = hasPermission(user, "content:read_drafts") ? query.status : "published";
	const result = await emdash.handleContentTree(collection, {
		locale: query.locale,
		version: query.version,
		status,
	});

	return unwrapResult(result);
};

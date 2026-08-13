/**
 * Content tree reorder endpoint - injected by EmDash integration
 *
 * POST /_emdash/api/content/{collection}/reorder - Reorder siblings
 */

import type { APIRoute } from "astro";

import { requirePerm } from "#api/authorize.js";
import { apiError, unwrapResult } from "#api/error.js";
import { parseBody, isParseError } from "#api/parse.js";
import { contentReorderBody } from "#api/schemas.js";

export const prerender = false;

export const POST: APIRoute = async ({ params, request, locals, cache }) => {
	const { emdash, user } = locals;
	if (!emdash?.handleContentReorder) {
		return apiError("NOT_CONFIGURED", "EmDash is not initialized", 500);
	}
	const denied = requirePerm(user, "content:edit_any");
	if (denied) return denied;
	const collection = params.collection!;
	const body = await parseBody(request, contentReorderBody);
	if (isParseError(body)) return body;

	const result = await emdash.handleContentReorder(collection, body);
	if (result.success && cache?.enabled) await cache.invalidate({ tags: [collection] });
	return unwrapResult(result);
};

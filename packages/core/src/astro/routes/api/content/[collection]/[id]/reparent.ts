/**
 * Content reparent endpoint - injected by EmDash integration
 *
 * POST /_emdash/api/content/{collection}/{id}/reparent - Move a node
 */

import type { APIRoute } from "astro";

import { requirePerm } from "#api/authorize.js";
import { apiError, unwrapResult } from "#api/error.js";
import { parseBody, isParseError } from "#api/parse.js";
import { contentReparentBody } from "#api/schemas.js";

export const prerender = false;

export const POST: APIRoute = async ({ params, request, locals, cache }) => {
	const { emdash, user } = locals;
	if (!emdash?.handleContentReparent) {
		return apiError("NOT_CONFIGURED", "EmDash is not initialized", 500);
	}
	const denied = requirePerm(user, "content:edit_any");
	if (denied) return denied;
	const collection = params.collection!;
	const id = params.id!;
	const body = await parseBody(request, contentReparentBody);
	if (isParseError(body)) return body;

	const result = await emdash.handleContentReparent(collection, id, body.parentId);
	if (result.success && cache?.enabled) await cache.invalidate({ tags: [collection] });
	return unwrapResult(result);
};

/**
 * Content version update endpoint - injected by EmDash integration
 *
 * PATCH /_emdash/api/content/{collection}/versions/{slug}
 */

import type { APIRoute } from "astro";

import { requirePerm } from "#api/authorize.js";
import { apiError, unwrapResult } from "#api/error.js";
import { parseBody, isParseError } from "#api/parse.js";
import { contentVersionUpdateBody } from "#api/schemas.js";

export const prerender = false;

export const PATCH: APIRoute = async ({ params, request, locals, cache }) => {
	const { emdash, user } = locals;
	if (!emdash?.handleContentVersionUpdate) {
		return apiError("NOT_CONFIGURED", "EmDash is not initialized", 500);
	}
	const denied = requirePerm(user, "content:edit_any");
	if (denied) return denied;
	const collection = params.collection!;
	const slug = params.slug!;
	const body = await parseBody(request, contentVersionUpdateBody);
	if (isParseError(body)) return body;

	const result = await emdash.handleContentVersionUpdate(collection, slug, body);
	if (result.success && cache?.enabled) await cache.invalidate({ tags: [collection] });
	return unwrapResult(result);
};

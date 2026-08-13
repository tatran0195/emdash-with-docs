/**
 * Content versions endpoint - injected by EmDash integration
 *
 * GET  /_emdash/api/content/{collection}/versions - List version catalog
 * POST /_emdash/api/content/{collection}/versions - Cut a frozen snapshot
 */

import type { APIRoute } from "astro";

import { requirePerm } from "#api/authorize.js";
import { apiError, unwrapResult } from "#api/error.js";
import { parseBody, isParseError } from "#api/parse.js";
import { contentVersionCutBody } from "#api/schemas.js";

export const prerender = false;

export const GET: APIRoute = async ({ params, locals }) => {
	const { emdash, user } = locals;
	if (!emdash?.handleContentVersionsList) {
		return apiError("NOT_CONFIGURED", "EmDash is not initialized", 500);
	}
	const denied = requirePerm(user, "content:read");
	if (denied) return denied;
	const collection = params.collection!;
	const result = await emdash.handleContentVersionsList(collection);
	return unwrapResult(result);
};

export const POST: APIRoute = async ({ params, request, locals, cache }) => {
	const { emdash, user } = locals;
	if (!emdash?.handleContentVersionCut) {
		return apiError("NOT_CONFIGURED", "EmDash is not initialized", 500);
	}
	const denied = requirePerm(user, "content:edit_any");
	if (denied) return denied;
	const collection = params.collection!;
	const body = await parseBody(request, contentVersionCutBody);
	if (isParseError(body)) return body;

	const result = await emdash.handleContentVersionCut(collection, body);
	if (result.success && cache?.enabled) await cache.invalidate({ tags: [collection] });
	return unwrapResult(result);
};

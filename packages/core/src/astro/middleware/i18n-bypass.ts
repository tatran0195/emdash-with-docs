/**
 * i18n bypass middleware for EmDash internal routes.
 *
 * When Astro's i18n routing is configured with `prefixDefaultLocale: true`
 * (strategy "pathname-prefix-always"), the i18n handler intercepts every page
 * response after rendering and replaces it with a 404 if the pathname has no
 * locale prefix -- including /_emdash/* routes that are intentionally
 * locale-free. By resetting responseRouteType on Astro's fetchState after
 * the page renders, Astro's i18n finalizer skips processing this route and
 * preserves the 200 OK admin shell response.
 */

import { defineMiddleware } from "astro:middleware";

const EMDASH_PREFIX = "/_emdash/";
const fetchStateSymbol = Symbol.for("astro.fetchState");

export const onRequest = defineMiddleware(async (context, next) => {
	const response = await next();

	const { pathname } = context.url;
	if (pathname.startsWith(EMDASH_PREFIX)) {
		const fetchState = (context as unknown as Record<symbol, any>)[fetchStateSymbol];
		if (fetchState) {
			fetchState.responseRouteType = undefined;
		}
	}

	return response;
});

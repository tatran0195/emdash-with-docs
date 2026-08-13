import { escapeHtml } from "./escape.js";

/**
 * Validate that a redirect URL is a safe local path.
 *
 * Rejects:
 * - Protocol-relative URLs (`//evil.com`)
 * - Backslash bypass (`/\evil.com` — browsers normalize `\` to `/` in Location headers)
 * - Absolute URLs (`https://evil.com`)
 * - Empty / nullish values
 */
export function isSafeRedirect(url: string | null | undefined): url is string {
	return (
		typeof url === "string" && url.startsWith("/") && !url.startsWith("//") && !url.includes("\\")
	);
}

/**
 * HTML interstitial used by the dev-bypass routes after the session is written.
 *
 * Preview iframes often display this document as-is: they ignore 302 Location
 * and do not execute scripts on a 3xx body. Stay on 200 and:
 *   1. JS-navigate when scripts run
 *   2. Embed the target in a same-origin iframe so the admin UI is visible
 *      even when the host never changes the address bar
 */
export function redirectHtmlResponse(redirect: string): Response {
	const safeRedirect = escapeHtml(redirect);
	const html = `<!DOCTYPE html>
<html>
<head>
	<meta charset="utf-8">
	<title>EmDash Admin</title>
	<meta http-equiv="refresh" content="0;url=${safeRedirect}">
	<style>
		html, body { margin: 0; height: 100%; background: #fff; }
		iframe { border: 0; width: 100%; height: 100%; display: block; }
	</style>
	<script>try { location.replace(${JSON.stringify(redirect)}); } catch (e) {}</script>
</head>
<body>
	<iframe src="${safeRedirect}" title="EmDash Admin"></iframe>
</body>
</html>`;
	return new Response(html, {
		status: 200,
		headers: {
			"Content-Type": "text/html; charset=utf-8",
			Refresh: `0;url=${redirect}`,
		},
	});
}

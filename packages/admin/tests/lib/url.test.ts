import { describe, it, expect } from "vitest";

import { sanitizeRedirectUrl, contentUrl } from "../../src/lib/url";

describe("sanitizeRedirectUrl", () => {
	it("allows simple relative paths", () => {
		expect(sanitizeRedirectUrl("/_emdash/admin")).toBe("/_emdash/admin");
	});

	it("allows deep relative paths", () => {
		expect(sanitizeRedirectUrl("/_emdash/admin/content/posts")).toBe(
			"/_emdash/admin/content/posts",
		);
	});

	it("allows root path", () => {
		expect(sanitizeRedirectUrl("/")).toBe("/");
	});

	it("allows paths with query strings", () => {
		expect(sanitizeRedirectUrl("/_emdash/admin?tab=settings")).toBe("/_emdash/admin?tab=settings");
	});

	it("allows paths with hash fragments", () => {
		expect(sanitizeRedirectUrl("/_emdash/admin#section")).toBe("/_emdash/admin#section");
	});

	it("rejects absolute http URLs (open redirect)", () => {
		expect(sanitizeRedirectUrl("https://evil.com/phishing")).toBe("/_emdash/admin");
	});

	it("rejects absolute http URLs without TLS", () => {
		expect(sanitizeRedirectUrl("http://evil.com")).toBe("/_emdash/admin");
	});

	it("rejects protocol-relative URLs (//evil.com)", () => {
		expect(sanitizeRedirectUrl("//evil.com/phishing")).toBe("/_emdash/admin");
	});

	it("rejects javascript: scheme (DOM XSS)", () => {
		expect(sanitizeRedirectUrl("javascript:alert(document.cookie)")).toBe("/_emdash/admin");
	});

	it("rejects data: scheme", () => {
		expect(sanitizeRedirectUrl("data:text/html,<script>alert(1)</script>")).toBe("/_emdash/admin");
	});

	it("rejects backslash trick (/\\evil.com)", () => {
		expect(sanitizeRedirectUrl("/\\evil.com")).toBe("/_emdash/admin");
	});

	it("rejects empty string", () => {
		expect(sanitizeRedirectUrl("")).toBe("/_emdash/admin");
	});

	it("rejects bare domain", () => {
		expect(sanitizeRedirectUrl("evil.com")).toBe("/_emdash/admin");
	});
});

describe("contentUrl", () => {
	it("substitutes {locale} placeholder when prefixDefaultLocale is true", () => {
		const i18n = { defaultLocale: "en", locales: ["en", "ja"], prefixDefaultLocale: true };
		expect(
			contentUrl(
				"docs",
				"cross-linking",
				"/{locale}/docs/{version}/{path}",
				"guides/breadcrumbs/cross-linking",
				"en",
				i18n,
			),
		).toBe("/en/docs/guides/breadcrumbs/cross-linking");
		expect(
			contentUrl(
				"docs",
				"cross-linking",
				"/{locale}/docs/{version}/{path}",
				"guides/breadcrumbs/cross-linking",
				"ja",
				i18n,
			),
		).toBe("/ja/docs/guides/breadcrumbs/cross-linking");
	});

	it("collapses {locale} placeholder when default locale and prefixDefaultLocale is false", () => {
		const i18n = { defaultLocale: "en", locales: ["en", "ja"], prefixDefaultLocale: false };
		expect(
			contentUrl(
				"docs",
				"cross-linking",
				"/{locale}/docs/{version}/{path}",
				"guides/breadcrumbs/cross-linking",
				"en",
				i18n,
			),
		).toBe("/docs/guides/breadcrumbs/cross-linking");
		expect(
			contentUrl(
				"docs",
				"cross-linking",
				"/{locale}/docs/{version}/{path}",
				"guides/breadcrumbs/cross-linking",
				"ja",
				i18n,
			),
		).toBe("/ja/docs/guides/breadcrumbs/cross-linking");
	});

	it("substitutes non-default version into {version}", () => {
		expect(
			contentUrl("docs", "install", "/docs/{version}/{path}", "guides/install", null, null, "1.2"),
		).toBe("/docs/1.2/guides/install");
		expect(
			contentUrl(
				"docs",
				"install",
				"/docs/{version}/{path}",
				"guides/install",
				null,
				null,
				"current",
			),
		).toBe("/docs/guides/install");
	});

	it("falls back to /{collection}/{slug} when urlPattern is omitted", () => {
		expect(contentUrl("posts", "hello-world")).toBe("/posts/hello-world");
	});
});

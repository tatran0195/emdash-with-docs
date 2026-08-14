import node from "@astrojs/node";
import react from "@astrojs/react";
import { formsPlugin } from "@emdash-cms/plugin-forms";
import { defineConfig, fontProviders } from "astro/config";
import emdash, { local } from "emdash/astro";
import { sqlite } from "emdash/db";

/** @type {import('astro').AstroUserConfig} */
const config = {
	output: "server",
	server: {
		host: true,
		port: 4321,
		allowedHosts: true,
	},
	vite: {
		server: {
			host: true,
			allowedHosts: true,
			// Preview is proxied from another origin; a localhost HMR
			// websocket never connects and the admin SPA stays on
			// "Loading EmDash..." forever.
			hmr: false,
		},
		// Pre-bundle the admin graph so the first /_emdash/admin visit
		// does not invalidate deps mid-hydration (Vite "reloading").
		optimizeDeps: {
			// Serve the prebuilt admin as native ESM. Pre-bundling it produces
			// a 30MB+ chunk and the preview never leaves "Loading EmDash...".
			exclude: ["@emdash-cms/admin"],
			include: [
				"@astrojs/react/client.js",
				"react",
				"react-dom",
				"react/jsx-runtime",
				"react/jsx-dev-runtime",
			],
		},
	},
	adapter: node({
		mode: "standalone",
	}),
	image: {
		layout: "constrained",
		responsiveStyles: true,
	},
	integrations: [
		react(),
		emdash({
			database: sqlite({ url: "file:./data.db" }),
			storage: local({
				directory: "./uploads",
				baseUrl: "/_emdash/api/media/file",
			}),
			plugins: [formsPlugin()],
			fonts: {
				scripts: ["japanese"],
			},
		}),
	],
	i18n: {
		defaultLocale: "en",
		locales: ["en", "ja"],
		fallback: { ja: "en" },
	},
	fonts: [
		{
			provider: fontProviders.google(),
			name: "Inter",
			cssVariable: "--font-sans",
			weights: [400, 500, 600, 700],
			fallbacks: ["sans-serif"],
		},
		{
			provider: fontProviders.google(),
			name: "JetBrains Mono",
			cssVariable: "--font-mono",
			weights: [400, 500],
			fallbacks: ["monospace"],
		},
	],
	devToolbar: { enabled: false },
};

export default defineConfig(config);

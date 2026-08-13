/**
 * Load a trusted plugin-cli ESM bundle from source text.
 *
 * Vite's import-analysis warns on `import(\`data:text/javascript;base64,${...}\`)`
 * and tsdown inlines the specifier while stripping `/* @vite-ignore *\/`.
 * Building the URL at runtime and importing through an indirect function
 * keeps both tools from seeing a static import expression.
 *
 * Bundles are produced by plugin-cli and only loaded on the sandbox-bypass
 * path (trusted in-process evaluation).
 */
export async function importDataModule(code: string): Promise<Record<string, unknown>> {
	const specifier = "data:text/javascript;base64," + Buffer.from(code).toString("base64");
	return importDataUrl(specifier);
}

function importDataUrl(specifier: string): Promise<Record<string, unknown>> {
	// Indirect import: a literal `import()` here is rewritten/warned by Vite
	// and comment-stripped by tsdown when this module is bundled into middleware.
	// eslint-disable-next-line typescript/no-implied-eval -- runtime-only data: import; Vite must not statically analyze it
	const importer = new Function("s", "return import(s)") as (
		s: string,
	) => Promise<Record<string, unknown>>;
	return importer(specifier);
}

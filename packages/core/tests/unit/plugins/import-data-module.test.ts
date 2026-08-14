import { describe, expect, it } from "vitest";

import { importDataModule } from "../../../src/plugins/import-data-module.js";

describe("importDataModule", () => {
	it("evaluates trusted ESM source without a static data: import expression", async () => {
		const source = 'export default { id: "fixture-plugin" }; export const version = "1.0.0";';
		const mod = await importDataModule(source);
		expect(mod.default).toEqual({ id: "fixture-plugin" });
		expect(mod.version).toBe("1.0.0");
	});
});

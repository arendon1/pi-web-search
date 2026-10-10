import { describe, it } from "node:test";
import assert from "node:assert/strict";
import extensionFactory from "../src/index.ts";

describe("extension entry point", () => {
	it("registers exactly one tool with the expected shape", () => {
		const calls: Array<{ kind: string; payload: unknown }> = [];
		const mockPi = {
			registerTool(tool: { name: string; parameters: unknown; annotations: unknown; outputSchema: unknown }) {
				calls.push({ kind: "tool", payload: tool });
			},
		} as unknown as Parameters<typeof extensionFactory>[0];

		extensionFactory(mockPi);

		assert.equal(calls.length, 1, "expected exactly one registration (the tool)");
		const tool = calls[0]?.payload as {
			name: string;
			parameters: object;
			annotations: { readOnlyHint?: boolean; openWorldHint?: boolean };
			outputSchema: object;
		};
		assert.equal(tool.name, "web_search");
		assert.equal(tool.annotations.readOnlyHint, true);
		assert.equal(tool.annotations.openWorldHint, true);
		assert.ok(tool.parameters, "parameters defined");
		assert.ok(tool.outputSchema, "outputSchema defined");
	});
});

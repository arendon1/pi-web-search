import { describe, it } from "node:test";
import assert from "node:assert/strict";
import extensionFactory from "../src/index.ts";

describe("extension entry point", () => {
	it("registers one tool and one command without throwing", () => {
		const calls: Array<{ kind: string; payload: unknown }> = [];
		const mockPi = {
			registerTool(tool: { name: string }) {
				calls.push({ kind: "tool", payload: tool });
			},
			registerCommand(name: string, options: { description?: string }) {
				calls.push({ kind: "command", payload: { name, description: options.description } });
			},
		} as unknown as Parameters<typeof extensionFactory>[0];

		extensionFactory(mockPi);

		assert.equal(calls.length, 2);
		const tool = calls.find((c) => c.kind === "tool");
		const command = calls.find((c) => c.kind === "command");
		assert.ok(tool, "expected a tool registration");
		assert.ok(command, "expected a command registration");
		assert.equal((tool?.payload as { name: string }).name, "web_search");
		assert.equal((command?.payload as { name: string }).name, "websearch");
	});

	it("tool has the expected parameters, annotations, and outputSchema", () => {
		const calls: Array<{ kind: string; payload: unknown }> = [];
		const mockPi = {
			registerTool(tool: { name: string; parameters: unknown; annotations: unknown; outputSchema: unknown }) {
				calls.push({ kind: "tool", payload: tool });
			},
			registerCommand() {
				/* noop */
			},
		} as unknown as Parameters<typeof extensionFactory>[0];

		extensionFactory(mockPi);
		const tool = calls[0]?.payload as {
			parameters: object;
			annotations: { readOnlyHint?: boolean; openWorldHint?: boolean };
			outputSchema: object;
		};
		assert.equal(tool.annotations.readOnlyHint, true);
		assert.equal(tool.annotations.openWorldHint, true);
		assert.ok(tool.parameters, "parameters defined");
		assert.ok(tool.outputSchema, "outputSchema defined");
	});
});

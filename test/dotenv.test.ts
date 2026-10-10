import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { maskKey, parseDotenv } from "../src/dotenv.ts";

describe("parseDotenv", () => {
	it("parses simple KEY=VALUE pairs", () => {
		const out = parseDotenv("FOO=bar\nBAZ=qux");
		assert.deepEqual(out, { FOO: "bar", BAZ: "qux" });
	});

	it("skips blank lines and comments", () => {
		const out = parseDotenv(`
# this is a comment
// also a comment
FOO=bar

BAZ=qux
`);
		assert.deepEqual(out, { FOO: "bar", BAZ: "qux" });
	});

	it("handles `export` prefix", () => {
		const out = parseDotenv("export FOO=bar\nexport  BAZ=qux");
		assert.deepEqual(out, { FOO: "bar", BAZ: "qux" });
	});

	it("trims whitespace around values", () => {
		const out = parseDotenv("FOO=  bar  \nBAZ=\tqux\t");
		assert.deepEqual(out, { FOO: "bar", BAZ: "qux" });
	});

	it("strips double quotes and unescapes basic sequences", () => {
		const out = parseDotenv(`FOO="hello\\nworld"\nBAR="a\\"b"`);
		assert.deepEqual(out, { FOO: "hello\nworld", BAR: 'a"b' });
	});

	it("preserves single-quoted values literally", () => {
		const out = parseDotenv(`FOO='hello\\nworld'`);
		assert.deepEqual(out, { FOO: "hello\\nworld" });
	});

	it("treats inline # as a comment when unquoted", () => {
		const out = parseDotenv("FOO=bar # trailing\nBAZ=qux");
		assert.deepEqual(out, { FOO: "bar", BAZ: "qux" });
	});

	it("keeps # inside quoted values", () => {
		const out = parseDotenv(`FOO="bar # not a comment"`);
		assert.deepEqual(out, { FOO: "bar # not a comment" });
	});

	it("ignores malformed lines (no =, empty key)", () => {
		const out = parseDotenv("FOO\n=novalue\n =nokey");
		assert.deepEqual(out, {});
	});

	it("only splits on the first =", () => {
		const out = parseDotenv("URL=https://example.com/?a=1&b=2");
		assert.deepEqual(out, { URL: "https://example.com/?a=1&b=2" });
	});

	it("handles CRLF line endings", () => {
		const out = parseDotenv("FOO=bar\r\nBAZ=qux\r\n");
		assert.deepEqual(out, { FOO: "bar", BAZ: "qux" });
	});

	it("returns empty object for empty input", () => {
		assert.deepEqual(parseDotenv(""), {});
		assert.deepEqual(parseDotenv("   \n\n  "), {});
	});
});

describe("maskKey", () => {
	it("returns (not set) for empty/null", () => {
		assert.equal(maskKey(""), "(not set)");
		assert.equal(maskKey(null), "(not set)");
		assert.equal(maskKey(undefined), "(not set)");
	});

	it("masks all chars for short keys", () => {
		assert.equal(maskKey("abcd"), "****");
		assert.equal(maskKey("12345678"), "********");
	});

	it("keeps 4 prefix + 2 suffix for long keys", () => {
		assert.equal(maskKey("tvly-abc123def456"), "tvly****56");
		assert.equal(maskKey("EXA_KEY_LONG_VALUE_ABCDE"), "EXA_****DE");
	});
});

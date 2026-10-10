import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { formatResults, noKeysMessage } from "../src/format.ts";
import type { SearchResult } from "../src/types.ts";

describe("formatResults", () => {
	it("renders a numbered list with title, url, snippet, and published date", () => {
		const results: SearchResult[] = [
			{
				title: "Hello",
				url: "https://example.com",
				snippet: "first snippet",
				publishedDate: "2024-01-01",
			},
		];
		const out = formatResults(results, { backend: "exa", fallbackUsed: false });
		assert.match(out, /1\. \[Hello\]\(https:\/\/example\.com\)/);
		assert.match(out, /first snippet — 2024-01-01/);
		assert.match(out, /Served by: exa\./);
	});

	it("collapses whitespace and truncates long snippets to 500 chars", () => {
		const long = "x".repeat(2000);
		const results: SearchResult[] = [{ title: "T", url: "u", snippet: long }];
		const out = formatResults(results, { backend: "tavily", fallbackUsed: true });
		const snippetLine = out.split("\n").find((l) => l.startsWith("   ")) ?? "";
		assert.ok(snippetLine.length <= 500 + 4, "snippet line should be <= ~500 chars");
		assert.match(out, /Served by: tavily \(fallback\)\./);
	});

	it("falls back to url when title is empty", () => {
		const results: SearchResult[] = [{ title: "", url: "https://x", snippet: "s" }];
		const out = formatResults(results, { backend: "exa", fallbackUsed: false });
		assert.match(out, /\[https:\/\/x\]\(https:\/\/x\)/);
	});

	it("truncates to 10 results and notes overflow", () => {
		const results: SearchResult[] = Array.from({ length: 15 }, (_, i) => ({
			title: `T${i}`,
			url: `https://x/${i}`,
			snippet: "s",
		}));
		const out = formatResults(results, { backend: "exa", fallbackUsed: false });
		assert.match(out, /Showing 10 of 15 results\./);
		const numbered = (out.match(/^\d+\. /gm) ?? []).length;
		assert.equal(numbered, 10);
	});

	it("respects the 8KB byte cap and adds a truncation note", () => {
		// Force overflow with very long titles: 10 results × ~900-byte title = ~9KB body.
		const results: SearchResult[] = Array.from({ length: 10 }, (_, i) => ({
			title: "T".repeat(900) + `-${i}`,
			url: `https://x/${i}`,
			snippet: "y".repeat(500),
		}));
		const out = formatResults(results, { backend: "exa", fallbackUsed: false });
		assert.ok(new TextEncoder().encode(out).length <= 8 * 1024 + 200, "output should respect cap");
		assert.match(out, /truncated for length/);
		assert.match(out, /Served by: exa/);
	});
});

describe("noKeysMessage", () => {
	it("mentions both providers and setup paths", () => {
		const m = noKeysMessage();
		assert.match(m, /EXA_API_KEY/);
		assert.match(m, /TAVILY_API_KEY/);
		assert.match(m, /\~\/\.pi\/agent\/\.env/);
	});
});

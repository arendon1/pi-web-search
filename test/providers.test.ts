import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createExaProvider } from "../src/providers/exa.ts";
import { createTavilyProvider } from "../src/providers/tavily.ts";
import { classifyStatus, httpError, networkError } from "../src/providers/provider.ts";

function makeFetchMock(responses: Array<{ ok: boolean; status: number; body: unknown }>) {
	const calls: Array<{ url: string; init: RequestInit }> = [];
	let i = 0;
	const mock: typeof fetch = async (input, init) => {
		const url = typeof input === "string" ? input : (input as URL).toString();
		calls.push({ url, init: init ?? {} });
		const r = responses[i++] ?? { ok: false, status: 500, body: { error: "no more responses" } };
		const text = typeof r.body === "string" ? r.body : JSON.stringify(r.body);
		return new Response(text, {
			status: r.status,
			headers: { "Content-Type": "application/json" },
		});
	};
	return { mock, calls };
}

describe("Exa provider", () => {
	it("POSTs to api.exa.ai/search with x-api-key header and correct body", async () => {
		const { mock, calls } = makeFetchMock([
			{
				ok: true,
				status: 200,
				body: {
					results: [
						{ title: "A", url: "https://a", text: "snippet a", publishedDate: "2024-01-01", score: 0.9 },
					],
				},
			},
		]);
		const exa = createExaProvider({ apiKey: "test-key", fetchImpl: mock });
		const out = await exa.search("hello world", 5);
		assert.equal(calls.length, 1);
		assert.equal(calls[0]?.url, "https://api.exa.ai/search");
		assert.equal(calls[0]?.init.method, "POST");
		const headers = calls[0]?.init.headers as Record<string, string>;
		assert.equal(headers["x-api-key"], "test-key");
		assert.equal(headers["Content-Type"], "application/json");
		const body = JSON.parse(calls[0]?.init.body as string);
		assert.deepEqual(body, { query: "hello world", numResults: 5, text: { maxCharacters: 1500 } });
		assert.equal(out.length, 1);
		assert.deepEqual(out[0], {
			title: "A",
			url: "https://a",
			snippet: "snippet a",
			publishedDate: "2024-01-01",
			score: 0.9,
		});
	});

	it("returns empty array when results missing", async () => {
		const { mock } = makeFetchMock([{ ok: true, status: 200, body: {} }]);
		const exa = createExaProvider({ apiKey: "k", fetchImpl: mock });
		const out = await exa.search("q", 3);
		assert.deepEqual(out, []);
	});

	it("throws auth-classified error on 401", async () => {
		const { mock } = makeFetchMock([{ ok: false, status: 401, body: { error: "unauthorized" } }]);
		const exa = createExaProvider({ apiKey: "bad", fetchImpl: mock });
		await assert.rejects(async () => exa.search("q", 3), (err: Error) => {
			return err.message.includes("Invalid API key for exa") && err.message.includes("401");
		});
	});

	it("throws unavailable error on 5xx", async () => {
		const { mock } = makeFetchMock([{ ok: false, status: 503, body: "down" }]);
		const exa = createExaProvider({ apiKey: "k", fetchImpl: mock });
		await assert.rejects(async () => exa.search("q", 3), (err: Error) => {
			return err.message.includes("unavailable") && err.message.includes("503");
		});
	});

	it("maps result with missing title to url or (untitled)", async () => {
		const { mock } = makeFetchMock([
			{ ok: true, status: 200, body: { results: [{ url: "https://x", text: "t" }] } },
		]);
		const exa = createExaProvider({ apiKey: "k", fetchImpl: mock });
		const out = await exa.search("q", 1);
		const r = out[0];
		assert.ok(r, "expected one result");
		assert.equal(r.title, "https://x");
	});

	it("truncates text to 1500 chars", async () => {
		const long = "x".repeat(3000);
		const { mock } = makeFetchMock([
			{ ok: true, status: 200, body: { results: [{ title: "T", url: "u", text: long }] } },
		]);
		const exa = createExaProvider({ apiKey: "k", fetchImpl: mock });
		const out = await exa.search("q", 1);
		const r = out[0];
		assert.ok(r, "expected one result");
		assert.equal(r.snippet.length, 1500);
	});
});

describe("Tavily provider", () => {
	it("POSTs to api.tavily.com/search with Bearer auth and correct body", async () => {
		const { mock, calls } = makeFetchMock([
			{
				ok: true,
				status: 200,
				body: {
					results: [
						{ title: "A", url: "https://a", content: "snippet a", score: 0.8, published_date: "2024-02-02" },
					],
				},
			},
		]);
		const tavily = createTavilyProvider({ apiKey: "tvly-test", fetchImpl: mock });
		const out = await tavily.search("hello", 5);
		assert.equal(calls.length, 1);
		assert.equal(calls[0]?.url, "https://api.tavily.com/search");
		assert.equal(calls[0]?.init.method, "POST");
		const headers = calls[0]?.init.headers as Record<string, string>;
		assert.equal(headers["Authorization"], "Bearer tvly-test");
		const body = JSON.parse(calls[0]?.init.body as string);
		assert.deepEqual(body, { query: "hello", max_results: 5, search_depth: "basic" });
		assert.equal(out.length, 1);
		assert.equal(out[0]?.title, "A");
		assert.equal(out[0]?.score, 0.8);
		assert.equal(out[0]?.publishedDate, "2024-02-02");
	});

	it("throws auth error on 403", async () => {
		const { mock } = makeFetchMock([{ ok: false, status: 403, body: "forbidden" }]);
		const tavily = createTavilyProvider({ apiKey: "bad", fetchImpl: mock });
		await assert.rejects(async () => tavily.search("q", 3), (err: Error) => {
			return err.message.includes("Invalid API key for tavily") && err.message.includes("403");
		});
	});

	it("throws rate-limit on 429", async () => {
		const { mock } = makeFetchMock([{ ok: false, status: 429, body: "slow down" }]);
		const tavily = createTavilyProvider({ apiKey: "k", fetchImpl: mock });
		await assert.rejects(async () => tavily.search("q", 3), (err: Error) => {
			return err.message.includes("Rate limited");
		});
	});

	it("maps network error to unavailable kind", async () => {
		const mock: typeof fetch = async () => {
			throw new Error("ECONNREFUSED");
		};
		const tavily = createTavilyProvider({ apiKey: "k", fetchImpl: mock });
		await assert.rejects(async () => tavily.search("q", 3), (err: Error) => {
			return err.message.includes("Network error") && err.message.includes("ECONNREFUSED");
		});
	});
});

describe("error helpers", () => {
	it("classifyStatus maps codes to categories", () => {
		assert.equal(classifyStatus(401), "auth");
		assert.equal(classifyStatus(403), "auth");
		assert.equal(classifyStatus(429), "rate-limit");
		assert.equal(classifyStatus(500), "unavailable");
		assert.equal(classifyStatus(503), "unavailable");
		assert.equal(classifyStatus(400), "bad-request");
		assert.equal(classifyStatus(404), "bad-request");
		assert.equal(classifyStatus(200), "unknown");
	});

	it("httpError produces readable message", () => {
		const e = httpError("exa", 401, "");
		assert.equal(e.kind, "auth");
		assert.match(e.message, /Invalid API key/);
		assert.equal(e.status, 401);
	});

	it("networkError handles AbortError specially", () => {
		const err = new Error("aborted");
		err.name = "AbortError";
		const e = networkError("tavily", err);
		assert.equal(e.kind, "unavailable");
		assert.match(e.message, /cancelled/);
	});

	it("networkError handles unknown error type", () => {
		const e = networkError("exa", "weird");
		assert.equal(e.kind, "unavailable");
		assert.match(e.message, /Network error/);
	});
});

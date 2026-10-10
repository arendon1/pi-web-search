import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { availableProviders, clearCache, maskResolvedKeys, resolveKeys } from "../src/config.ts";

let work: string;
let home: string;
let originalEnv: NodeJS.ProcessEnv;

beforeEach(() => {
	originalEnv = { ...process.env };
	delete process.env.EXA_API_KEY;
	delete process.env.TAVILY_API_KEY;
	work = mkdtempSync(join(tmpdir(), "pi-web-search-cwd-"));
	home = mkdtempSync(join(tmpdir(), "pi-web-search-home-"));
	clearCache();
});

afterEach(() => {
	process.env = originalEnv;
	rmSync(work, { recursive: true, force: true });
	rmSync(home, { recursive: true, force: true });
	clearCache();
});

describe("resolveKeys", () => {
	it("returns nulls when no keys are anywhere", async () => {
		const out = await resolveKeys(work, { homeDir: home });
		assert.equal(out.exa, null);
		assert.equal(out.tavily, null);
		assert.deepEqual(availableProviders(out), []);
	});

	it("process.env wins over .env files", async () => {
		process.env.EXA_API_KEY = "from-env";
		writeFileSync(join(work, ".env"), "EXA_API_KEY=from-cwd-env\nTAVILY_API_KEY=from-cwd-env");
		const out = await resolveKeys(work, { homeDir: home });
		assert.equal(out.exa?.value, "from-env");
		assert.equal(out.exa?.source, "env");
		assert.equal(out.tavily?.value, "from-cwd-env");
		assert.equal(out.tavily?.source, "cwd-env");
	});

	it("falls back to cwd .env when env is empty", async () => {
		writeFileSync(join(work, ".env"), "EXA_API_KEY=cwd-key\n");
		const out = await resolveKeys(work, { homeDir: home });
		assert.equal(out.exa?.value, "cwd-key");
		assert.equal(out.exa?.source, "cwd-env");
	});

	it("falls back to global ~/.pi/agent/.env when cwd .env misses", async () => {
		mkdirSync(join(home, ".pi", "agent"), { recursive: true });
		writeFileSync(join(home, ".pi", "agent", ".env"), "TAVILY_API_KEY=global-key\n");
		const out = await resolveKeys(work, { homeDir: home });
		assert.equal(out.tavily?.value, "global-key");
		assert.equal(out.tavily?.source, "global-env");
	});

	it("cwd .env wins over global .env", async () => {
		writeFileSync(join(work, ".env"), "EXA_API_KEY=cwd-key");
		mkdirSync(join(home, ".pi", "agent"), { recursive: true });
		writeFileSync(join(home, ".pi", "agent", ".env"), "EXA_API_KEY=global-key");
		const out = await resolveKeys(work, { homeDir: home });
		assert.equal(out.exa?.value, "cwd-key");
		assert.equal(out.exa?.source, "cwd-env");
	});

	it("ignores empty/whitespace values in .env", async () => {
		writeFileSync(join(work, ".env"), "EXA_API_KEY=\nTAVILY_API_KEY=   \n");
		const out = await resolveKeys(work, { homeDir: home });
		assert.equal(out.exa, null);
		assert.equal(out.tavily, null);
	});

	it("does not merge .env into process.env", async () => {
		writeFileSync(join(work, ".env"), "EXA_API_KEY=should-not-leak");
		await resolveKeys(work, { homeDir: home });
		assert.equal(process.env.EXA_API_KEY, undefined);
	});

	it("reads from a custom env object when provided", async () => {
		const out = await resolveKeys(work, { env: { EXA_API_KEY: "injected" }, homeDir: home });
		assert.equal(out.exa?.value, "injected");
		assert.equal(out.exa?.source, "env");
	});

	it("returns both providers when both are configured", async () => {
		process.env.EXA_API_KEY = "e";
		process.env.TAVILY_API_KEY = "t";
		const out = await resolveKeys(work, { homeDir: home });
		assert.deepEqual(availableProviders(out), ["exa", "tavily"]);
	});
});

describe("maskResolvedKeys", () => {
	it("shows (not set) for missing providers", async () => {
		const out = await resolveKeys(work, { homeDir: home });
		assert.deepEqual(maskResolvedKeys(out), { exa: "(not set)", tavily: "(not set)" });
	});

	it("masks configured keys", async () => {
		process.env.EXA_API_KEY = "tvly-verylongapikey123";
		const out = await resolveKeys(work, { homeDir: home });
		assert.equal(maskResolvedKeys(out).exa, "tvly****23");
	});
});

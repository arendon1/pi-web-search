/**
 * Resolves API keys for the Exa and Tavily providers.
 *
 * Resolution order (first non-empty wins per provider):
 *   1. process.env (`EXA_API_KEY`, `TAVILY_API_KEY`) — never overwritten by .env values
 *   2. `${cwd}/.env` — project-local
 *   3. `~/.pi/agent/.env` — global fallback
 *
 * The cwd .env and global .env files are read lazily and cached by path + mtime.
 * Cached values are NOT merged into process.env.
 */

import { existsSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { homedir as osHomedir } from "node:os";
import { maskKey as _maskKey, parseDotenv } from "./dotenv.ts";

export type ProviderName = "exa" | "tavily";

/** Where a key was resolved from. */
export type KeySource = "env" | "cwd-env" | "global-env";

export interface ResolvedKey {
	value: string;
	source: KeySource;
}

export type ResolvedKeys = Record<ProviderName, ResolvedKey | null>;

const KEY_NAMES: Record<ProviderName, string> = {
	exa: "EXA_API_KEY",
	tavily: "TAVILY_API_KEY",
};

interface CacheEntry {
	mtime: number;
	data: Record<string, string>;
}

// Module-level cache keyed by absolute file path.
const fileCache = new Map<string, CacheEntry>();

/** Reset the .env file cache. Useful for tests and reload semantics. */
export function clearCache(): void {
	fileCache.clear();
}

/**
 * Read and parse a .env file at `path`, caching by mtime.
 * Returns null if the file doesn't exist. Throws on read errors other than ENOENT.
 */
async function readEnvFile(path: string): Promise<Record<string, string> | null> {
	if (!existsSync(path)) {
		fileCache.delete(path);
		return null;
	}

	let mtime: number;
	try {
		const st = await stat(path);
		mtime = st.mtimeMs;
	} catch {
		// Race: file disappeared between existsSync and stat.
		fileCache.delete(path);
		return null;
	}

	const cached = fileCache.get(path);
	if (cached && cached.mtime === mtime) {
		return cached.data;
	}

	const text = await readFile(path, "utf8");
	const data = parseDotenv(text);
	fileCache.set(path, { mtime, data });
	return data;
}

export interface ResolveOptions {
	/** Defaults to process.env. */
	env?: NodeJS.ProcessEnv;
	/** Defaults to os.homedir(). The directory whose `~/.pi/agent/.env` we read. */
	homeDir?: string;
	/** When true, skip the cache. Used by tests. */
	noCache?: boolean;
}

/**
 * Resolve keys for both providers. A provider is null if no key is found anywhere.
 * process.env always wins; .env files are only consulted for missing keys.
 */
export async function resolveKeys(
	cwd: string,
	opts: ResolveOptions = {},
): Promise<ResolvedKeys> {
	const env = opts.env ?? process.env;
	const homeDir = opts.homeDir ?? osHomedir();

	const cwdEnv = opts.noCache ? await readEnvFileNoCache(join(cwd, ".env")) : await readEnvFile(join(cwd, ".env"));
	const globalEnv = opts.noCache
		? await readEnvFileNoCache(join(homeDir, ".pi", "agent", ".env"))
		: await readEnvFile(join(homeDir, ".pi", "agent", ".env"));

	const out: ResolvedKeys = { exa: null, tavily: null };
	for (const provider of ["exa", "tavily"] as const) {
		const name = KEY_NAMES[provider];
		const fromProcess = env[name];
		if (fromProcess && fromProcess.trim()) {
			out[provider] = { value: fromProcess, source: "env" };
			continue;
		}
		const fromCwd = cwdEnv?.[name];
		if (fromCwd && fromCwd.trim()) {
			out[provider] = { value: fromCwd, source: "cwd-env" };
			continue;
		}
		const fromGlobal = globalEnv?.[name];
		if (fromGlobal && fromGlobal.trim()) {
			out[provider] = { value: fromGlobal, source: "global-env" };
			continue;
		}
		out[provider] = null;
	}
	return out;
}

async function readEnvFileNoCache(path: string): Promise<Record<string, string> | null> {
	if (!existsSync(path)) return null;
	const text = await readFile(path, "utf8");
	return parseDotenv(text);
}

/** Produce a masked-keys report for the `/websearch` status command. */
export function maskResolvedKeys(keys: ResolvedKeys): Record<ProviderName, string> {
	return {
		exa: keys.exa ? _maskKey(keys.exa.value) : "(not set)",
		tavily: keys.tavily ? _maskKey(keys.tavily.value) : "(not set)",
	};
}

/** Returns the providers that have a key configured, in priority order (exa first). */
export function availableProviders(keys: ResolvedKeys): ProviderName[] {
	const out: ProviderName[] = [];
	if (keys.exa) out.push("exa");
	if (keys.tavily) out.push("tavily");
	return out;
}

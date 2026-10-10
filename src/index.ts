/**
 * pi-web-search — adds a `web_search` tool backed by Exa and Tavily.
 *
 * Resolution order for API keys (per provider, first non-empty wins):
 *   1. process.env (`EXA_API_KEY`, `TAVILY_API_KEY`)
 *   2. `${cwd}/.env`
 *   3. `~/.pi/agent/.env`
 *
 * Backend selection: `auto` (default) uses Exa if available, else Tavily. With
 * `backend: "exa" | "tavily"` you can pin a specific provider. In `auto` mode a
 * transient failure (network, 5xx, 429) falls back once to the other provider
 * when its key is present; an auth error (401/403) is reported as-is so the user
 * is told to fix the key rather than burning the other provider's quota.
 *
 * Slash command: `/websearch` — prints resolved keys (masked) and their source.
 */

import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type, type Static } from "typebox";
import { availableProviders, resolveKeys, type ProviderName } from "./config.ts";
import { formatResults, noKeysMessage } from "./format.ts";
import { createExaProvider } from "./providers/exa.ts";
import { createTavilyProvider } from "./providers/tavily.ts";
import type { SearchProvider } from "./providers/provider.ts";
import type { SearchResult } from "./types.ts";

const SearchParams = Type.Object({
	query: Type.String({ description: "The search query" }),
	max_results: Type.Optional(
		Type.Number({
			description: "Number of results to return (1-10, default 5)",
			minimum: 1,
			maximum: 10,
			default: 5,
		}),
	),
	backend: Type.Optional(
		Type.Union([Type.Literal("auto"), Type.Literal("exa"), Type.Literal("tavily")], {
			description: 'Which provider to use. "auto" picks the first available and falls back on transient errors. Default: "auto".',
		}),
	),
});

const SearchOutputSchema = Type.Object({
	query: Type.String(),
	backend: Type.Union([Type.Literal("exa"), Type.Literal("tavily")]),
	fallbackUsed: Type.Boolean(),
	resultCount: Type.Number(),
	results: Type.Array(
		Type.Object({
			title: Type.String(),
			url: Type.String(),
			snippet: Type.String(),
			publishedDate: Type.Optional(Type.String()),
			score: Type.Optional(Type.Number()),
		}),
	),
});

type SearchOutput = Static<typeof SearchOutputSchema>;

function pickProviders(
	backend: "auto" | ProviderName,
	have: Record<ProviderName, { value: string } | null>,
): { primary: ProviderName | null; fallback: ProviderName | null; pinError?: string } {
	const exaOk = !!have.exa;
	const tavilyOk = !!have.tavily;
	if (backend === "exa") {
		return exaOk ? { primary: "exa", fallback: tavilyOk ? "tavily" : null } : { primary: null, fallback: null, pinError: "exa" };
	}
	if (backend === "tavily") {
		return tavilyOk ? { primary: "tavily", fallback: exaOk ? "exa" : null } : { primary: null, fallback: null, pinError: "tavily" };
	}
	if (exaOk) return { primary: "exa", fallback: tavilyOk ? "tavily" : null };
	if (tavilyOk) return { primary: "tavily", fallback: null };
	return { primary: null, fallback: null };
}

function buildProvider(name: ProviderName, apiKey: string): SearchProvider {
	return name === "exa" ? createExaProvider({ apiKey }) : createTavilyProvider({ apiKey });
}

function isTransient(msg: string): boolean {
	return /unavailable|rate.?limit|Network error|cancelled/i.test(msg);
}

const webSearchTool = defineTool({
	name: "web_search",
	label: "Web Search",
	description:
		"Search the public web using Exa (preferred) or Tavily. Returns a numbered markdown list of " +
		"{title, url, snippet, publishedDate} results. Configure EXA_API_KEY and/or TAVILY_API_KEY in " +
		"env, project .env, or ~/.pi/agent/.env. Use backend='exa' or 'tavily' to pin a provider, or " +
		"'auto' (default) to use the first available with one-shot fallback on transient errors. " +
		"max_results defaults to 5 and is clamped to 1-10.",
	promptSnippet: "Search the public web. Returns a numbered markdown list of results.",
	parameters: SearchParams,
	outputSchema: SearchOutputSchema,
	annotations: { readOnlyHint: true, openWorldHint: true },

	async execute(_toolCallId, params, signal, _onUpdate, ctx) {
		const query = params.query.trim();
		const baseDetails = {
			query,
			resultCount: 0,
			fallbackUsed: false,
			results: [] as SearchResult[],
		};

		if (!query) {
			return {
				content: [{ type: "text", text: "web_search: query must not be empty." }],
				details: { ...baseDetails, backend: "exa" as const },
				isError: true,
			};
		}
		const maxResults = Math.max(1, Math.min(10, params.max_results ?? 5));
		const backend = (params.backend ?? "auto") as "auto" | ProviderName;

		const keys = await resolveKeys(ctx.cwd);
		if (availableProviders(keys).length === 0) {
			return {
				content: [{ type: "text", text: noKeysMessage() }],
				details: { ...baseDetails, backend: "exa" as const },
				isError: true,
			};
		}

		const pick = pickProviders(backend, keys);
		if (!pick.primary) {
			const want = pick.pinError ?? "?";
			return {
				content: [
					{
						type: "text",
						text: `web_search: backend "${want}" is not configured. Set ${want.toUpperCase()}_API_KEY or use backend="auto".`,
					},
				],
				details: { ...baseDetails, backend: "exa" as const },
				isError: true,
			};
		}

		const primaryKey = keys[pick.primary]?.value;
		if (!primaryKey) {
			return {
				content: [{ type: "text", text: `web_search: missing key for ${pick.primary}.` }],
				details: { ...baseDetails, backend: pick.primary },
				isError: true,
			};
		}

		const tryProvider = async (name: ProviderName, apiKey: string): Promise<SearchResult[]> => {
			const provider = buildProvider(name, apiKey);
			return provider.search(query, maxResults, signal);
		};

		let used: ProviderName = pick.primary;
		let fallbackUsed = false;
		let results: SearchResult[] = [];
		try {
			results = await tryProvider(pick.primary, primaryKey);
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			if (pick.fallback && keys[pick.fallback]?.value && isTransient(msg)) {
				const fbKey = keys[pick.fallback]?.value;
				if (fbKey) {
					try {
						results = await tryProvider(pick.fallback, fbKey);
						used = pick.fallback;
						fallbackUsed = true;
					} catch (err2) {
						const msg2 = err2 instanceof Error ? err2.message : String(err2);
						return {
							content: [
								{
									type: "text",
									text: `web_search: ${pick.primary} failed (${msg}); fallback to ${pick.fallback} also failed: ${msg2}`,
								},
							],
							details: { ...baseDetails, backend: pick.primary, fallbackUsed },
							isError: true,
						};
					}
				} else {
					return {
						content: [{ type: "text", text: `web_search: ${msg}` }],
						details: { ...baseDetails, backend: pick.primary, fallbackUsed },
						isError: true,
					};
				}
			} else {
				return {
					content: [{ type: "text", text: `web_search: ${msg}` }],
					details: { ...baseDetails, backend: pick.primary, fallbackUsed },
					isError: true,
				};
			}
		}

		const text = formatResults(results, { backend: used, fallbackUsed });
		const output: SearchOutput = {
			query,
			backend: used,
			fallbackUsed,
			resultCount: results.length,
			results: results.map((r) => ({
				title: r.title,
				url: r.url,
				snippet: r.snippet,
				...(r.publishedDate ? { publishedDate: r.publishedDate } : {}),
				...(typeof r.score === "number" ? { score: r.score } : {}),
			})),
		};
		return {
			content: [{ type: "text", text }],
			details: output,
			structuredContent: output,
		};
	},
});

export default function (pi: ExtensionAPI) {
	pi.registerTool(webSearchTool);
}

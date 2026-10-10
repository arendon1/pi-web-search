/**
 * Tavily search provider.
 *
 * Docs: https://docs.tavily.com/docs/rest-api/api-reference
 *
 * Request:
 *   POST https://api.tavily.com/search
 *   Headers: Authorization: Bearer <key>, Content-Type: application/json
 *   Body: { query, max_results, search_depth: "basic" }
 *
 * Response:
 *   { query, answer, results: [{ title, url, content, score, published_date }] }
 */

import { httpError, networkError, type SearchProvider } from "./provider.ts";
import type { SearchResult } from "../types.ts";

const ENDPOINT = "https://api.tavily.com/search";
const SNIPPET_MAX_CHARS = 1500;

export interface TavilyProviderOptions {
	apiKey: string;
	fetchImpl?: typeof fetch;
}

export function createTavilyProvider(opts: TavilyProviderOptions): SearchProvider {
	const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
	if (!fetchImpl) {
		throw new Error("Tavily provider requires global fetch (Node 18+) or an injected fetchImpl");
	}

	return {
		name: "tavily",
		isConfigured: !!opts.apiKey,
		async search(query: string, maxResults: number, signal?: AbortSignal): Promise<SearchResult[]> {
			const body = JSON.stringify({
				query,
				max_results: maxResults,
				search_depth: "basic",
			});

			let res: Response;
			try {
				res = await fetchImpl(ENDPOINT, {
					method: "POST",
					headers: {
						Authorization: `Bearer ${opts.apiKey}`,
						"Content-Type": "application/json",
					},
					body,
					signal,
				});
			} catch (err) {
				throw networkError("tavily", err);
			}

			if (!res.ok) {
				const text = await res.text().catch(() => "");
				throw httpError("tavily", res.status, text);
			}

			const data = (await res.json()) as {
				results?: Array<{
					title?: string;
					url?: string;
					content?: string;
					score?: number;
					published_date?: string;
				}>;
			};
			const raw = data.results ?? [];
			return raw.map((r) => ({
				title: r.title ?? r.url ?? "(untitled)",
				url: r.url ?? "",
				snippet: (r.content ?? "").slice(0, SNIPPET_MAX_CHARS),
				...(typeof r.score === "number" ? { score: r.score } : {}),
				...(r.published_date ? { publishedDate: r.published_date } : {}),
			}));
		},
	};
}

/**
 * Exa search provider.
 *
 * Docs: https://docs.exa.ai/reference/search
 *
 * Request:
 *   POST https://api.exa.ai/search
 *   Headers: x-api-key: <key>, Content-Type: application/json
 *   Body: { query, numResults, text: { maxCharacters: 1500 } }
 *
 * Response:
 *   { requestId, resolvedSearchType, results: [{ title, url, text, publishedDate, score, ... }] }
 */

import { httpError, networkError, type SearchProvider } from "./provider.ts";
import type { SearchResult } from "../types.ts";

const ENDPOINT = "https://api.exa.ai/search";
const SNIPPET_MAX_CHARS = 1500;

export interface ExaProviderOptions {
	apiKey: string;
	fetchImpl?: typeof fetch;
}

export function createExaProvider(opts: ExaProviderOptions): SearchProvider {
	const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
	if (!fetchImpl) {
		throw new Error("Exa provider requires global fetch (Node 18+) or an injected fetchImpl");
	}

	return {
		name: "exa",
		isConfigured: !!opts.apiKey,
		async search(query: string, maxResults: number, signal?: AbortSignal): Promise<SearchResult[]> {
			const body = JSON.stringify({
				query,
				numResults: maxResults,
				text: { maxCharacters: SNIPPET_MAX_CHARS },
			});

			let res: Response;
			try {
				res = await fetchImpl(ENDPOINT, {
					method: "POST",
					headers: {
						"x-api-key": opts.apiKey,
						"Content-Type": "application/json",
					},
					body,
					signal,
				});
			} catch (err) {
				throw networkError("exa", err);
			}

			if (!res.ok) {
				const text = await res.text().catch(() => "");
				throw httpError("exa", res.status, text);
			}

			const data = (await res.json()) as {
				results?: Array<{
					title?: string;
					url?: string;
					text?: string;
					publishedDate?: string;
					score?: number;
				}>;
			};
			const raw = data.results ?? [];
			return raw.map((r) => ({
				title: r.title ?? r.url ?? "(untitled)",
				url: r.url ?? "",
				snippet: (r.text ?? "").slice(0, 1500),
				...(r.publishedDate ? { publishedDate: r.publishedDate } : {}),
				...(typeof r.score === "number" ? { score: r.score } : {}),
			}));
		},
	};
}

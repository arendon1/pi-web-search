/**
 * Shared types for the web_search tool and its providers.
 */

export interface SearchResult {
	title: string;
	url: string;
	snippet: string;
	publishedDate?: string;
	score?: number;
}

export type ProviderName = "exa" | "tavily";

export type SearchErrorKind = "auth" | "rate-limit" | "unavailable" | "bad-request" | "unknown";

export interface SearchError {
	kind: SearchErrorKind;
	message: string;
	status?: number;
}

export type SearchOutcome = { ok: true; results: SearchResult[] } | { ok: false; error: SearchError };

/** What the `web_search` tool returns to pi in the `details` field. */
export type ToolDetails = {
	query: string;
	backend: ProviderName;
	resultCount: number;
	fallbackUsed: boolean;
	results: SearchResult[];
	[key: string]: unknown;
};

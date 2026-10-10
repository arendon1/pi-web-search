/**
 * Provider interface and shared HTTP error classification.
 *
 * Providers translate SearchResult into provider-specific API calls and back.
 * The orchestrator in src/index.ts handles backend selection and fallback.
 */

import type { ProviderName, SearchError, SearchErrorKind, SearchResult } from "../types.ts";

/** A single search provider bound to an API key. */
export interface SearchProvider {
	readonly name: ProviderName;
	readonly isConfigured: boolean;
	search(query: string, maxResults: number, signal?: AbortSignal): Promise<SearchResult[]>;
}

/** Classify an HTTP status code into a SearchError category. */
export function classifyStatus(status: number): SearchErrorKind {
	if (status === 401 || status === 403) return "auth";
	if (status === 429) return "rate-limit";
	if (status >= 500 && status < 600) return "unavailable";
	if (status >= 400 && status < 500) return "bad-request";
	return "unknown";
}

/** Build a SearchError from an HTTP failure with provider context. */
export function httpError(provider: ProviderName, status: number, bodyText: string): SearchError {
	const kind = classifyStatus(status);
	const bodySnippet = bodyText.length > 200 ? `${bodyText.slice(0, 200)}…` : bodyText;
	let message: string;
	switch (kind) {
		case "auth":
			message = `Invalid API key for ${provider} (HTTP ${status}). Check your ${provider.toUpperCase()}_API_KEY.`;
			break;
		case "rate-limit":
			message = `Rate limited by ${provider} (HTTP 429). Try again later or use a different backend.`;
			break;
		case "unavailable":
			message = `${provider} is unavailable (HTTP ${status}). ${bodySnippet}`;
			break;
		case "bad-request":
			message = `${provider} rejected the request (HTTP ${status}). ${bodySnippet}`;
			break;
		default:
			message = `${provider} returned HTTP ${status}. ${bodySnippet}`;
	}
	return { kind, message, status };
}

/** Build a SearchError for a network / DNS / abort / JSON-parse failure. */
export function networkError(provider: ProviderName, err: unknown): SearchError {
	let message: string;
	if (err instanceof Error) {
		if (err.name === "AbortError") {
			message = `Request to ${provider} was cancelled.`;
		} else {
			message = `Network error contacting ${provider}: ${err.message}`;
		}
	} else {
		message = `Network error contacting ${provider}: ${String(err)}`;
	}
	return { kind: "unavailable", message };
}

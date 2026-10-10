/**
 * Render SearchResult[] as a compact, model-friendly markdown list.
 *
 * Format per result:
 *   1. [Title](url)
 *      snippet (single line, collapsed whitespace) — publishedDate
 *
 * Hard cap of ~8 KB total output, with up to MAX_RESULTS results.
 * If the cap is hit, append a truncation note.
 */

import type { ProviderName, SearchResult } from "./types.ts";

const MAX_BYTES = 8 * 1024;
const MAX_RESULTS = 10;
const SNIPPET_LINE_CHARS = 500;

function oneLine(s: string): string {
	return s.replace(/\s+/g, " ").trim();
}

export interface FormatOptions {
	backend: ProviderName;
	fallbackUsed: boolean;
}

export function formatResults(results: SearchResult[], opts: FormatOptions): string {
	const limited = results.slice(0, MAX_RESULTS);
	const lines: string[] = [];

	limited.forEach((r, i) => {
		const title = r.title?.trim() || r.url || "(untitled)";
		const snippet = oneLine(r.snippet || "").slice(0, SNIPPET_LINE_CHARS);
		const url = r.url || "(no url)";
		const head = `${i + 1}. [${title}](${url})`;
		lines.push(head);
		if (snippet) {
			const tail = r.publishedDate ? ` — ${r.publishedDate}` : "";
			lines.push(`   ${snippet}${tail}`);
		} else if (r.publishedDate) {
			lines.push(`   ${r.publishedDate}`);
		}
		lines.push("");
	});

	if (results.length > MAX_RESULTS) {
		lines.push(`(Showing ${MAX_RESULTS} of ${results.length} results.)`);
		lines.push("");
	}

	lines.push(`Served by: ${opts.backend}${opts.fallbackUsed ? " (fallback)" : ""}.`);

	let text = lines.join("\n");
	const encoder = new TextEncoder();
	if (encoder.encode(text).length > MAX_BYTES) {
		// Truncate line-by-line until under the cap. Preserve the footer.
		const footer = lines[lines.length - 1];
		const body = lines.slice(0, -1);
		const kept: string[] = [];
		let size = encoder.encode(footer).length;
		for (const line of body) {
			const lineBytes = encoder.encode(`${line}\n`).length;
			if (size + lineBytes > MAX_BYTES) break;
			kept.push(line);
			size += lineBytes;
		}
		text = `${kept.join("\n")}\n…(truncated for length)\n${footer}`;
	}

	return text;
}

/** Plain-text hint shown to the user when no providers are configured. */
export function noKeysMessage(): string {
	return [
		"web_search is not configured: no API key found for either Exa or Tavily.",
		"",
		"Set one of these to enable web search:",
		"  - EXA_API_KEY    (https://exa.ai)",
		"  - TAVILY_API_KEY (https://tavily.com)",
		"",
		"Keys can be set via:",
		"  - environment variables",
		"  - a .env file in the project directory",
		"  - ~/.pi/agent/.env (global)",
		"",
		"Run /websearch to see resolved configuration.",
	].join("\n");
}

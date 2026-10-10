/**
 * Minimal zero-dependency .env parser.
 *
 * Supports:
 *   - blank lines
 *   - `#` and `//` comments
 *   - optional `export ` prefix
 *   - KEY=VALUE split on the first `=`
 *   - trimming whitespace
 *   - unquoted, single-quoted, and double-quoted values
 *   - basic double-quote escape sequences: \n \r \t \\ \" and \0..\7
 *
 * Does NOT support:
 *   - variable interpolation (`$FOO` or `${FOO}`)
 *   - multi-line values
 *   - command substitution
 *   - unicode escape sequences beyond what JSON does
 *
 * Returns a plain object. Values are always strings (or undefined if absent).
 */

/** Escape a double-quoted value's body. */
function unescapeDoubleQuoted(raw: string): string {
	let out = "";
	let i = 0;
	while (i < raw.length) {
		const ch = raw[i];
		if (ch === "\\" && i + 1 < raw.length) {
			const next = raw[i + 1];
			switch (next) {
				case "n":
					out += "\n";
					break;
				case "r":
					out += "\r";
					break;
				case "t":
					out += "\t";
					break;
				case "\\":
					out += "\\";
					break;
				case '"':
					out += '"';
					break;
				case "0":
				case "1":
				case "2":
				case "3":
				case "4":
				case "5":
				case "6":
				case "7": {
					// Octal escape (1-3 digits) — keep as-is, like a real shell would.
					let oct = next;
					let j = i + 2;
					while (j < raw.length && oct.length < 3 && /[0-7]/.test(raw[j] ?? "")) {
						oct += raw[j];
						j++;
					}
					out += `\\${oct}`;
					i = j;
					continue;
				}
				default:
					// Unknown escape: keep the backslash and the next char literally.
					out += ch + next;
					break;
			}
			i += 2;
		} else {
			out += ch;
			i++;
		}
	}
	return out;
}

function unquote(value: string): string {
	if (value.length >= 2) {
		const first = value[0];
		const last = value[value.length - 1];
		if (first === '"' && last === '"') {
			return unescapeDoubleQuoted(value.slice(1, -1));
		}
		if (first === "'" && last === "'") {
			// Single-quoted: literal content, no escapes processed.
			return value.slice(1, -1);
		}
	}
	return value;
}

/** Parse a single .env file body into a key→value record. */
export function parseDotenv(source: string): Record<string, string> {
	const result: Record<string, string> = {};
	const lines = source.split(/\r?\n/);

	for (const rawLine of lines) {
		const line = rawLine.trim();
		if (!line) continue;
		// Comments: # at start, or after whitespace.
		if (line.startsWith("#") || line.startsWith("//")) continue;

		// Optional `export ` prefix.
		let body = line;
		if (body.startsWith("export ")) {
			body = body.slice("export ".length).trimStart();
		}
		// `export` alone (no space) — not a key, treat as a stray token, skip.
		if (body === "export") continue;

		const eq = body.indexOf("=");
		if (eq === -1) continue; // malformed — no `=`

		const key = body.slice(0, eq).trim();
		if (!key) continue; // empty key
		// Reject keys with whitespace or `=`.
		if (/\s/.test(key) || key.includes("=")) continue;

		const rawValue = body.slice(eq + 1);
		// Strip an inline `#` comment that is preceded by whitespace and not inside quotes.
		// (We approximate "inside quotes" by scanning from the start.)
		let value = stripInlineComment(rawValue).trim();
		value = unquote(value);

		result[key] = value;
	}

	return result;
}

/**
 * If a `#` appears after the first non-whitespace segment and the value isn't quoted
 * (i.e. doesn't start with a quote), truncate at the first `#` that follows whitespace
 * or sits at end of string. This is a simplification — real shell behaviour is more nuanced.
 */
function stripInlineComment(raw: string): string {
	const trimmed = raw.trimStart();
	if (trimmed.startsWith('"') || trimmed.startsWith("'")) {
		// Quoted value: don't strip; the closing quote terminates the value.
		// But we still want to stop at the first unescaped closing quote.
		const quote = trimmed[0];
		let i = 1;
		while (i < trimmed.length) {
			if (quote === '"' && trimmed[i] === "\\") {
				i += 2;
				continue;
			}
			if (trimmed[i] === quote) {
				return trimmed.slice(0, i + 1);
			}
			i++;
		}
		// Unterminated quote — return as-is.
		return trimmed;
	}
	// Unquoted: stop at first `#` preceded by whitespace, or `#` at end.
	const hashIdx = findUnquotedHash(trimmed);
	return hashIdx === -1 ? trimmed : trimmed.slice(0, hashIdx);
}

function findUnquotedHash(s: string): number {
	for (let i = 0; i < s.length; i++) {
		const ch = s[i];
		if (ch === "#") {
			if (i === 0 || /\s/.test(s[i - 1] ?? "")) {
				return i;
			}
		}
	}
	return -1;
}

/** Mask a key for safe display. Returns a redacted version with a 4-char prefix + 2-char suffix. */
export function maskKey(key: string | undefined | null): string {
	if (!key) return "(not set)";
	if (key.length <= 8) return "*".repeat(key.length);
	return `${key.slice(0, 4)}****${key.slice(-2)}`;
}

export type TokenKind = "num" | "id" | "unit" | "op" | "kw" | "pct" | "ws" | "text" | "linref" | "totalref";
export interface Token {
  kind: TokenKind;
  text: string;
}

export interface TokenizeOptions {
  identifiers: ReadonlySet<string>;
  multiWord: ReadonlySet<string>;
  isUnit: (name: string) => boolean;
}

const KEYWORDS = new Set(["of", "in", "to"]);
const NUMBER_RE = /^\d+(?:\.\d+)?/;
const WORD_RE = /^[A-Za-z_][A-Za-z0-9_]*/;
const WS_RE = /^\s+/;
const OPERATOR_CHARS = new Set(["+", "-", "*", "/", "^", "=", "(", ")"]);

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildMultiWordRegex(name: string): RegExp {
  const parts = name.split(/\s+/).map(escapeRegex).join("\\s+");
  return new RegExp(`^${parts}\\b`);
}

export function tokenize(source: string, options: TokenizeOptions): Token[] {
  const { identifiers, multiWord, isUnit } = options;
  const sortedMultiWord = Array.from(multiWord).sort((a, b) => b.length - a.length);
  const compiledMultiWord = sortedMultiWord.map((name) => buildMultiWordRegex(name));

  const tokens: Token[] = [];
  let pos = 0;

  while (pos < source.length) {
    const rest = source.slice(pos);

    // 1. Multi-word names (longest first)
    let matched: string | null = null;
    for (const re of compiledMultiWord) {
      const m = re.exec(rest);
      if (m) {
        matched = m[0];
        break;
      }
    }
    if (matched !== null) {
      tokens.push({ kind: "id", text: matched });
      pos += matched.length;
      continue;
    }

    // 2. Number
    const numM = NUMBER_RE.exec(rest);
    if (numM) {
      tokens.push({ kind: "num", text: numM[0] });
      pos += numM[0].length;
      continue;
    }

    // 3. Percent
    if (rest[0] === "%") {
      tokens.push({ kind: "pct", text: "%" });
      pos += 1;
      continue;
    }

    // 4. Operators
    if (OPERATOR_CHARS.has(rest[0])) {
      tokens.push({ kind: "op", text: rest[0] });
      pos += 1;
      continue;
    }

    // 5. Word — could be keyword, linref, identifier, or unit
    const wordM = WORD_RE.exec(rest);
    if (wordM) {
      const w = wordM[0];
      let kind: TokenKind;
      if (KEYWORDS.has(w)) kind = "kw";
      else if (/^line\d+$/.test(w)) kind = "linref";
      else if (w === "total") kind = "totalref";
      else if (identifiers.has(w)) kind = "id";
      else if (isUnit(w)) kind = "unit";
      else kind = "id";
      tokens.push({ kind, text: w });
      pos += w.length;
      continue;
    }

    // 6. Whitespace
    const wsM = WS_RE.exec(rest);
    if (wsM) {
      tokens.push({ kind: "ws", text: wsM[0] });
      pos += wsM[0].length;
      continue;
    }

    // 7. Fallback — single char as text
    tokens.push({ kind: "text", text: rest[0] });
    pos += 1;
  }

  return tokens;
}

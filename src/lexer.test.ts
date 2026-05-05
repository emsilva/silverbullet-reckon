import { describe, it, expect } from "vitest";
import { tokenize } from "./lexer";

const empty = {
  identifiers: new Set<string>(),
  multiWord: new Set<string>(),
  isUnit: () => false,
};

describe("tokenize — single categories", () => {
  it("returns one num token for a bare number", () => {
    expect(tokenize("100", empty)).toEqual([{ kind: "num", text: "100" }]);
  });

  it("returns one num token for a decimal", () => {
    expect(tokenize("3.14", empty)).toEqual([{ kind: "num", text: "3.14" }]);
  });

  it("emits one pct token for `%`", () => {
    expect(tokenize("%", empty)).toEqual([{ kind: "pct", text: "%" }]);
  });

  it("emits one op token for each operator char", () => {
    for (const op of ["+", "-", "*", "/", "^", "=", "(", ")"]) {
      expect(tokenize(op, empty)).toEqual([{ kind: "op", text: op }]);
    }
  });

  it("emits a kw token for the three keywords", () => {
    for (const kw of ["of", "in", "to"]) {
      expect(tokenize(kw, empty)).toEqual([{ kind: "kw", text: kw }]);
    }
  });

  it("emits an id token for a bare unknown word (fallback)", () => {
    expect(tokenize("foo", empty)).toEqual([{ kind: "id", text: "foo" }]);
  });

  it("emits a ws token for whitespace runs", () => {
    expect(tokenize("   ", empty)).toEqual([{ kind: "ws", text: "   " }]);
  });

  it("returns [] for empty input", () => {
    expect(tokenize("", empty)).toEqual([]);
  });
});

describe("tokenize — composite expressions", () => {
  it("tokenizes `100 + 20%` as num ws op ws num pct", () => {
    expect(tokenize("100 + 20%", empty)).toEqual([
      { kind: "num", text: "100" },
      { kind: "ws", text: " " },
      { kind: "op", text: "+" },
      { kind: "ws", text: " " },
      { kind: "num", text: "20" },
      { kind: "pct", text: "%" },
    ]);
  });

  it("tokenizes `salary * 1.15` with identifier known", () => {
    const opts = { ...empty, identifiers: new Set(["salary"]) };
    expect(tokenize("salary * 1.15", opts)).toEqual([
      { kind: "id", text: "salary" },
      { kind: "ws", text: " " },
      { kind: "op", text: "*" },
      { kind: "ws", text: " " },
      { kind: "num", text: "1.15" },
    ]);
  });

  it("tokenizes `100 km in miles` with isUnit recognizing km/miles", () => {
    const opts = { ...empty, isUnit: (n: string) => n === "km" || n === "miles" };
    expect(tokenize("100 km in miles", opts)).toEqual([
      { kind: "num", text: "100" },
      { kind: "ws", text: " " },
      { kind: "unit", text: "km" },
      { kind: "ws", text: " " },
      { kind: "kw", text: "in" },
      { kind: "ws", text: " " },
      { kind: "unit", text: "miles" },
    ]);
  });

  it("tokenizes `20% of 450` with `of` as keyword", () => {
    expect(tokenize("20% of 450", empty)).toEqual([
      { kind: "num", text: "20" },
      { kind: "pct", text: "%" },
      { kind: "ws", text: " " },
      { kind: "kw", text: "of" },
      { kind: "ws", text: " " },
      { kind: "num", text: "450" },
    ]);
  });
});

describe("tokenize — multi-word longest-first", () => {
  it("treats a registered multi-word name as one id token", () => {
    const opts = { ...empty, multiWord: new Set(["current tax"]) };
    expect(tokenize("100 + current tax", opts)).toEqual([
      { kind: "num", text: "100" },
      { kind: "ws", text: " " },
      { kind: "op", text: "+" },
      { kind: "ws", text: " " },
      { kind: "id", text: "current tax" },
    ]);
  });

  it("matches longest first when names overlap", () => {
    const opts = {
      ...empty,
      multiWord: new Set(["current tax", "current tax inflation"]),
    };
    expect(tokenize("current tax inflation + 1", opts)).toEqual([
      { kind: "id", text: "current tax inflation" },
      { kind: "ws", text: " " },
      { kind: "op", text: "+" },
      { kind: "ws", text: " " },
      { kind: "num", text: "1" },
    ]);
  });

  it("matches a tab-separated reference against a space-registered name", () => {
    const opts = { ...empty, multiWord: new Set(["current tax"]) };
    expect(tokenize("current\ttax", opts)).toEqual([
      { kind: "id", text: "current\ttax" },
    ]);
  });

  it("does not false-match inside a longer identifier", () => {
    const opts = { ...empty, multiWord: new Set(["current tax"]) };
    expect(tokenize("mycurrent tax", opts)).toEqual([
      { kind: "id", text: "mycurrent" },
      { kind: "ws", text: " " },
      { kind: "id", text: "tax" },
    ]);
  });

  it("multi-word names with regex metacharacters are matched safely", () => {
    // escapeRegex defends against names containing regex special chars.
    const opts = {
      identifiers: new Set<string>(),
      multiWord: new Set(["q1 bonus.amount"]),
      isUnit: () => false,
    };
    expect(tokenize("q1 bonus.amount", opts)).toEqual([
      { kind: "id", text: "q1 bonus.amount" },
    ]);
  });
});

describe("tokenize — disambiguation", () => {
  it("prefers identifier over unit when name is in identifiers set", () => {
    const opts = {
      identifiers: new Set(["current"]),
      multiWord: new Set<string>(),
      isUnit: (n: string) => n === "current",  // would be a unit otherwise
    };
    expect(tokenize("current", opts)).toEqual([{ kind: "id", text: "current" }]);
  });

  it("returns id (fallback) when word is neither identifier nor unit", () => {
    expect(tokenize("xyz", empty)).toEqual([{ kind: "id", text: "xyz" }]);
  });

  it("a keyword in identifiers is still classified as kw (keyword precedence wins)", () => {
    const opts = {
      identifiers: new Set(["of"]),  // user shadowed `of` somehow
      multiWord: new Set<string>(),
      isUnit: () => false,
    };
    expect(tokenize("of", opts)).toEqual([{ kind: "kw", text: "of" }]);
  });
});

describe("tokenize — fallback text", () => {
  it("emits a text token for an unknown single character", () => {
    expect(tokenize("@", empty)).toEqual([{ kind: "text", text: "@" }]);
  });
});

describe("tokenize — linref kind for `lineN` references", () => {
  const noUnits = (_: string) => false;
  const opts = {
    identifiers: new Set<string>(),
    multiWord: new Set<string>(),
    isUnit: noUnits,
  };

  it("`line5` tokenizes as kind: 'linref'", () => {
    const tokens = tokenize("line5", opts);
    expect(tokens).toEqual([{ kind: "linref", text: "line5" }]);
  });

  it("`line17` tokenizes as kind: 'linref' (multi-digit)", () => {
    const tokens = tokenize("line17", opts);
    expect(tokens).toEqual([{ kind: "linref", text: "line17" }]);
  });

  it("`lineabc` stays as kind: 'id' (not all-digit suffix)", () => {
    const tokens = tokenize("lineabc", opts);
    expect(tokens).toEqual([{ kind: "id", text: "lineabc" }]);
  });

  it("`line` (bare word, no digits) stays as kind: 'id'", () => {
    const tokens = tokenize("line", opts);
    expect(tokens).toEqual([{ kind: "id", text: "line" }]);
  });

  it("`line5_x` stays as kind: 'id' (digits not at end)", () => {
    const tokens = tokenize("line5_x", opts);
    expect(tokens).toEqual([{ kind: "id", text: "line5_x" }]);
  });

  it("combined: `line5 + 10` produces [linref, ws, op, ws, num]", () => {
    const tokens = tokenize("line5 + 10", opts);
    expect(tokens).toEqual([
      { kind: "linref", text: "line5" },
      { kind: "ws", text: " " },
      { kind: "op", text: "+" },
      { kind: "ws", text: " " },
      { kind: "num", text: "10" },
    ]);
  });

  it("linref takes precedence over user identifiers (so `line5` user-var is colored as ref)", () => {
    const tokens = tokenize("line5", {
      identifiers: new Set(["line5"]),
      multiWord: new Set<string>(),
      isUnit: noUnits,
    });
    expect(tokens).toEqual([{ kind: "linref", text: "line5" }]);
  });
});

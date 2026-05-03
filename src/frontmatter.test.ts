import { describe, it, expect } from "vitest";
import { isReckonSheet, toggleReckonFrontmatter } from "./frontmatter";

describe("isReckonSheet", () => {
  it("returns false for a page with no frontmatter", () => {
    expect(isReckonSheet("just some text\n")).toBe(false);
  });

  it("returns false for frontmatter without a reckon key", () => {
    expect(isReckonSheet("---\ntags: foo\n---\n\nbody\n")).toBe(false);
  });

  it("returns true for frontmatter with reckon: true", () => {
    expect(isReckonSheet("---\nreckon: true\n---\n\nbody\n")).toBe(true);
  });

  it("accepts reckon: true alongside other keys", () => {
    expect(isReckonSheet("---\ntags: foo\nreckon: true\n---\nbody\n")).toBe(true);
  });

  it("returns false for reckon: false", () => {
    expect(isReckonSheet("---\nreckon: false\n---\n")).toBe(false);
  });

  it("returns false for quoted reckon: \"true\"", () => {
    expect(isReckonSheet("---\nreckon: \"true\"\n---\n")).toBe(false);
  });

  it("returns false for indented reckon: true (not top-level)", () => {
    expect(isReckonSheet("---\nfoo:\n  reckon: true\n---\n")).toBe(false);
  });

  it("returns false when frontmatter is unterminated", () => {
    expect(isReckonSheet("---\nreckon: true\n\nbody\n")).toBe(false);
  });

  it("returns false for empty input", () => {
    expect(isReckonSheet("")).toBe(false);
  });
});

describe("toggleReckonFrontmatter", () => {
  it("creates frontmatter when none exists", () => {
    expect(toggleReckonFrontmatter("hello\n")).toBe(
      "---\nreckon: true\n---\n\nhello\n",
    );
  });

  it("inserts reckon: true into existing frontmatter (before closing ---)", () => {
    const input = "---\ntags: foo\n---\n\nbody\n";
    const out = toggleReckonFrontmatter(input);
    expect(out).toBe("---\ntags: foo\nreckon: true\n---\n\nbody\n");
  });

  it("removes reckon: true when present, preserving other keys", () => {
    const input = "---\ntags: foo\nreckon: true\n---\n\nbody\n";
    const out = toggleReckonFrontmatter(input);
    expect(out).toBe("---\ntags: foo\n---\n\nbody\n");
  });

  it("strips frontmatter entirely when reckon: true was the only key", () => {
    const input = "---\nreckon: true\n---\n\nbody\n";
    const out = toggleReckonFrontmatter(input);
    expect(out).toBe("body\n");
  });

  it("creates frontmatter at the start of an empty page", () => {
    expect(toggleReckonFrontmatter("")).toBe("---\nreckon: true\n---\n\n");
  });

  it("round-trips: insert then remove yields original (with no leading --- block)", () => {
    const orig = "hello world\n";
    const inserted = toggleReckonFrontmatter(orig);
    const removed = toggleReckonFrontmatter(inserted);
    expect(removed).toBe(orig);
  });
});

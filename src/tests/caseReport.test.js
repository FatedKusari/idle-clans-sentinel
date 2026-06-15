import { describe, it, expect } from "vitest";
import {
  escHtml,
  slugify,
  formatPct,
  escapeRegex,
} from "../utils/caseReport.js";

// ── escHtml ───────────────────────────────────────────────────────────────────

describe("escHtml", () => {
  it("escapes ampersands", () => {
    expect(escHtml("Tom & Jerry")).toBe("Tom &amp; Jerry");
  });

  it("escapes less-than and greater-than", () => {
    expect(escHtml("<script>")).toBe("&lt;script&gt;");
  });

  it("escapes double quotes", () => {
    expect(escHtml('say "hello"')).toBe("say &quot;hello&quot;");
  });

  it("escapes single quotes", () => {
    expect(escHtml("it's fine")).toBe("it&#39;s fine");
  });

  it("escapes all special chars together", () => {
    expect(escHtml(`<a href="x">'hi' & bye</a>`))
      .toBe("&lt;a href=&quot;x&quot;&gt;&#39;hi&#39; &amp; bye&lt;/a&gt;");
  });

  it("returns empty string for null", () => {
    expect(escHtml(null)).toBe("");
  });

  it("returns empty string for undefined", () => {
    expect(escHtml(undefined)).toBe("");
  });

  it("leaves safe text unchanged", () => {
    expect(escHtml("hello world 123")).toBe("hello world 123");
  });
});

// ── slugify ───────────────────────────────────────────────────────────────────

describe("slugify", () => {
  it("lowercases and trims", () => {
    expect(slugify("  Hello World  ")).toBe("hello-world");
  });

  it("replaces spaces with hyphens", () => {
    expect(slugify("Case Report One")).toBe("case-report-one");
  });

  it("replaces multiple non-alphanumeric chars with a single hyphen", () => {
    expect(slugify("hello   world")).toBe("hello-world");
    expect(slugify("hello---world")).toBe("hello-world");
  });

  it("strips leading and trailing hyphens", () => {
    expect(slugify("--hello--")).toBe("hello");
  });

  it("handles special characters", () => {
    expect(slugify("Clan: The (Best) One!")).toBe("clan-the-best-one");
  });

  it("truncates to 60 chars", () => {
    const long = "a".repeat(80);
    expect(slugify(long).length).toBe(60);
  });

  it("returns empty string for empty input", () => {
    expect(slugify("")).toBe("");
    expect(slugify(null)).toBe("");
    expect(slugify(undefined)).toBe("");
  });
});

// ── formatPct ─────────────────────────────────────────────────────────────────

describe("formatPct", () => {
  it("formats a whole percentage without decimals", () => {
    expect(formatPct(0.5)).toBe("50%");
    expect(formatPct(1)).toBe("100%");
    expect(formatPct(0)).toBe("0%");
  });

  it("formats fractional percentages to 1 decimal place", () => {
    expect(formatPct(0.333)).toBe("33.3%");
    expect(formatPct(0.156)).toBe("15.6%");
  });

  it("rounds correctly at boundary", () => {
    expect(formatPct(0.1005)).toBe("10.1%");
  });

  it("returns '-' for non-finite input", () => {
    expect(formatPct(NaN)).toBe("-");
    expect(formatPct(Infinity)).toBe("-");
    expect(formatPct(null)).toBe("-");
    expect(formatPct(undefined)).toBe("-");
    expect(formatPct("abc")).toBe("-");
  });

  it("handles negative percentages", () => {
    expect(formatPct(-0.25)).toBe("-25%");
  });

  it("handles values greater than 1", () => {
    expect(formatPct(1.5)).toBe("150%");
  });
});

// ── escapeRegex ───────────────────────────────────────────────────────────────

describe("escapeRegex", () => {
  it("escapes all special regex characters", () => {
    const special = ".*+?^${}()|[]\\";
    const escaped = escapeRegex(special);
    // Should not throw when used in a RegExp
    expect(() => new RegExp(escaped)).not.toThrow();
  });

  it("escapes dots so they match literally", () => {
    const re = new RegExp(escapeRegex("alice.bob"));
    expect(re.test("alice.bob")).toBe(true);
    expect(re.test("aliceXbob")).toBe(false);
  });

  it("escapes parentheses", () => {
    const re = new RegExp(escapeRegex("(group)"));
    expect(re.test("(group)")).toBe(true);
  });

  it("leaves safe strings unchanged", () => {
    expect(escapeRegex("helloworld123")).toBe("helloworld123");
  });

  it("handles empty string", () => {
    expect(escapeRegex("")).toBe("");
  });
});

import { describe, it, expect } from "vitest";
import {
  shouldSkipRecovery,
  parseVaultEventMessage,
  csvEscape,
  rankLabel,
  buildMentionRegex,
  extractChatBody,
} from "../utils.js";

// ── shouldSkipRecovery ────────────────────────────────────────────────────────

describe("shouldSkipRecovery", () => {
  it("returns true when existing DB is large and export is tiny", () => {
    expect(shouldSkipRecovery(2_000_000, 100_000)).toBe(true);
  });

  it("returns true at exact boundary values", () => {
    expect(shouldSkipRecovery(1_000_000, 300_000)).toBe(true);
  });

  it("returns false when existing DB is below threshold", () => {
    expect(shouldSkipRecovery(500_000, 100_000)).toBe(false);
  });

  it("returns false when export is large enough to be legitimate", () => {
    expect(shouldSkipRecovery(2_000_000, 400_000)).toBe(false);
  });

  it("returns false when both sizes are small", () => {
    expect(shouldSkipRecovery(0, 0)).toBe(false);
  });
});

// ── parseVaultEventMessage ────────────────────────────────────────────────────

describe("parseVaultEventMessage", () => {
  it("parses a standard 'added' message", () => {
    const result = parseVaultEventMessage("Alice added 1,234 x Iron Ore.");
    expect(result).toEqual({ actor: "Alice", action: "added", qty: 1234, item: "Iron Ore", tier: null });
  });

  it("parses a standard 'withdrew' message", () => {
    const result = parseVaultEventMessage("Bob withdrew 500 x Gold Coins.");
    expect(result).toEqual({ actor: "Bob", action: "withdrew", qty: 500, item: "Gold Coins", tier: null });
  });

  it("parses messages without the 'x' separator", () => {
    const result = parseVaultEventMessage("Charlie added 10 Superior Sword.");
    expect(result).toEqual({ actor: "Charlie", action: "added", qty: 10, item: "Superior Sword", tier: null });
  });

  it("handles large qty with commas", () => {
    const result = parseVaultEventMessage("Alice added 1,000,000 x Logs.");
    expect(result).toEqual({ actor: "Alice", action: "added", qty: 1_000_000, item: "Logs", tier: null });
  });

  it("is case-insensitive for action word", () => {
    const result = parseVaultEventMessage("Alice ADDED 5 x Arrows.");
    expect(result).toEqual({ actor: "Alice", action: "added", qty: 5, item: "Arrows", tier: null });
  });

  it("extracts a trailing (Tier N) vault-tier qualifier", () => {
    const result = parseVaultEventMessage("Dave added 512,227 x Otherworldly essence (Tier 2).");
    expect(result).toEqual({ actor: "Dave", action: "added", qty: 512227, item: "Otherworldly essence", tier: 2 });
  });

  it("is case-insensitive for the tier qualifier", () => {
    const result = parseVaultEventMessage("Dave withdrew 10 x Some Item (tier 4).");
    expect(result).toEqual({ actor: "Dave", action: "withdrew", qty: 10, item: "Some Item", tier: 4 });
  });

  it("ignores out-of-range tier numbers (treats as part of the name)", () => {
    const result = parseVaultEventMessage("Dave added 1 x Weird Item (Tier 5).");
    expect(result).toEqual({ actor: "Dave", action: "added", qty: 1, item: "Weird Item (Tier 5)", tier: null });
  });

  it("returns null for malformed messages", () => {
    expect(parseVaultEventMessage("not a vault message")).toBeNull();
    expect(parseVaultEventMessage("")).toBeNull();
    expect(parseVaultEventMessage(null)).toBeNull();
    expect(parseVaultEventMessage(undefined)).toBeNull();
  });

  it("returns null when qty is zero", () => {
    expect(parseVaultEventMessage("Alice added 0 x Arrows.")).toBeNull();
  });

  it("returns null when item name is missing", () => {
    expect(parseVaultEventMessage("Alice added 5 .")).toBeNull();
  });

  it("handles actor names with spaces", () => {
    const result = parseVaultEventMessage("Big Bob Jr added 3 x Logs.");
    expect(result).toEqual({ actor: "Big Bob Jr", action: "added", qty: 3, item: "Logs" });
  });
});

// ── csvEscape ─────────────────────────────────────────────────────────────────

describe("csvEscape", () => {
  it("returns plain strings unchanged", () => {
    expect(csvEscape("hello world")).toBe("hello world");
  });

  it("wraps strings containing commas in quotes", () => {
    expect(csvEscape("hello, world")).toBe('"hello, world"');
  });

  it("wraps strings containing double quotes and escapes them", () => {
    expect(csvEscape('say "hello"')).toBe('"say ""hello"""');
  });

  it("wraps strings containing newlines", () => {
    expect(csvEscape("line1\nline2")).toBe('"line1\nline2"');
  });

  it("wraps strings containing carriage returns", () => {
    expect(csvEscape("line1\rline2")).toBe('"line1\rline2"');
  });

  it("returns empty string for null", () => {
    expect(csvEscape(null)).toBe("");
  });

  it("returns empty string for undefined", () => {
    expect(csvEscape(undefined)).toBe("");
  });

  it("converts numbers to strings", () => {
    expect(csvEscape(42)).toBe("42");
  });

  it("converts booleans to strings", () => {
    expect(csvEscape(true)).toBe("true");
  });
});

// ── rankLabel ─────────────────────────────────────────────────────────────────

describe("rankLabel", () => {
  it("returns 'Owner' for rank 2", () => {
    expect(rankLabel(2)).toBe("Owner");
  });

  it("returns 'Deputy' for rank 1", () => {
    expect(rankLabel(1)).toBe("Deputy");
  });

  it("returns 'Member' for rank 0", () => {
    expect(rankLabel(0)).toBe("Member");
  });

  it("returns 'Member' for any other value", () => {
    expect(rankLabel(3)).toBe("Member");
    expect(rankLabel(-1)).toBe("Member");
    expect(rankLabel(null)).toBe("Member");
    expect(rankLabel(undefined)).toBe("Member");
  });
});

// ── buildMentionRegex ─────────────────────────────────────────────────────────

describe("buildMentionRegex", () => {
  it("matches an exact name in a sentence", () => {
    const re = buildMentionRegex("shakkuru");
    expect(re.test("This be for you Shakkuru <3")).toBe(true);
  });

  it("is case-insensitive", () => {
    const re = buildMentionRegex("alice");
    expect(re.test("Hey ALICE how are you")).toBe(true);
  });

  it("does not match a name embedded inside another word", () => {
    const re = buildMentionRegex("alice");
    expect(re.test("malice is a word")).toBe(false);
  });

  it("does not match when name is preceded by underscore", () => {
    const re = buildMentionRegex("alice");
    expect(re.test("_alice is a username")).toBe(false);
  });

  it("does not match when name is followed by letters", () => {
    const re = buildMentionRegex("cat");
    expect(re.test("I love applications")).toBe(false);
  });

  it("matches at start of string", () => {
    const re = buildMentionRegex("alice");
    expect(re.test("alice said hello")).toBe(true);
  });

  it("matches at end of string", () => {
    const re = buildMentionRegex("alice");
    expect(re.test("hello alice")).toBe(true);
  });

  it("escapes special regex characters in names", () => {
    const re = buildMentionRegex("alice.bob");
    // "." should be literal, not wildcard
    expect(re.test("alice.bob is here")).toBe(true);
    expect(re.test("aliceXbob is here")).toBe(false);
  });
});

// ── extractChatBody ───────────────────────────────────────────────────────────

describe("extractChatBody", () => {
  it("extracts body from a standard chat message", () => {
    expect(extractChatBody("[16:40:22] [SHH] Shikkiri: This be for you Shakkuru <3"))
      .toBe("This be for you Shakkuru <3");
  });

  it("extracts body when no clan tag is present", () => {
    expect(extractChatBody("[10:00:00] Alice: hello world"))
      .toBe("hello world");
  });

  it("returns the full string if no ': ' separator found", () => {
    expect(extractChatBody("no separator here"))
      .toBe("no separator here");
  });

  it("uses only the FIRST ': ' as the split point", () => {
    expect(extractChatBody("[10:00:00] Alice: hello: world"))
      .toBe("hello: world");
  });

  it("handles empty string", () => {
    expect(extractChatBody("")).toBe("");
  });

  it("handles null gracefully", () => {
    expect(extractChatBody(null)).toBe(null);
  });
});

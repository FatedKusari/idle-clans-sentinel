import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { modeLabel, formatAgo, formatBytes } from "../lib/format.js";

// ── modeLabel ─────────────────────────────────────────────────────────────────

describe("modeLabel", () => {
  it("maps 'default' to 'Normal'", () => {
    expect(modeLabel("default")).toBe("Normal");
  });

  it("maps 'ironman' to 'Ironman'", () => {
    expect(modeLabel("ironman")).toBe("Ironman");
  });

  it("maps 'groupironman' to 'Group Ironman'", () => {
    expect(modeLabel("groupironman")).toBe("Group Ironman");
  });

  it("maps 'notselected' to 'Not Selected'", () => {
    expect(modeLabel("notselected")).toBe("Not Selected");
  });

  it("maps 'unknown' to 'Unknown' (HomePage variant)", () => {
    expect(modeLabel("unknown")).toBe("Unknown");
  });

  it("maps 'any' to 'Any' (CrossClanMatchesPage variant)", () => {
    expect(modeLabel("any")).toBe("Any");
  });

  it("is case-insensitive", () => {
    expect(modeLabel("DEFAULT")).toBe("Normal");
    expect(modeLabel("Ironman")).toBe("Ironman");
  });

  it("returns raw value for unrecognised modes", () => {
    expect(modeLabel("someNewMode")).toBe("someNewMode");
  });

  it("returns '—' for null", () => {
    expect(modeLabel(null)).toBe("—");
  });

  it("returns '—' for undefined", () => {
    expect(modeLabel(undefined)).toBe("—");
  });

  it("returns '—' for empty string", () => {
    expect(modeLabel("")).toBe("—");
  });
});

// ── formatAgo ─────────────────────────────────────────────────────────────────

describe("formatAgo", () => {
  let now;

  beforeEach(() => {
    now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns 'just now' for very recent times (< 5s)", () => {
    const iso = new Date(now - 2000).toISOString();
    expect(formatAgo(iso)).toBe("just now");
  });

  it("returns seconds ago for 5-59s", () => {
    const iso = new Date(now - 30_000).toISOString();
    expect(formatAgo(iso)).toBe("30s ago");
  });

  it("returns minutes ago", () => {
    const iso = new Date(now - 5 * 60_000).toISOString();
    expect(formatAgo(iso)).toBe("5m ago");
  });

  it("returns hours ago", () => {
    const iso = new Date(now - 3 * 3_600_000).toISOString();
    expect(formatAgo(iso)).toBe("3h ago");
  });

  it("returns days ago", () => {
    const iso = new Date(now - 2 * 86_400_000).toISOString();
    expect(formatAgo(iso)).toBe("2d ago");
  });

  it("accepts a Date object (ChatPage variant)", () => {
    const date = new Date(now - 10 * 60_000);
    expect(formatAgo(date)).toBe("10m ago");
  });

  it("returns '—' for null", () => {
    expect(formatAgo(null)).toBe("—");
  });

  it("returns '—' for undefined", () => {
    expect(formatAgo(undefined)).toBe("—");
  });

  it("returns '—' for invalid date string", () => {
    expect(formatAgo("not-a-date")).toBe("—");
  });
});

// ── formatBytes ───────────────────────────────────────────────────────────────

describe("formatBytes", () => {
  it("formats bytes", () => {
    expect(formatBytes(512)).toBe("512 B");
  });

  it("formats kilobytes", () => {
    expect(formatBytes(2048)).toBe("2.0 KB");
  });

  it("formats megabytes", () => {
    expect(formatBytes(5 * 1_048_576)).toBe("5.00 MB");
  });

  it("formats gigabytes", () => {
    expect(formatBytes(2 * 1_073_741_824)).toBe("2.00 GB");
  });

  it("returns '—' for null", () => {
    expect(formatBytes(null)).toBe("—");
  });

  it("returns '—' for undefined", () => {
    expect(formatBytes(undefined)).toBe("—");
  });

  it("returns '—' for NaN", () => {
    expect(formatBytes(NaN)).toBe("—");
  });

  it("returns '—' for negative numbers", () => {
    expect(formatBytes(-1)).toBe("—");
  });

  it("handles zero", () => {
    expect(formatBytes(0)).toBe("0 B");
  });
});

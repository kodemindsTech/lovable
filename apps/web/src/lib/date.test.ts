import { describe, expect, it } from "vitest";
import { addDays, localDate } from "./date";

describe("date helpers", () => {
  it("uses the timezone's calendar day, not UTC", () => {
    const t = new Date("2026-01-15T20:00:00Z"); // already 16 Jan in India
    expect(localDate(t, "Asia/Kolkata")).toBe("2026-01-16");
    expect(localDate(t, "UTC")).toBe("2026-01-15");
  });
  it("adds days across month boundaries", () => {
    expect(addDays("2026-01-31", 1)).toBe("2026-02-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });
});

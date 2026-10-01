import { describe, expect, it } from "vitest";
import { parseMealText, progress, scale, searchTerm, sumMacros, toServings } from "../src";

describe("parseMealText", () => {
  it("parses the PRD example", () => {
    const r = parseMealText("2 eggs, 3 egg whites, 2 rotis and 150g chicken.");
    expect(r.map((x) => [x.quantity, x.unit, x.query])).toEqual([
      [2, "", "eggs"], [3, "", "egg whites"], [2, "", "rotis"], [150, "g", "chicken"],
    ]);
  });
  it("handles units, words and fractions", () => {
    expect(parseMealText("1 katori dal")[0]).toMatchObject({ quantity: 1, unit: "katori", query: "dal" });
    expect(parseMealText("half cup of curd")[0]).toMatchObject({ quantity: 0.5, unit: "cup", query: "curd" });
    expect(parseMealText("1/2 plate biryani")[0]).toMatchObject({ quantity: 0.5, unit: "plate" });
    expect(parseMealText("banana")[0]).toMatchObject({ quantity: 1, query: "banana" });
  });
  it("returns nothing for empty input", () => expect(parseMealText("  ,  ")).toEqual([]));
  it("singularises search terms", () => {
    expect(searchTerm("rotis")).toBe("roti");
    expect(searchTerm("eggs")).toBe("egg");
  });
});

describe("toServings", () => {
  const chicken = { servingSize: 100, servingUnit: "g", servingGrams: 100 };
  const roti = { servingSize: 1, servingUnit: "piece", servingGrams: 40 };
  const dal = { servingSize: 1, servingUnit: "katori", servingGrams: 150 };
  it("converts grams", () => {
    expect(toServings(chicken, 150, "g")).toBe(1.5);
    expect(toServings(roti, 80, "g")).toBe(2);
    expect(toServings(dal, 300, "g")).toBe(2);
  });
  it("counts pieces and matching units", () => {
    expect(toServings(roti, 2, "")).toBe(2);
    expect(toServings(dal, 2, "katori")).toBe(2);
    expect(toServings(dal, 1, "serving")).toBe(1);
  });
  it("refuses to guess incompatible units", () => {
    expect(toServings(chicken, 2, "katori")).toBeNull();
    expect(toServings(dal, 2, "")).toBeNull();
    expect(toServings(roti, 0, "g")).toBeNull();
  });
});

describe("macros", () => {
  const m = { calories: 100, proteinG: 10, carbsG: 5, fatG: 2, fibreG: 1 };
  it("scales and sums", () => {
    expect(scale(m, 2).calories).toBe(200);
    expect(sumMacros([m, m]).proteinG).toBe(20);
    expect(sumMacros([]).calories).toBe(0);
  });
  it("progress never goes negative on remaining", () => {
    expect(progress(137, 150)).toEqual({ current: 137, target: 150, remaining: 13, pct: 91 });
    expect(progress(200, 150).remaining).toBe(0);
    expect(progress(5, 0).pct).toBe(0);
  });
});

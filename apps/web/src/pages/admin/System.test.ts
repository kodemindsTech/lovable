import { describe, expect, it } from "vitest";
import { validateSetting } from "./System";

describe("validateSetting", () => {
  it("accepts valid score weights and rejects bad ones", () => {
    expect(validateSetting("score_weights", { calories: 30, protein: 25 })).toBeNull();
    expect(validateSetting("score_weights", { calories: -1 })).toMatch(/≥ 0/);
    expect(validateSetting("score_weights", { banana: 1 })).toMatch(/Unknown/);
    expect(validateSetting("score_weights", { calories: 0, protein: 0 })).toMatch(/above 0/);
    expect(validateSetting("score_weights", "x")).toMatch(/object/);
  });
  it("validates billing config", () => {
    expect(validateSetting("billing", { grace_days: 7, trial_days: 7, period_skew_hours: 12 })).toBeNull();
    expect(validateSetting("billing", { grace_days: -1 })).toMatch(/whole number/);
    expect(validateSetting("billing", { grace_days: 1.5 })).toMatch(/whole number/);
    expect(validateSetting("billing", { trial: 7 })).toMatch(/Unknown/);
  });
  it("passes unknown keys through", () => expect(validateSetting("something_else", { a: 1 })).toBeNull());
});

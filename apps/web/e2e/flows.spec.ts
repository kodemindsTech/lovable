import { expect, test } from "@playwright/test";
import { mockBackend } from "./mock";

test("log food by search: calls the server RPC with the chosen food and quantity", async ({ page }) => {
  const { calls } = await mockBackend(page);
  await page.goto("/nutrition");
  await page.getByRole("button", { name: "+ Add" }).first().click();
  await page.getByLabel("Search foods").fill("roti");
  await page.getByRole("dialog", { name: "Add food" }).getByRole("button", { name: /Roti/ }).click();
  await expect(page.getByText("Estimate").first()).toBeVisible();   // provenance is shown
  await page.getByLabel(/Servings/).fill("2");
  await page.getByRole("button", { name: "Add to log" }).click();
  const log = calls.find((c) => c.url.includes("rpc/log_food"));
  expect(log?.body).toMatchObject({ p_food_id: "f1", p_meal: "breakfast", p_quantity: 2 });
});

test("rejects a zero quantity without calling the server", async ({ page }) => {
  const { calls } = await mockBackend(page);
  await page.goto("/nutrition");
  await page.getByRole("button", { name: "+ Add" }).first().click();
  await page.getByLabel("Search foods").fill("roti");
  await page.getByRole("dialog", { name: "Add food" }).getByRole("button", { name: /Roti/ }).click();
  await page.getByLabel(/Servings/).fill("0");
  await page.getByRole("button", { name: "Add to log" }).click();
  await expect(page.getByRole("alert")).toContainText("greater than 0");
  expect(calls.some((c) => c.url.includes("rpc/log_food"))).toBe(false);
});

test("a failed load shows an error with Retry, and retry recovers", async ({ page }) => {
  await mockBackend(page, { failFirst: ["day_totals"] });
  await page.goto("/nutrition");
  await expect(page.getByRole("alert")).toBeVisible();
  await page.getByRole("button", { name: "Retry" }).click();
  await expect(page.getByText("Calories")).toBeVisible();
});

test("coach: sends a question, shows the structured answer and disclaimer", async ({ page }) => {
  const { calls } = await mockBackend(page);
  await page.goto("/coach");
  await page.getByRole("button", { name: "What should I eat tonight?" }).click();
  await expect(page.getByText("You need about 13 g more protein.")).toBeVisible();
  await expect(page.getByText("Add yogurt")).toBeVisible();
  await expect(page.getByText(/Not medical advice/i)).toBeVisible();
  expect(calls.find((c) => c.url.includes("/v1/coach/messages"))?.body).toMatchObject({ message: "What should I eat tonight?" });
});

test("coach: rules-based fallback is labelled; API failure keeps the user's data message", async ({ page }) => {
  await mockBackend(page, { coachReply: { status: 503, body: { code: "internal", message: "Your data is saved. AI insights are temporarily unavailable.", retryable: true } } });
  await page.goto("/coach");
  await page.getByRole("button", { name: "Should I train today?" }).click();
  await expect(page.getByRole("alert")).toContainText("Your data is saved");
  await expect(page.getByRole("button", { name: "Retry" })).toBeVisible();
});

test("dashboard shows announcements and they can be dismissed", async ({ page }) => {
  await mockBackend(page);
  await page.goto("/");
  await expect(page.getByText("Thanks for trying the beta.")).toBeVisible();
  await page.getByRole("button", { name: "Dismiss Welcome" }).click();
  await expect(page.getByText("Thanks for trying the beta.")).toBeHidden();
});

test("navigation: bottom tabs on mobile, sidebar on desktop", async ({ page, isMobile }) => {
  await mockBackend(page);
  await page.goto("/");
  if (isMobile) await expect(page.getByRole("navigation", { name: "Primary mobile" })).toBeVisible();
  else await expect(page.getByRole("complementary", { name: "Primary" })).toBeVisible();
});

test("onboarding: validates age, computes targets with the deterministic engine, saves via one RPC", async ({ page }) => {
  const { calls } = await mockBackend(page, { onboarded: false });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Set up your plan" })).toBeVisible();
  await page.getByLabel(/Age/).fill("30"); await page.getByLabel("Height (cm)").fill("175"); await page.getByLabel("Current weight (kg)").fill("81");
  await page.getByLabel("Target weight (kg)").fill("75");
  await page.getByLabel(/I consent/).check();
  await page.getByRole("button", { name: "Calculate my targets" }).click();
  await expect.poll(() => calls.some((c) => c.url.includes("rpc/complete_onboarding"))).toBe(true);
  const p = (calls.find((c) => c.url.includes("rpc/complete_onboarding"))!.body as { p: { age: number; targets: { calories: number; protein_g: number; tdee: number; formula_version: string } } }).p;
  expect(p.age).toBe(30);
  expect(p.targets.protein_g).toBe(162);            // 2.0 g/kg for fat loss × 81 kg
  expect(p.targets.calories).toBeLessThan(p.targets.tdee);
  expect(p.targets.formula_version).toBeTruthy();
});

test("onboarding refuses under-18s without calling the server", async ({ page }) => {
  const { calls } = await mockBackend(page, { onboarded: false });
  await page.goto("/");
  await page.getByLabel(/Age/).fill("16"); await page.getByLabel("Height (cm)").fill("170"); await page.getByLabel("Current weight (kg)").fill("60");
  await page.getByLabel(/I consent/).check();
  await page.getByRole("button", { name: "Calculate my targets" }).click();
  expect(calls.some((c) => c.url.includes("rpc/complete_onboarding"))).toBe(false);
});

test("settings: account deletion needs typed confirmation, then calls the server function", async ({ page }) => {
  const { calls } = await mockBackend(page);
  await page.goto("/settings");
  const del = page.getByRole("button", { name: "Delete my account" });
  await expect(del).toBeDisabled();
  await page.getByLabel(/Type DELETE/).fill("delete");
  await expect(del).toBeDisabled();
  await page.getByLabel(/Type DELETE/).fill("DELETE");
  await del.click();
  await expect.poll(() => calls.some((c) => c.url.includes("rpc/delete_my_account"))).toBe(true);
});

test("settings: data export downloads a JSON file", async ({ page }) => {
  await mockBackend(page);
  await page.goto("/settings");
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Export my data" }).click()]);
  expect(download.suggestedFilename()).toBe("my-fitness-data.json");
});

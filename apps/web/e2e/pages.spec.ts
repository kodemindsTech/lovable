import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mockBackend } from "./mock";

const ROUTES = ["/", "/nutrition", "/workout", "/workout/s1", "/activity", "/progress", "/coach", "/reports", "/subscription", "/settings", "/pricing", "/privacy", "/admin/overview"];

for (const path of ROUTES)
  test(`${path}: renders without errors, fits the viewport, and has no serious accessibility violations`, async ({ page }) => {
    const errors: string[] = []; page.on("pageerror", (e) => errors.push(e.message));
    await mockBackend(page, { role: path.startsWith("/admin") ? "super" : null });
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    await expect(page.locator("h1").first()).toBeVisible();
    expect(errors).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
    const bad = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
    expect(bad.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(" | ")}`)).toEqual([]);
  });

test("login page (signed out) is accessible and usable", async ({ page }) => {
  await mockBackend(page, { signedIn: false });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  expect(results.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => v.id)).toEqual([]);
  await page.getByRole("button", { name: "New here? Sign up" }).click();
  await expect(page.getByRole("heading", { name: "Create your account" })).toBeVisible();
});

test("non-admins are redirected away from /admin", async ({ page }) => {
  await mockBackend(page, { role: null });
  await page.goto("/admin/overview");
  await expect(page).toHaveURL(/localhost:4173\/$/);
});

test("free plan sees upgrade prompts instead of Pro features", async ({ page }) => {
  await mockBackend(page, { plan: "free" });
  await page.goto("/coach");
  await expect(page.getByText("AI Coach is part of Pro")).toBeVisible();
  await page.goto("/reports");
  await page.getByRole("tab", { name: "Weekly" }).click();
  await expect(page.getByText(/is part of Pro/)).toBeVisible();
});

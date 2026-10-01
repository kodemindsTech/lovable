import { test } from "@playwright/test";
import { mockBackend } from "./mock";

// Generates screenshots for docs/preview (only when PREVIEW=1). Data is mocked demo data, not real.
test.skip(!process.env.PREVIEW, "preview generation only");
const SHOTS: [string, string, object?][] = [
  ["dashboard", "/"], ["nutrition", "/nutrition"], ["workout", "/workout/s1"], ["progress", "/progress"], ["coach", "/coach"],
  ["reports", "/reports"], ["subscription", "/subscription"], ["admin", "/admin/overview", { role: "super" }],
];
for (const [name, path, extra] of SHOTS)
  test(`preview ${name}`, async ({ page }, info) => {
    await mockBackend(page, { rich: true, ...(extra ?? {}) });
    await page.goto(path); await page.waitForLoadState("networkidle"); await page.waitForTimeout(500);
    if (name === "coach") { await page.getByRole("button", { name: "What should I eat tonight?" }).click(); await page.waitForTimeout(500); }
    if (name === "reports") { await page.getByRole("tab", { name: "Weekly" }).click(); await page.waitForTimeout(800); }
    await page.screenshot({ path: `../../docs/preview/${info.project.name}-${name}.png`, fullPage: name !== "dashboard" });
  });

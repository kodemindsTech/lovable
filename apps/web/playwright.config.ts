import { defineConfig } from "@playwright/test";

// Chromium path: CI installs it with `npx playwright install chromium`; locally set PW_CHROMIUM to an existing binary.
const executablePath = process.env.PW_CHROMIUM;
export default defineConfig({
  testDir: "e2e",
  timeout: 30_000,
  fullyParallel: true,
  reporter: [["list"]],
  use: { baseURL: "http://localhost:4173", launchOptions: { executablePath, args: ["--no-sandbox"] } },
  projects: [
    { name: "mobile", use: { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true } },
    { name: "desktop", use: { viewport: { width: 1280, height: 800 } } },
  ],
  webServer: {
    command: "pnpm build && pnpm exec vite preview --port 4173 --strictPort",
    url: "http://localhost:4173", reuseExistingServer: !process.env.CI, timeout: 120_000,
    env: { VITE_SUPABASE_URL: "http://localhost:54321", VITE_SUPABASE_ANON_KEY: "e2e-anon-key-0000000000", VITE_API_URL: "http://localhost:8787" },
  },
});

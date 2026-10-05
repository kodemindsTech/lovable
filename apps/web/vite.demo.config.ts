import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { viteSingleFile } from "vite-plugin-singlefile";

// Single self-contained HTML demo: `pnpm --filter @fitness-os/web build:demo` → dist-demo/index.html
export default defineConfig({
  plugins: [react(), viteSingleFile()],
  define: { "import.meta.env.VITE_DEMO": JSON.stringify("1"), "import.meta.env.VITE_API_URL": JSON.stringify("http://demo.local") },
  build: { outDir: "dist-demo", emptyOutDir: true },
});

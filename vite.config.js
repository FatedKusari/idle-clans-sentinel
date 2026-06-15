import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: "./",
  plugins: [react()],
  test: {
    environment: "node",
    include: ["src/tests/**/*.test.js", "electron/tests/**/*.test.js"],
    coverage: {
      provider: "v8",
      include: ["src/utils/**", "electron/utils.js"],
      reporter: ["text", "html"],
    },
  },
});

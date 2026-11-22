import { defineConfig } from "electron-vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  main: {
    // @watchparty/shared ships TS source, so it must be bundled rather than required at runtime.
    build: { externalizeDeps: { exclude: ["@watchparty/shared"] } },
  },
  preload: {},
  renderer: {
    plugins: [react()],
  },
});

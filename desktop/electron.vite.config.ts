import { defineConfig } from "electron-vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  main: {
    // Bundle these (tree-shaken) instead of shipping their node_modules: shared ships TS source, and
    // Firebase/AWS SDKs are huge on disk. Only ffmpeg-static (a native binary) stays external.
    build: { externalizeDeps: { exclude: ["@watchparty/shared", "firebase", "@aws-sdk/client-s3"] } },
  },
  preload: {},
  renderer: {
    plugins: [react()],
  },
});

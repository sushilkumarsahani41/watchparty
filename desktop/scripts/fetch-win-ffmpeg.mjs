// Downloads ffmpeg.exe (Windows x64) next to the host's ffmpeg, so the Windows installer can be built on any OS.
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const dir = path.dirname(require.resolve("ffmpeg-static/package.json"));
execFileSync(process.execPath, ["install.js"], {
  cwd: dir,
  stdio: "inherit",
  env: { ...process.env, npm_config_platform: "win32", npm_config_arch: "x64" },
});

// Modo de desenvolvimento: recompila o frontend a cada alteração e reinicia o servidor.
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const run = (cmd, args) =>
  spawn(cmd, args, { cwd: root, stdio: "inherit", shell: process.platform === "win32" });

const procs = [
  run(process.execPath, ["scripts/build-web.mjs", "--watch"]),
  run("npx", ["tsx", "watch", "--clear-screen=false", "apps/server/src/index.ts"]),
];
const stop = () => procs.forEach((p) => p.kill());
process.on("SIGINT", stop);
process.on("SIGTERM", stop);

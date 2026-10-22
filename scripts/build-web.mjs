// Compila o frontend (apps/web) para apps/web/dist com esbuild.
// Uso: node scripts/build-web.mjs [--watch]
import * as esbuild from "esbuild";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const web = join(root, "apps/web");
const dist = join(web, "dist");
const watch = process.argv.includes("--watch");
const require = createRequire(join(web, "package.json"));

mkdirSync(dist, { recursive: true });

/** Versão visível na app (página Dados): commit do git + data do build. */
function buildStamp() {
  let rev = "sem-git";
  try {
    rev = execSync("git rev-parse --short HEAD", { cwd: root, stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    /* sem git */
  }
  return `${rev} · ${new Date().toLocaleString("pt-PT")}`;
}

function copyStatic() {
  const html = readFileSync(join(web, "index.html"), "utf8").replace(
    '<script type="module" src="/src/main.tsx"></script>',
    '<link rel="stylesheet" href="/app.css" />\n    <script type="module" src="/app.js"></script>',
  );
  writeFileSync(join(dist, "index.html"), html);
  // worker do pdf.js servido como ficheiro próprio
  const worker = require.resolve("pdfjs-dist/legacy/build/pdf.worker.min.mjs");
  copyFileSync(worker, join(dist, "pdf.worker.min.mjs"));
}

const options = {
  entryPoints: { app: join(web, "src/main.tsx") },
  outdir: dist,
  bundle: true,
  format: "esm",
  target: "es2022",
  jsx: "automatic",
  sourcemap: true,
  minify: !watch,
  loader: { ".css": "css" },
  define: {
    "process.env.NODE_ENV": JSON.stringify(watch ? "development" : "production"),
    __BUILD__: JSON.stringify(buildStamp()),
  },
  logLevel: "info",
};

copyStatic();
if (watch) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
} else {
  await esbuild.build(options);
}

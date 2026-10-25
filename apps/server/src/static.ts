import { createReadStream, existsSync } from "node:fs";
import type { ServerResponse } from "node:http";
import { extname, join, normalize, resolve, sep } from "node:path";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".map": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

/** Serve o frontend compilado; qualquer caminho sem extensão devolve o index.html (rotas do frontend). */
export function staticServer(webDist: string | undefined) {
  const webRoot = webDist && existsSync(webDist) ? resolve(webDist) : null;

  function serveStatic(pathname: string, res: ServerResponse): boolean {
    if (!webRoot) return false;
    let rel = decodeURIComponent(pathname);
    if (rel === "/" || !extname(rel)) rel = "/index.html"; // rotas do frontend
    const file = normalize(join(webRoot, rel));
    if (!file.startsWith(webRoot + sep) || !existsSync(file)) return false;
    res.writeHead(200, {
      "Content-Type": MIME[extname(file)] ?? "application/octet-stream",
      "Cache-Control": rel === "/index.html" ? "no-store" : "no-cache",
    });
    createReadStream(file).pipe(res);
    return true;
  }
  return serveStatic;
}

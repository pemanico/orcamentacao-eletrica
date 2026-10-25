import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { z } from "zod";
import { createContext } from "./context.ts";
import type { Db } from "./db.ts";
import { HttpError, Router, sendJson } from "./http.ts";
import { backfillLoads, migrateRules, registerRuleRoutes, seedRules } from "./rules.ts";
import { registerFloorRoutes } from "./routes/floors.ts";
import { registerProjectRoutes } from "./routes/projects.ts";
import { registerSystemRoutes } from "./routes/system.ts";
import { staticServer } from "./static.ts";

export function buildApp(opts: {
  db: Db;
  dataDir: string;
  /** pasta das cópias de segurança; por defeito <dataDir>/copias. Aponta para o OneDrive, por exemplo. */
  backupDir?: string;
  /** pasta com os CSV de valores iniciais das regras (carregados só se a tabela estiver vazia) */
  rulesSeedDir?: string;
  webDist?: string;
  log?: (msg: string) => void;
}) {
  const { db, dataDir } = opts;
  const log = opts.log ?? (() => {});
  const pdfDir = join(dataDir, "pdfs");
  mkdirSync(pdfDir, { recursive: true });
  const ctx = createContext(db, dataDir, pdfDir, resolve(opts.backupDir ?? join(dataDir, "copias")), log);

  migrateRules(db);
  if (opts.rulesSeedDir) seedRules(db, opts.rulesSeedDir, log);
  backfillLoads(db);

  const router = new Router();
  registerSystemRoutes(router, ctx);
  registerProjectRoutes(router, ctx);
  registerFloorRoutes(router, ctx);
  registerRuleRoutes(router, db, opts.rulesSeedDir);
  const serveStatic = staticServer(opts.webDist);

  async function handle(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url ?? "/", "http://localhost");
    const method = req.method ?? "GET";
    try {
      if (url.pathname.startsWith("/api/")) {
        const m = router.match(method, url.pathname);
        if (m === null) throw new HttpError(404, "Não encontrado.");
        if (m === "method") throw new HttpError(405, "Método não permitido.");
        const out = await m.handler({ req, res, params: m.params, query: url.searchParams });
        if (out !== undefined && !res.headersSent) sendJson(res, res.statusCode || 200, out);
        return;
      }
      if (method === "GET" && serveStatic(url.pathname, res)) return;
      throw new HttpError(404, "Não encontrado.");
    } catch (err) {
      if (res.headersSent) return void res.destroy();
      if (err instanceof z.ZodError) {
        return sendJson(res, 400, {
          error: err.issues.map((i) => `${i.path.join(".") || "pedido"}: ${i.message}`).join("; "),
          issues: err.issues,
        });
      }
      if (err instanceof HttpError) return sendJson(res, err.status, { error: err.message, ...err.extra });
      log(`ERRO ${method} ${url.pathname}: ${(err as Error).stack ?? err}`);
      return sendJson(res, 500, { error: "Erro interno. Vê a consola do servidor." });
    } finally {
      log(`${method} ${url.pathname} → ${res.statusCode}`);
    }
  }

  return createServer((req, res) => void handle(req, res));
}

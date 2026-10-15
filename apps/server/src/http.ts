import type { IncomingMessage, ServerResponse } from "node:http";

/** Erro com código HTTP — lançado pelos handlers, convertido em resposta JSON. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly extra: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

export async function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  const declared = Number(req.headers["content-length"] ?? 0);
  if (declared > limit) throw new HttpError(413, `Pedido acima de ${Math.round(limit / 1024 / 1024)} MB.`);
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > limit) throw new HttpError(413, `Pedido acima de ${Math.round(limit / 1024 / 1024)} MB.`);
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

export async function readJson(req: IncomingMessage, limit = 10 * 1024 * 1024): Promise<unknown> {
  if (!String(req.headers["content-type"] ?? "").includes("application/json")) {
    throw new HttpError(415, "Esperado application/json.");
  }
  const raw = await readBody(req, limit);
  try {
    return JSON.parse(raw.toString("utf8"));
  } catch {
    throw new HttpError(400, "JSON inválido.");
  }
}

export function sendJson(res: ServerResponse, status: number, body: unknown) {
  const data = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(data);
}

export type Handler = (ctx: {
  req: IncomingMessage;
  res: ServerResponse;
  params: Record<string, string>;
  query: URLSearchParams;
}) => Promise<unknown> | unknown;

interface Route {
  method: string;
  pattern: RegExp;
  keys: string[];
  handler: Handler;
}

/** Router mínimo: "/api/floors/:id" → regex com grupos nomeados. */
export class Router {
  private routes: Route[] = [];

  on(method: string, path: string, handler: Handler) {
    const keys: string[] = [];
    const pattern = new RegExp(
      "^" +
        path.replace(/:([a-zA-Z]+)/g, (_, k: string) => {
          keys.push(k);
          return "([A-Za-z0-9_-]+)";
        }) +
        "$",
    );
    this.routes.push({ method, pattern, keys, handler });
    return this;
  }

  match(method: string, path: string): { handler: Handler; params: Record<string, string> } | "method" | null {
    let pathMatched = false;
    for (const r of this.routes) {
      const m = r.pattern.exec(path);
      if (!m) continue;
      pathMatched = true;
      if (r.method !== method) continue;
      const params: Record<string, string> = {};
      r.keys.forEach((k, i) => (params[k] = m[i + 1]!));
      return { handler: r.handler, params };
    }
    return pathMatched ? "method" : null;
  }
}

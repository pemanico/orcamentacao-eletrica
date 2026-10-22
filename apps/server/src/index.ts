import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { buildApp } from "./app.ts";
import { openDb } from "./db.ts";

const root = fileURLToPath(new URL("../../..", import.meta.url));
const dataDir = process.env.ORC_DATA_DIR ?? join(root, "data");
const port = Number(process.env.PORT ?? 5174);

const db = openDb(join(dataDir, "orcamentacao.db"));
const server = buildApp({
  db,
  dataDir,
  backupDir: process.env.ORC_BACKUP_DIR,
  rulesSeedDir: join(root, "regras"),
  webDist: join(root, "apps/web/dist"),
  log: process.env.ORC_QUIET ? undefined : (m) => console.log(m),
});

// Só escuta em localhost: a app não fica exposta na rede.
server.listen(port, "127.0.0.1", () => {
  console.log(`\nOrçamentação Elétrica → http://127.0.0.1:${port}\nDados em ${dataDir}\n`);
});

const shutdown = () => {
  server.close();
  db.close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

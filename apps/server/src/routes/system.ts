import { cpSync, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import type { AppContext } from "../context.ts";
import type { Router } from "../http.ts";

/** Página Dados: onde estão os dados, última gravação e cópias de segurança. */
export function registerSystemRoutes(router: Router, { db, dataDir, pdfDir, backupDir }: AppContext) {
  const listBackups = () =>
    existsSync(backupDir)
      ? readdirSync(backupDir, { withFileTypes: true })
          .filter((d) => d.isDirectory() && d.name.startsWith("copia-"))
          .map((d) => d.name)
          .sort()
          .reverse()
      : [];

  router
    .on("GET", "/api/info", () => {
      // caminho real do ficheiro aberto (não assume o nome)
      const dbFile = (db.prepare("PRAGMA database_list").all() as { name: string; file: string }[]).find((d) => d.name === "main")?.file ?? join(dataDir, "orcamentacao.db");
      const counts = db
        .prepare(
          "SELECT (SELECT COUNT(*) FROM projects) AS projects, (SELECT COUNT(*) FROM floors) AS floors, (SELECT MAX(updated_at) FROM floors) AS lastFloor, (SELECT MAX(updated_at) FROM projects) AS lastProject",
        )
        .get() as { projects: number; floors: number; lastFloor: string | null; lastProject: string | null };
      const backups = listBackups();
      return {
        dataDir: resolve(dataDir),
        dbFile: resolve(dbFile),
        // inclui o ficheiro -wal, onde o SQLite guarda as gravações recentes
        dbBytes: [dbFile, `${dbFile}-wal`].reduce((n, f) => n + (existsSync(f) ? statSync(f).size : 0), 0),
        projects: counts.projects,
        floors: counts.floors,
        lastSavedAt: [counts.lastFloor, counts.lastProject].filter(Boolean).sort().at(-1) ?? null,
        backupDir,
        lastBackup: backups[0] ?? null,
        backupCount: backups.length,
      };
    })
    /**
     * Cópia de segurança consistente: VACUUM INTO gera uma cópia da base de dados
     * mesmo com a app a correr; os PDFs são copiados ao lado.
     */
    .on("POST", "/api/backup", ({ res }) => {
      // hora local do PC, para o nome da pasta bater com o relógio
      const d = new Date();
      const p2 = (n: number) => String(n).padStart(2, "0");
      const stamp = `${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}`;
      let name = `copia-${stamp}`;
      for (let i = 2; existsSync(join(backupDir, name)); i++) name = `copia-${stamp}-${i}`;
      const target = join(backupDir, name);
      mkdirSync(target, { recursive: true });
      const dbCopy = join(target, "orcamentacao.db");
      db.prepare("VACUUM INTO ?").run(dbCopy);
      if (existsSync(pdfDir)) cpSync(pdfDir, join(target, "pdfs"), { recursive: true });
      res.statusCode = 201;
      return { folder: target, dbBytes: statSync(dbCopy).size, backupCount: listBackups().length };
    });
}

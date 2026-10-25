import { randomUUID } from "node:crypto";
import type { Db, FloorRow, ProjectRow } from "./db.ts";

export const newId = () => randomUUID().replace(/-/g, "").slice(0, 16);

/** O que os módulos de rotas partilham: base de dados, pastas e acessos comuns. */
export interface AppContext {
  db: Db;
  dataDir: string;
  /** pasta dos ficheiros de planta importados (PDF e DXF) */
  pdfDir: string;
  backupDir: string;
  log: (msg: string) => void;
  getFloor: (id: string) => FloorRow | undefined;
  getProject: (id: string) => ProjectRow | undefined;
  touchProject: (id: string) => void;
  logEvent: (projectId: string, kind: string, from: string | null, to: string | null, note?: string) => void;
}

export function createContext(db: Db, dataDir: string, pdfDir: string, backupDir: string, log: (msg: string) => void): AppContext {
  const getFloor = (id: string) => db.prepare("SELECT * FROM floors WHERE id = ?").get(id) as FloorRow | undefined;
  const getProject = (id: string) =>
    db.prepare("SELECT * FROM projects WHERE id = ?").get(id) as ProjectRow | undefined;
  const touchProject = (id: string) =>
    db.prepare("UPDATE projects SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?").run(id);
  const logEvent = (projectId: string, kind: string, from: string | null, to: string | null, note = "") =>
    db.prepare("INSERT INTO project_events (project_id, kind, from_status, to_status, note) VALUES (?, ?, ?, ?, ?)").run(
      projectId,
      kind,
      from,
      to,
      note,
    );
  return {
    db,
    dataDir,
    pdfDir,
    backupDir,
    log,
    getFloor,
    getProject,
    touchProject: (id) => void touchProject(id),
    logEvent: (projectId, kind, from, to, note) => void logEvent(projectId, kind, from, to, note),
  };
}

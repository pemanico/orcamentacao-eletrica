import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

/**
 * SQLite num único ficheiro, com o módulo nativo do Node (node:sqlite, Node ≥ 22.13):
 * não há dependências compiladas para instalar.
 *
 * Faz cópia de segurança da pasta `data/` inteira: contém os dados dos clientes e os PDFs.
 *
 * Na F1 o estado do piso (escala, paredes, aberturas, divisões) é guardado como JSON
 * validado por zod. Será normalizado em tabelas quando pontos e circuitos (F2/F3)
 * precisarem de referenciar divisões por chave estrangeira.
 */
export function openDb(file: string) {
  if (file !== ":memory:") mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS projects (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      client      TEXT NOT NULL DEFAULT '',
      address     TEXT NOT NULL DEFAULT '',
      created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );
    CREATE TABLE IF NOT EXISTS floors (
      id                TEXT PRIMARY KEY,
      project_id        TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      name              TEXT NOT NULL,
      ceiling_height_m  REAL NOT NULL,
      pdf_file          TEXT NOT NULL,
      pdf_original_name TEXT NOT NULL,
      pdf_page          INTEGER NOT NULL DEFAULT 1,
      state_json        TEXT NOT NULL,
      rev               INTEGER NOT NULL DEFAULT 1,
      approved_at       TEXT,
      created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      updated_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );
    CREATE INDEX IF NOT EXISTS floors_project ON floors(project_id);
    CREATE TABLE IF NOT EXISTS project_events (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      kind        TEXT NOT NULL,           -- 'estado' | 'arquivado' | 'desarquivado' | 'criado'
      from_status TEXT,
      to_status   TEXT,
      note        TEXT NOT NULL DEFAULT '',
      at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );
    CREATE INDEX IF NOT EXISTS project_events_project ON project_events(project_id, at);
  `);
  // migrações de colunas (bases de dados criadas por versões anteriores)
  const cols = (db.prepare("PRAGMA table_info(projects)").all() as { name: string }[]).map((c) => c.name);
  if (!cols.includes("status")) db.exec("ALTER TABLE projects ADD COLUMN status TEXT NOT NULL DEFAULT 'levantamento'");
  if (!cols.includes("archived_at")) db.exec("ALTER TABLE projects ADD COLUMN archived_at TEXT");
  const fcols = (db.prepare("PRAGMA table_info(floors)").all() as { name: string }[]).map((c) => c.name);
  if (!fcols.includes("source_kind")) db.exec("ALTER TABLE floors ADD COLUMN source_kind TEXT NOT NULL DEFAULT 'pdf'");
  if (!fcols.includes("source_meta")) db.exec("ALTER TABLE floors ADD COLUMN source_meta TEXT");
  return db;
}

export type Db = DatabaseSync;

export interface ProjectRow {
  id: string;
  name: string;
  client: string;
  address: string;
  status: string;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProjectEventRow {
  id: number;
  project_id: string;
  kind: string;
  from_status: string | null;
  to_status: string | null;
  note: string;
  at: string;
}

export interface FloorRow {
  id: string;
  project_id: string;
  name: string;
  ceiling_height_m: number;
  pdf_file: string;
  pdf_original_name: string;
  pdf_page: number;
  /** 'pdf' | 'dxf'. O ficheiro original está em data/pdfs/<pdf_file> (nome histórico da pasta). */
  source_kind: string;
  /** DXF: região, unidades e layers (JSON) */
  source_meta: string | null;
  state_json: string;
  rev: number;
  approved_at: string | null;
  created_at: string;
  updated_at: string;
}

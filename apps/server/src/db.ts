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
  `);
  return db;
}

export type Db = DatabaseSync;

export interface ProjectRow {
  id: string;
  name: string;
  client: string;
  address: string;
  created_at: string;
  updated_at: string;
}

export interface FloorRow {
  id: string;
  project_id: string;
  name: string;
  ceiling_height_m: number;
  pdf_file: string;
  pdf_original_name: string;
  pdf_page: number;
  state_json: string;
  rev: number;
  approved_at: string | null;
  created_at: string;
  updated_at: string;
}

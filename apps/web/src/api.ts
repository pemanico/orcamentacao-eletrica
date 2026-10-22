import type { FloorState, Issue, ProjectStatus, RuleRow, RuleState, RuleTableId } from "@orc/core";

export interface Project {
  id: string;
  name: string;
  client: string;
  address: string;
  status: ProjectStatus;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface FloorSummary {
  id: string;
  name: string;
  ceilingHeightM: number;
  pdfOriginalName: string;
  rev: number;
  approvedAt: string | null;
  updatedAt: string;
  roomCount: number;
  wallCount: number;
  calibrated: boolean;
  errorCount: number;
}

export interface ProjectEvent {
  kind: "criado" | "estado" | "arquivado" | "desarquivado";
  from: ProjectStatus | null;
  to: ProjectStatus | null;
  note: string;
  at: string;
}

export interface ProjectDetail extends Project {
  floors: FloorSummary[];
  events: ProjectEvent[];
}

export interface Floor {
  id: string;
  projectId: string;
  name: string;
  ceilingHeightM: number;
  pdfOriginalName: string;
  pdfPage: number;
  state: FloorState;
  rev: number;
  approvedAt: string | null;
  updatedAt: string;
  issues: Issue[];
}

export interface DataInfo {
  dataDir: string;
  dbFile: string;
  dbBytes: number;
  projects: number;
  floors: number;
  lastSavedAt: string | null;
  backupDir: string;
  lastBackup: string | null;
  backupCount: number;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: unknown,
  ) {
    super(message);
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init);
  const body = res.headers.get("content-type")?.includes("json") ? await res.json() : null;
  if (!res.ok) throw new ApiError((body as { error?: string } | null)?.error ?? res.statusText, res.status, body);
  return body as T;
}

const json = (method: string, data: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(data),
});

export const api = {
  listProjects: (archived = false) =>
    call<{ projects: Project[]; counts: { active: number; archived: number } }>(`/api/projects${archived ? "?arquivados=1" : ""}`),
  setProjectStatus: (id: string, to: ProjectStatus, note = "") => call<Project>(`/api/projects/${id}/status`, json("POST", { to, note })),
  archiveProject: (id: string, archived: boolean) => call<Project>(`/api/projects/${id}/archive`, json("POST", { archived })),
  deleteProject: (id: string, confirmName: string) =>
    call<{ ok: true; deletedFloors: number }>(`/api/projects/${id}`, json("DELETE", { confirmName })),
  createProject: (p: { name: string; client: string; address: string }) =>
    call<Project>("/api/projects", json("POST", p)),
  getProject: (id: string) => call<ProjectDetail>(`/api/projects/${id}`),
  /** O PDF vai como corpo binário; os metadados na query string. */
  createFloor: (projectId: string, file: File, meta: { name: string; ceilingHeightM: number; pdfPage: number }) => {
    const q = new URLSearchParams({
      name: meta.name,
      ceilingHeightM: String(meta.ceilingHeightM),
      pdfPage: String(meta.pdfPage),
      filename: file.name,
    });
    return call<Floor>(`/api/projects/${projectId}/floors?${q}`, {
      method: "POST",
      headers: { "Content-Type": "application/pdf" },
      body: file,
    });
  },
  getFloor: (id: string) => call<Floor>(`/api/floors/${id}`),
  saveFloor: (id: string, data: { rev: number; state?: FloorState; name?: string; ceilingHeightM?: number }) =>
    call<Floor>(`/api/floors/${id}`, json("PUT", data)),
  approveFloor: (id: string) => call<Floor>(`/api/floors/${id}/approve`, { method: "POST" }),
  pdfUrl: (id: string) => `/api/floors/${id}/pdf`,
  info: () => call<DataInfo>("/api/info"),
  ruleSummary: () => call<{ id: RuleTableId; total: number; pending: number }[]>("/api/rules"),
  listRules: (t: RuleTableId) => call<RuleRow[]>(`/api/rules/${t}`),
  createRule: (t: RuleTableId) => call<RuleRow>(`/api/rules/${t}`, json("POST", { values: {} })),
  updateRule: (t: RuleTableId, id: string, patch: { values?: Record<string, string | null>; state?: RuleState; source?: string; notes?: string }) =>
    call<RuleRow>(`/api/rules/${t}/${id}`, json("PUT", patch)),
  deleteRule: (t: RuleTableId, id: string) => call<{ ok: true }>(`/api/rules/${t}/${id}`, { method: "DELETE" }),
  backup: () => call<{ folder: string; dbBytes: number; backupCount: number }>("/api/backup", { method: "POST" }),
};

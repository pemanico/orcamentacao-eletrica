import { PROJECT_STATUS_LABEL, type ProjectStatus } from "@orc/core";

export function StatusBadge({ status, archived }: { status: ProjectStatus; archived?: boolean }) {
  return (
    <span className="status-wrap">
      <span className={`status-badge st-${status}`}>{PROJECT_STATUS_LABEL[status]}</span>
      {archived && <span className="status-badge st-arquivado">Arquivado</span>}
    </span>
  );
}

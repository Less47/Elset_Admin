export const statuses = ["To Do", "In Progress", "Completed"];

export const statusThemes = {
  "To Do": {
    card: "border-status-warning-border bg-status-warning-surface/85",
    column: "border-status-warning-border bg-status-warning-surface/65",
    badge: "bg-status-warning-surface text-status-warning",
  },
  "In Progress": {
    card: "border-status-info-border bg-status-info-surface/85",
    column: "border-status-info-border bg-status-info-surface/65",
    badge: "bg-status-info-surface text-status-info",
  },
  Completed: {
    card: "border-status-success-border bg-status-success-surface/85",
    column: "border-status-success-border bg-status-success-surface/65",
    badge: "bg-status-success-surface text-status-success",
  },
};

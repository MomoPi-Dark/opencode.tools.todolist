import { calculateGlobalStats, type TodoItem, type TodoStatus } from "./todo";

export interface TodoDisplayItem {
  id: string;
  content: string;
  icon: string;
  status: TodoStatus;
  depth: number;
}

export interface TodoDisplaySummary {
  header: string;
  completed: number;
  total: number;
  items: TodoDisplayItem[];
}

export function getStatusIcon(status: TodoStatus): string {
  switch (status) {
    case "completed":
      return "✔";
    case "in_progress":
      return "⦿";
    case "cancelled":
      return "✕";
    case "pending":
    default:
      return "○";
  }
}

export function getTodoDisplaySummary(
  todos: TodoItem[],
): TodoDisplaySummary | null {
  if (!todos || todos.length === 0) return null;

  const stats = calculateGlobalStats(todos);
  const completed = stats.completedSubTasks;
  const total = stats.totalSubTasks;
  const header = `Todos (${completed}/${total})`;
  const items: TodoDisplayItem[] = [];

  for (const parent of todos) {
    items.push({
      id: parent.id,
      content: parent.content,
      icon: getStatusIcon(parent.status),
      status: parent.status,
      depth: 0,
    });
    for (const child of parent.children ?? []) {
      items.push({
        id: child.id,
        content: child.content,
        icon: getStatusIcon(child.status),
        status: child.status,
        depth: 1,
      });
    }
  }

  return { header, completed, total, items };
}

export function formatTodoProgress(todos: TodoItem[]): string | null {
  const summary = getTodoDisplaySummary(todos);
  return summary ? summary.header : null;
}

import { z } from "zod";

export type TodoStatus = "pending" | "in_progress" | "completed" | "cancelled";
export type Priority = "high" | "medium" | "low";

export interface SubTodo {
  id: string;
  content: string;
  status: TodoStatus;
  priority?: Priority;
  note?: string;
}

export interface TodoItem {
  id: string;
  content: string;
  status: TodoStatus;
  priority?: Priority;
  note?: string;
  children?: SubTodo[];
}

export const SubTodoSchema = z.object({
  id: z.string().describe("Unique subtask identifier (e.g. '1.1')"),
  content: z.string().describe("Subtask description"),
  status: z.enum(["pending", "in_progress", "completed", "cancelled"]),
  priority: z.enum(["high", "medium", "low"]).optional(),
  note: z.string().optional(),
});

export const TodoItemSchema = z.object({
  id: z.string().describe("Unique task identifier (e.g. '1')"),
  content: z.string().describe("Main task summary"),
  status: z.enum(["pending", "in_progress", "completed", "cancelled"]),
  priority: z.enum(["high", "medium", "low"]).optional(),
  note: z.string().optional(),
  children: z.array(SubTodoSchema).optional(),
});

export const TodoWriteInputSchema = z.object({
  todos: z.array(TodoItemSchema).describe("Hierarchical task list"),
});

export type TodoWriteInput = z.infer<typeof TodoWriteInputSchema>;

export function calculateProgress(
  children?: SubTodo[],
): { completed: number; total: number; label: string } | null {
  if (!children || children.length === 0) return null;
  const nonCancelled = children.filter((c) => c.status !== "cancelled");
  const completed = nonCancelled.filter((c) => c.status === "completed").length;
  const total = nonCancelled.length;
  return { completed, total, label: `${completed}/${total}` };
}

export function calculateGlobalStats(todos: TodoItem[]): {
  totalSteps: number;
  completedSteps: number;
  totalSubTasks: number;
  completedSubTasks: number;
  percent: number;
} {
  let totalSteps = todos.length;
  let completedSteps = todos.filter((t) => t.status === "completed").length;
  let totalSubTasks = 0;
  let completedSubTasks = 0;

  for (const item of todos) {
    if (item.children && item.children.length > 0) {
      const nonCancelled = item.children.filter(
        (c) => c.status !== "cancelled",
      );
      totalSubTasks += nonCancelled.length;
      completedSubTasks += nonCancelled.filter(
        (c) => c.status === "completed",
      ).length;
    } else if (item.status !== "cancelled") {
      totalSubTasks += 1;
      if (item.status === "completed") completedSubTasks += 1;
    }
  }

  const percent =
    totalSubTasks > 0
      ? Math.round((completedSubTasks / totalSubTasks) * 100)
      : 0;
  return {
    totalSteps,
    completedSteps,
    totalSubTasks,
    completedSubTasks,
    percent,
  };
}

export function renderProgressBar(
  percent: number,
  width: number = 10,
): { filled: string; unfilled: string } {
  const clamped = Math.max(0, Math.min(100, percent));
  const filledCount = Math.round((clamped / 100) * width);
  const unfilledCount = width - filledCount;

  return {
    filled: "█".repeat(filledCount),
    unfilled: "░".repeat(unfilledCount),
  };
}

export function validateAndNormalizeTodos(
  todos: TodoItem[],
): { valid: true; data: TodoItem[] } | { valid: false; error: string } {
  const seenIds = new Set<string>();
  const activeParents: string[] = [];

  for (const parent of todos) {
    if (seenIds.has(parent.id)) {
      return {
        valid: false,
        error: `Duplicate ID found: '${parent.id}'. Every ID must be unique across the tree.`,
      };
    }
    seenIds.add(parent.id);
    if (parent.status === "in_progress") activeParents.push(parent.id);

    const activeChildren: string[] = [];
    for (const child of parent.children ?? []) {
      if (seenIds.has(child.id)) {
        return {
          valid: false,
          error: `Duplicate ID found: '${child.id}'. Every ID must be unique across the tree.`,
        };
      }
      seenIds.add(child.id);
      if (child.status === "in_progress") activeChildren.push(child.id);
    }

    if (activeChildren.length > 1) {
      return {
        valid: false,
        error: `Task '${parent.id}' has ${activeChildren.length} subtasks 'in_progress'. At most 1 is allowed.`,
      };
    }

    if (activeChildren.length === 1 && parent.status !== "in_progress") {
      return {
        valid: false,
        error: `Subtask '${activeChildren[0]}' is 'in_progress' but parent '${parent.id}' is '${parent.status}'. Set parent to 'in_progress' first.`,
      };
    }
  }

  if (activeParents.length > 1) {
    return {
      valid: false,
      error: `Only 1 top-level task can be 'in_progress'. Found: ${activeParents.join(", ")}.`,
    };
  }

  const normalized: TodoItem[] = [];
  for (const item of todos) {
    if (!item.children || item.children.length === 0) {
      normalized.push(item);
      continue;
    }

    const children = item.children;
    const hasUnfinishedChildren = children.some(
      (c) => c.status === "pending" || c.status === "in_progress",
    );

    if (item.status === "completed" && hasUnfinishedChildren) {
      return {
        valid: false,
        error: `Task '${item.id}' cannot be marked 'completed' while it still has pending or in-progress subtasks.`,
      };
    }

    const allChildrenCompleted =
      children.length > 0 && children.every((c) => c.status === "completed");
    const nextStatus = allChildrenCompleted ? "completed" : item.status;

    normalized.push({ ...item, status: nextStatus });
  }

  return { valid: true, data: normalized };
}

const STATUS_ICONS: Record<TodoStatus, string> = {
  pending: "[ ]",
  in_progress: "[~]",
  completed: "[x]",
  cancelled: "[-]",
};

export function renderTodoTree(todos: TodoItem[]): string {
  const lines: string[] = [];

  for (const parent of todos) {
    const icon = STATUS_ICONS[parent.status] ?? "[ ]";
    const prog = calculateProgress(parent.children);
    const progText = prog ? ` (${prog.label})` : "";
    const parentLabel = parent.content.startsWith(parent.id)
      ? parent.content
      : `${parent.id}. ${parent.content}`;
    lines.push(`${icon} ${parentLabel}${progText}`);
    if (parent.note) {
      lines.push(`    ↳ note: ${parent.note}`);
    }

    if (parent.children) {
      for (const child of parent.children) {
        const childIcon = STATUS_ICONS[child.status] ?? "[ ]";
        const childLabel = child.content.startsWith(child.id)
          ? child.content
          : `${child.id} ${child.content}`;
        lines.push(`    ${childIcon} ${childLabel}`);
        if (child.note) {
          lines.push(`        ↳ note: ${child.note}`);
        }
      }
    }
  }

  return lines.join("\n");
}

import type { Plugin } from "@opencode/plugin";
import { z } from "zod";
import { consumeTodoHint } from "./hint";
import { readTodos, updateTodos } from "./store";
import {
  type SubTodo,
  type TodoItem,
  type TodoStatus,
  TodoItemSchema,
  calculateGlobalStats,
  renderTodoTree,
} from "./todo";

const todoListStatusSchema = z.enum([
  "pending",
  "in_progress",
  "completed",
  "cancelled",
]);

const prioritySchema = z.enum(["high", "medium", "low"]);

export const subTodoInputSchema = z.object({
  id: z.string().optional(),
  title: z.string().optional(),
  content: z.string().optional(),
  status: todoListStatusSchema.default("pending"),
  priority: prioritySchema.optional(),
  note: z.string().optional(),
});

export const manageTodoItemSchema = subTodoInputSchema.extend({
  children: z.array(subTodoInputSchema).optional(),
});

export type ManageTodoItemInput = z.input<typeof manageTodoItemSchema>;

export const manageTodoListSchema = z.object({
  operation: z
    .enum(["read", "write"])
    .describe(
      "'read' to inspect current todos, 'write' to set/replace the full list.",
    ),
  todos: z
    .array(manageTodoItemSchema)
    .default([])
    .describe(
      "The entire todo list to write. Pass [] or omit to clear the list.",
    ),
});

export const manageTodoListOutputSchema = z.object({
  todos: z.array(TodoItemSchema),
});

export function normalizeStatus(
  raw?: z.infer<typeof todoListStatusSchema>,
): TodoStatus {
  switch (raw) {
    case "in_progress":
      return "in_progress";
    case "completed":
      return "completed";
    case "cancelled":
      return "cancelled";
    case "pending":
    default:
      return "pending";
  }
}

export function buildTodosFromInput(
  rawTodos: ManageTodoItemInput[],
): TodoItem[] {
  return rawTodos.map((item, index) => {
    const parentId = item.id?.trim() || String(index + 1);
    const content = (item.title || item.content || `Task ${parentId}`).trim();
    const status = normalizeStatus(item.status);

    const children: SubTodo[] = (item.children ?? []).map((c, cIndex) => ({
      id: c.id?.trim() || `${parentId}.${cIndex + 1}`,
      content: (c.title || c.content || `Subtask ${cIndex + 1}`).trim(),
      status: normalizeStatus(c.status),
      ...(c.priority ? { priority: c.priority } : {}),
      ...(c.note?.trim() ? { note: c.note.trim() } : {}),
    }));

    return {
      id: parentId,
      content,
      status,
      ...(item.priority ? { priority: item.priority } : {}),
      ...(item.note?.trim() ? { note: item.note.trim() } : {}),
      ...(children.length > 0 ? { children } : {}),
    };
  });
}

export function formatReadOutput(todos: TodoItem[]): string {
  return todos.length === 0 ? "No todos recorded." : renderTodoTree(todos);
}

export async function registerTodoTools(ctx: Plugin.Context): Promise<void> {
  await ctx.tool.transform((tools) => {
    tools.add({
      name: "manage_todo_list",
      description:
        "Manage the todo list for multi-step tasks. Use 'write' to set/replace the full list. Exactly one active task can be 'in-progress' at a time. Mark completed immediately when done. Note: Call 'read' first if unsure of current state, as tasks can be cleared by user via UI.",
      input: manageTodoListSchema,
      output: manageTodoListOutputSchema,
      options: { codemode: false },
      execute: async (input, toolContext) => {
        const raw = (
          input && typeof input === "object" ? { ...input } : {}
        ) as Record<string, any>;

        if (raw.todos === undefined) {
          if (Array.isArray(raw.items)) raw.todos = raw.items;
          else if (Array.isArray(raw.tasks)) raw.todos = raw.tasks;
          else if (Array.isArray(raw.todo)) raw.todos = raw.todo;
        }

        const parsed = manageTodoListSchema.safeParse(raw);
        if (!parsed.success) {
          throw new Error(
            `[manage_todo_list validation failed] ${parsed.error.issues.map((i) => i.message).join(", ")}`,
          );
        }

        if (parsed.data.operation === "read") {
          const todos = await readTodos(toolContext.sessionID);
          return { output: { todos }, content: formatReadOutput(todos) };
        }

        const rawTodos = (parsed.data.todos ?? []) as ManageTodoItemInput[];
        if (rawTodos.length === 0) {
          await updateTodos(toolContext.sessionID, () => []);
          return { output: { todos: [] }, content: "Cleared all todos." };
        }

        const formattedTodos = buildTodosFromInput(rawTodos);
        const todos = await updateTodos(
          toolContext.sessionID,
          () => formattedTodos,
        );
        const stats = calculateGlobalStats(todos);

        return {
          output: { todos },
          content: `Todos (${stats.completedSubTasks}/${stats.totalSubTasks}) updated successfully.`,
        };
      },
    });
  });

  await registerTodoPromptHook(ctx);
}

/**
 * Keeps the model anchored to active todos via an EPHEMERAL hint.
 *
 * Preferred path: push a `SystemPart` onto the model request's `system`
 * array (the `"context"` hook). That payload is rebuilt per request and is
 * never written to the transcript — so the hint reaches the model without
 * ever appearing in the TUI or history.
 *
 * Fallback path: hosts that reject the `"context"` hook name fall back to
 * appending onto the user prompt (visible once in the transcript).
 *
 * Injection stays deduplicated through {@link consumeTodoHint}.
 */
export async function registerTodoPromptHook(
  ctx: Plugin.Context,
): Promise<void> {
  if (typeof ctx.session?.hook !== "function") return;

  try {
    await ctx.session.hook("context", async (sessionContext) => {
      try {
        const system = (sessionContext as { system?: unknown })?.system;
        if (!Array.isArray(system)) return;
        const hint = consumeTodoHint(sessionContext.sessionID);
        if (!hint) return;
        system.push({ type: "text", text: hint });
      } catch {
        // Fail-safe: never crash the model request pipeline.
      }
    });
    return;
  } catch {
    // Host does not recognize the "context" hook: fall back below.
  }

  try {
    await ctx.session.hook("prompt", async (sessionPrompt) => {
      try {
        if (!sessionPrompt.prompt?.text?.trim()) return;
        const hint = consumeTodoHint(sessionPrompt.sessionID);
        if (hint) {
          sessionPrompt.prompt.text = `${sessionPrompt.prompt.text}\n\n${hint}`;
        }
      } catch {
        // Fail-safe: never crash the prompt pipeline.
      }
    });
  } catch {
    // Host supports neither hook: feature degrades gracefully.
  }
}

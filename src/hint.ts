import { readFileSync, renameSync, writeFileSync } from "node:fs";
import {
  getHintMarkerPath,
  normalizeSessionID,
  readTodoData,
} from "./store.js";
import type { TodoItem, TodoStatus } from "./todo.js";

export const DEFAULT_STALE_MS = 30 * 60 * 1000; // 30 minutes

export const TODO_HINT =
  "<todo_hint>Active todos exist. If continuing previous work, call " +
  "manage_todo_list [read] first. Ignore if the user is discussing something else.</todo_hint>";

function isTaskActive(task: {
  status: TodoStatus;
  children?: Array<{ status: TodoStatus }>;
}): boolean {
  if (task.status === "pending" || task.status === "in_progress") return true;
  if (
    task.children &&
    task.children.some(
      (c) => c.status === "pending" || c.status === "in_progress",
    )
  ) {
    return true;
  }
  return false;
}

export function isAnyTodoActive(todos: TodoItem[]): boolean {
  return todos.some(isTaskActive);
}

function atomicWrite(file: string, data: string): void {
  const tmp = `${file}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
  writeFileSync(tmp, data, "utf8");
  renameSync(tmp, file);
}

export interface ConsumeTodoHintOptions {
  staleMs?: number;
  now?: number;
}

/**
 * Returns the todo hint at most once per todo-state version change.
 * Records the last hinted version in a dedicated marker file so that
 * subsequent turns without state changes stay injection-free.
 */
export function consumeTodoHint(
  sessionID: string,
  options?: ConsumeTodoHintOptions,
): string | undefined {
  try {
    if (!sessionID) return undefined;
    const safeSessionID = normalizeSessionID(sessionID);

    const state = readTodoData(safeSessionID);
    if (!state) return undefined;

    const todos = state.todos as TodoItem[];
    if (todos.length === 0 || !isAnyTodoActive(todos)) return undefined;

    const staleMs = options?.staleMs ?? DEFAULT_STALE_MS;
    const now = options?.now ?? Date.now();
    const updatedAt = Date.parse(state.updatedAt);
    if (Number.isFinite(updatedAt) && now - updatedAt > staleMs) {
      return undefined;
    }

    const markerFile = getHintMarkerPath(safeSessionID);
    let hintedVersion = -1;
    try {
      const marker = JSON.parse(readFileSync(markerFile, "utf8"));
      if (typeof marker?.version === "number") hintedVersion = marker.version;
    } catch {
      // Marker missing or corrupt: treat as never hinted.
    }

    if (hintedVersion === state.version) return undefined;

    atomicWrite(markerFile, JSON.stringify({ version: state.version }));
    return TODO_HINT;
  } catch {
    // Fail-safe: never disrupt a chat turn on store/parse failure.
    return undefined;
  }
}

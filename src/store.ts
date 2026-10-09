import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import * as lockfile from "proper-lockfile";
import {
  TodoItemSchema,
  validateAndNormalizeTodos,
  type TodoItem,
} from "./todo";

export class InvalidTodoDataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidTodoDataError";
  }
}

export function getTodosDirectory(sessionID?: string): string {
  const baseDir =
    process.env.OPENCODE_TODOS_DIR ??
    join(homedir(), ".config", "opencode", "tmp");
  if (!sessionID) return baseDir;
  return join(baseDir, normalizeSessionID(sessionID));
}

export const TODOS_DIRECTORY = getTodosDirectory();

export interface TodoData {
  version: 1;
  todos: TodoItem[];
  updatedAt: string;
}

function normalizeSessionID(sessionID: string): string {
  const normalized = sessionID.trim();
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(normalized)) {
    throw new Error("[todo store] invalid session ID");
  }
  return normalized;
}

function listSessionFiles(
  sessionID: string,
): Array<{ path: string; timestamp: number }> {
  const safeSessionID = normalizeSessionID(sessionID);
  const prefix = "todos-";
  const suffix = ".json";
  const sessionDir = getTodosDirectory(safeSessionID);

  try {
    return readdirSync(sessionDir)
      .flatMap((name) => {
        if (!name.startsWith(prefix) || !name.endsWith(suffix)) return [];
        const timestamp = Number(name.slice(prefix.length, -suffix.length));
        if (!Number.isSafeInteger(timestamp) || timestamp < 0) return [];
        return [{ path: join(sessionDir, name), timestamp }];
      })
      .sort((left, right) => right.timestamp - left.timestamp);
  } catch (error) {
    if (isMissingFile(error)) {
      const baseDir = getTodosDirectory();
      try {
        const legacyPrefix = `todos-${safeSessionID}-`;
        return readdirSync(baseDir)
          .flatMap((name) => {
            if (!name.startsWith(legacyPrefix) || !name.endsWith(suffix))
              return [];
            const timestamp = Number(
              name.slice(legacyPrefix.length, -suffix.length),
            );
            if (!Number.isSafeInteger(timestamp) || timestamp < 0) return [];
            return [{ path: join(baseDir, name), timestamp }];
          })
          .sort((left, right) => right.timestamp - left.timestamp);
      } catch (legacyErr) {
        if (isMissingFile(legacyErr)) return [];
        throw legacyErr;
      }
    }
    throw error;
  }
}

export function getTodoLockPath(sessionID: string): string {
  const safeSessionID = normalizeSessionID(sessionID);
  return join(getTodosDirectory(safeSessionID), "todos.lock");
}

export function getTodoFilePath(sessionID: string): string {
  const safeSessionID = normalizeSessionID(sessionID);
  return (
    listSessionFiles(safeSessionID)[0]?.path ??
    join(getTodosDirectory(safeSessionID), `todos-${Date.now()}.json`)
  );
}

export function isMissingFile(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code: string }).code === "ENOENT"
  );
}

function parseTodoFile(raw: string): TodoItem[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    const list = Array.isArray(parsed)
      ? parsed
      : typeof parsed === "object" && parsed !== null && "todos" in parsed
        ? parsed.todos
        : undefined;
    if (!Array.isArray(list)) throw new Error("todo list is missing");

    const result = TodoItemSchema.array().safeParse(list);
    if (!result.success) {
      throw new Error(result.error.issues.map((i) => i.message).join(", "));
    }
    return result.data as TodoItem[];
  } catch (err) {
    throw new InvalidTodoDataError(
      `[todo store read failed] invalid todo data: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

export async function readTodos(sessionID: string): Promise<TodoItem[]> {
  const filePath = getTodoFilePath(sessionID);
  try {
    return parseTodoFile(await readFile(filePath, "utf8"));
  } catch (error) {
    if (isMissingFile(error)) return [];
    if (error instanceof InvalidTodoDataError) throw error;
    throw new Error(
      `[todo store read failed] unable to read todo storage: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export function readTodosSync(sessionID: string): TodoItem[] {
  const filePath = getTodoFilePath(sessionID);
  try {
    return parseTodoFile(readFileSync(filePath, "utf8"));
  } catch (error) {
    if (isMissingFile(error)) return [];
    if (error instanceof InvalidTodoDataError) throw error;
    throw new Error(
      `[todo store read failed] unable to read todo storage: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export async function writeTodos(
  sessionID: string,
  todos: TodoItem[],
): Promise<void> {
  await updateTodos(sessionID, () => todos);
}

export async function updateTodos(
  sessionID: string,
  update: (todos: TodoItem[]) => TodoItem[],
): Promise<TodoItem[]> {
  const safeSessionID = normalizeSessionID(sessionID);
  const sessionDir = getTodosDirectory(safeSessionID);
  await mkdir(sessionDir, { recursive: true });

  const initialPath = getTodoFilePath(safeSessionID);

  const release = await lockfile.lock(initialPath, {
    realpath: false,
    lockfilePath: getTodoLockPath(safeSessionID),
    retries: { retries: 10, minTimeout: 10, maxTimeout: 250 },
    stale: 10_000,
  });
  let temporary: string | undefined;

  try {
    const filePath = getTodoFilePath(safeSessionID);
    let current: TodoItem[] = [];

    try {
      current = await readTodos(safeSessionID);
    } catch (error) {
      if (!(error instanceof InvalidTodoDataError)) {
        throw error;
      }
      await rename(filePath, `${filePath}.corrupt-${Date.now()}`).catch(
        () => { },
      );
      current = [];
    }

    const result = validateAndNormalizeTodos(update(current));
    if (!result.valid) {
      throw new Error(`[todo store validation failed] ${result.error}`);
    }

    const payload: TodoData = {
      version: 1,
      todos: result.data,
      updatedAt: new Date().toISOString(),
    };

    temporary = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    await rename(temporary, filePath);
    return result.data;
  } finally {
    try {
      if (temporary) await rm(temporary, { force: true });
    } finally {
      await release();
    }
  }
}

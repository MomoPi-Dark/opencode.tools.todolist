import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join, posix, win32 } from "node:path";
import * as lockfile from "proper-lockfile";
import {
  TodoItemSchema,
  validateAndNormalizeTodos,
  type TodoItem,
} from "../todo";

export class InvalidTodoDataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidTodoDataError";
  }
}

/**
 * Environment/OS context used to resolve storage locations. All fields are
 * optional so callers (and tests) can simulate any platform on any host.
 */
export interface PlatformContext {
  platform?: NodeJS.Platform;
  env?: Record<string, string | undefined>;
  home?: string;
}

function joinFor(platform: NodeJS.Platform, ...parts: string[]): string {
  return platform === "win32" ? win32.join(...parts) : posix.join(...parts);
}

/**
 * Cross-platform home directory resolution.
 *
 * `os.homedir()` already adapts to the OS, but it can return an empty string
 * in stripped environments, and Windows shells sometimes expose a
 * POSIX-style `HOME` (e.g. Git Bash `/c/Users/...`). We therefore prefer the
 * canonical variable for the running platform before falling back.
 *
 * @see {@link https://nodejs.org/api/os.html#oshomedir}
 */
export function resolveHomeDir(ctx: PlatformContext = {}): string {
  const env = ctx.env ?? process.env;
  const platform = ctx.platform ?? process.platform;
  if (ctx.home) return ctx.home;

  if (platform === "win32") {
    // Windows: USERPROFILE is canonical; HOMEDRIVE+HOMEPATH is the legacy pair.
    if (env.USERPROFILE) return env.USERPROFILE;
    if (env.HOMEDRIVE && env.HOMEPATH) return `${env.HOMEDRIVE}${env.HOMEPATH}`;
    if (env.HOME) return env.HOME;
  } else {
    // Linux, macOS, BSD, etc.
    if (env.HOME) return env.HOME;
    if (env.USERPROFILE) return env.USERPROFILE;
  }

  try {
    return homedir();
  } catch {
    return tmpdir();
  }
}

/**
 * Platform-native base directory for user configuration/data.
 *
 * - Windows : `%APPDATA%` (fallback `%LOCALAPPDATA%` → `~/AppData/Roaming`)
 * - macOS   : `~/Library/Application Support`
 * - Linux   : `$XDG_CONFIG_HOME` (fallback `~/.config`)
 *
 * `XDG_CONFIG_HOME` is honored first on every platform so users who prefer an
 * XDG layout (including those running OpenCode's own convention) can force it.
 */
export function resolveConfigHome(ctx: PlatformContext = {}): string {
  const env = ctx.env ?? process.env;
  const platform = ctx.platform ?? process.platform;

  if (env.XDG_CONFIG_HOME) return env.XDG_CONFIG_HOME;

  if (platform === "win32") {
    if (env.APPDATA) return env.APPDATA;
    if (env.LOCALAPPDATA) return env.LOCALAPPDATA;
    return joinFor(platform, resolveHomeDir(ctx), "AppData", "Roaming");
  }

  if (platform === "darwin") {
    return joinFor(
      platform,
      resolveHomeDir(ctx),
      "Library",
      "Application Support",
    );
  }

  return joinFor(platform, resolveHomeDir(ctx), ".config");
}

/**
 * Base directory that stores per-session todo folders.
 *
 * Priority:
 *   1. `OPENCODE_TODOS_DIR`    — explicit plugin override (tests/tooling).
 *   2. `OPENCODE_CONFIG_DIR`   — OpenCode's own config-dir override.
 *   3. Platform-native config home + `opencode/tmp`.
 */
export function resolveTodosBaseDir(ctx: PlatformContext = {}): string {
  const env = ctx.env ?? process.env;
  const platform = ctx.platform ?? process.platform;

  if (env.OPENCODE_TODOS_DIR) return env.OPENCODE_TODOS_DIR;
  if (env.OPENCODE_CONFIG_DIR) {
    return joinFor(platform, env.OPENCODE_CONFIG_DIR, "tmp");
  }
  return joinFor(platform, resolveConfigHome(ctx), "opencode", "tmp");
}

/**
 * Deterministic cryptographic hash of sessionID.
 * Produces an opaque 32-character hexadecimal folder name prefixed with "s_".
 * Prevents raw sessionIDs from leaking in the filesystem structure.
 */
export function hashSessionID(sessionID: string): string {
  const normalized = normalizeSessionID(sessionID);
  const digest = createHash("sha256").update(normalized).digest("hex");
  return `s_${digest.slice(0, 32)}`;
}

export function getTodosDirectory(sessionID?: string): string {
  const baseDir = resolveTodosBaseDir();
  if (!sessionID) return baseDir;

  const hashed = hashSessionID(sessionID);
  const hashedDir = join(baseDir, hashed);

  // Backward compatibility: if an unhashed legacy directory exists, prefer it
  // until it gets migrated or used.
  const rawNormalized = normalizeSessionID(sessionID);
  const legacyDir = join(baseDir, rawNormalized);
  if (!existsSync(hashedDir) && existsSync(legacyDir)) {
    return legacyDir;
  }

  return hashedDir;
}

export const TODOS_DIRECTORY = getTodosDirectory();

export interface TodoData {
  version: number;
  todos: TodoItem[];
  updatedAt: string;
}

export function normalizeSessionID(sessionID: string): string {
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

export function getHintMarkerPath(sessionID: string): string {
  const safeSessionID = normalizeSessionID(sessionID);
  return join(getTodosDirectory(safeSessionID), "hint-marker.json");
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

export function readTodoData(sessionID: string): TodoData | null {
  try {
    const safeSessionID = normalizeSessionID(sessionID);
    const filePath = getTodoFilePath(safeSessionID);
    const raw = readFileSync(filePath, "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const todos = Array.isArray((parsed as any).todos)
      ? (parsed as any).todos
      : Array.isArray(parsed)
        ? parsed
        : [];
    const version =
      typeof (parsed as any).version === "number" &&
        Number.isSafeInteger((parsed as any).version)
        ? (parsed as any).version
        : 0;
    const updatedAt =
      typeof (parsed as any).updatedAt === "string"
        ? (parsed as any).updatedAt
        : new Date().toISOString();
    return { version, todos, updatedAt };
  } catch {
    return null;
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
  const baseDir = getTodosDirectory();
  const legacyDir = join(baseDir, safeSessionID);
  const targetDir = join(baseDir, hashSessionID(safeSessionID));

  // Migrate legacy plaintext directories to hashed ones.
  if (existsSync(legacyDir) && !existsSync(targetDir)) {
    try {
      await rename(legacyDir, targetDir);
    } catch {
      // Fallback: if rename fails (e.g. cross-device), continue using legacyDir
    }
  }

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

    let prevVersion = 0;
    try {
      const existingData = readTodoData(safeSessionID);
      if (existingData) prevVersion = existingData.version;
    } catch { }

    const payload: TodoData = {
      version: prevVersion + 1,
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

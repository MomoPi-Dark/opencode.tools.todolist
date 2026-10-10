// src/index.ts
import { Plugin } from "@opencode/plugin";
import { z as z2 } from "zod";

// src/hint.ts
import { readFileSync as readFileSync2, renameSync, writeFileSync } from "node:fs";

// src/store.ts
import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join, posix, win32 } from "node:path";
import * as lockfile from "proper-lockfile";

// src/todo.ts
import { z } from "zod";
var SubTodoSchema = z.object({
  id: z.string().describe("Unique subtask identifier (e.g. '1.1')"),
  content: z.string().describe("Subtask description"),
  status: z.enum(["pending", "in_progress", "completed", "cancelled"]),
  priority: z.enum(["high", "medium", "low"]).optional(),
  note: z.string().optional()
});
var TodoItemSchema = z.object({
  id: z.string().describe("Unique task identifier (e.g. '1')"),
  content: z.string().describe("Main task summary"),
  status: z.enum(["pending", "in_progress", "completed", "cancelled"]),
  priority: z.enum(["high", "medium", "low"]).optional(),
  note: z.string().optional(),
  children: z.array(SubTodoSchema).optional()
});
var TodoWriteInputSchema = z.object({
  todos: z.array(TodoItemSchema).describe("Hierarchical task list")
});
function calculateProgress(children) {
  if (!children || children.length === 0) return null;
  const nonCancelled = children.filter((c) => c.status !== "cancelled");
  const completed = nonCancelled.filter((c) => c.status === "completed").length;
  const total = nonCancelled.length;
  return { completed, total, label: `${completed}/${total}` };
}
function calculateGlobalStats(todos) {
  let totalSteps = todos.length;
  let completedSteps = todos.filter((t) => t.status === "completed").length;
  let totalSubTasks = 0;
  let completedSubTasks = 0;
  for (const item of todos) {
    if (item.children && item.children.length > 0) {
      const nonCancelled = item.children.filter(
        (c) => c.status !== "cancelled"
      );
      totalSubTasks += nonCancelled.length;
      completedSubTasks += nonCancelled.filter(
        (c) => c.status === "completed"
      ).length;
    } else if (item.status !== "cancelled") {
      totalSubTasks += 1;
      if (item.status === "completed") completedSubTasks += 1;
    }
  }
  const percent = totalSubTasks > 0 ? Math.round(completedSubTasks / totalSubTasks * 100) : 0;
  return {
    totalSteps,
    completedSteps,
    totalSubTasks,
    completedSubTasks,
    percent
  };
}
function validateAndNormalizeTodos(todos) {
  const seenIds = /* @__PURE__ */ new Set();
  const activeParents = [];
  for (const parent of todos) {
    if (seenIds.has(parent.id)) {
      return {
        valid: false,
        error: `Duplicate ID found: '${parent.id}'. Every ID must be unique across the tree.`
      };
    }
    seenIds.add(parent.id);
    if (parent.status === "in_progress") activeParents.push(parent.id);
    const activeChildren = [];
    for (const child of parent.children ?? []) {
      if (seenIds.has(child.id)) {
        return {
          valid: false,
          error: `Duplicate ID found: '${child.id}'. Every ID must be unique across the tree.`
        };
      }
      seenIds.add(child.id);
      if (child.status === "in_progress") activeChildren.push(child.id);
    }
    if (activeChildren.length > 1) {
      return {
        valid: false,
        error: `Task '${parent.id}' has ${activeChildren.length} subtasks 'in_progress'. At most 1 is allowed.`
      };
    }
    if (activeChildren.length === 1 && parent.status !== "in_progress") {
      return {
        valid: false,
        error: `Subtask '${activeChildren[0]}' is 'in_progress' but parent '${parent.id}' is '${parent.status}'. Set parent to 'in_progress' first.`
      };
    }
  }
  if (activeParents.length > 1) {
    return {
      valid: false,
      error: `Only 1 top-level task can be 'in_progress'. Found: ${activeParents.join(", ")}.`
    };
  }
  const normalized = [];
  for (const item of todos) {
    if (!item.children || item.children.length === 0) {
      normalized.push(item);
      continue;
    }
    const children = item.children;
    const hasUnfinishedChildren = children.some(
      (c) => c.status === "pending" || c.status === "in_progress"
    );
    if (item.status === "completed" && hasUnfinishedChildren) {
      return {
        valid: false,
        error: `Task '${item.id}' cannot be marked 'completed' while it still has pending or in-progress subtasks.`
      };
    }
    const allChildrenCompleted = children.length > 0 && children.every((c) => c.status === "completed");
    const nextStatus = allChildrenCompleted ? "completed" : item.status;
    normalized.push({ ...item, status: nextStatus });
  }
  return { valid: true, data: normalized };
}
var STATUS_ICONS = {
  pending: "[ ]",
  in_progress: "[~]",
  completed: "[x]",
  cancelled: "[-]"
};
function renderTodoTree(todos) {
  const lines = [];
  for (const parent of todos) {
    const icon = STATUS_ICONS[parent.status] ?? "[ ]";
    const prog = calculateProgress(parent.children);
    const progText = prog ? ` (${prog.label})` : "";
    const parentLabel = parent.content.startsWith(parent.id) ? parent.content : `${parent.id}. ${parent.content}`;
    lines.push(`${icon} ${parentLabel}${progText}`);
    if (parent.note) {
      lines.push(`    \u21B3 note: ${parent.note}`);
    }
    if (parent.children) {
      for (const child of parent.children) {
        const childIcon = STATUS_ICONS[child.status] ?? "[ ]";
        const childLabel = child.content.startsWith(child.id) ? child.content : `${child.id} ${child.content}`;
        lines.push(`    ${childIcon} ${childLabel}`);
        if (child.note) {
          lines.push(`        \u21B3 note: ${child.note}`);
        }
      }
    }
  }
  return lines.join("\n");
}

// src/store.ts
var InvalidTodoDataError = class extends Error {
  constructor(message) {
    super(message);
    this.name = "InvalidTodoDataError";
  }
};
function joinFor(platform, ...parts) {
  return platform === "win32" ? win32.join(...parts) : posix.join(...parts);
}
function resolveHomeDir(ctx = {}) {
  const env = ctx.env ?? process.env;
  const platform = ctx.platform ?? process.platform;
  if (ctx.home) return ctx.home;
  if (platform === "win32") {
    if (env.USERPROFILE) return env.USERPROFILE;
    if (env.HOMEDRIVE && env.HOMEPATH) return `${env.HOMEDRIVE}${env.HOMEPATH}`;
    if (env.HOME) return env.HOME;
  } else {
    if (env.HOME) return env.HOME;
    if (env.USERPROFILE) return env.USERPROFILE;
  }
  try {
    return homedir();
  } catch {
    return tmpdir();
  }
}
function resolveConfigHome(ctx = {}) {
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
      "Application Support"
    );
  }
  return joinFor(platform, resolveHomeDir(ctx), ".config");
}
function resolveTodosBaseDir(ctx = {}) {
  const env = ctx.env ?? process.env;
  const platform = ctx.platform ?? process.platform;
  if (env.OPENCODE_TODOS_DIR) return env.OPENCODE_TODOS_DIR;
  if (env.OPENCODE_CONFIG_DIR) {
    return joinFor(platform, env.OPENCODE_CONFIG_DIR, "tmp");
  }
  return joinFor(platform, resolveConfigHome(ctx), "opencode", "tmp");
}
function hashSessionID(sessionID) {
  const normalized = normalizeSessionID(sessionID);
  const digest = createHash("sha256").update(normalized).digest("hex");
  return `s_${digest.slice(0, 32)}`;
}
function getTodosDirectory(sessionID) {
  const baseDir = resolveTodosBaseDir();
  if (!sessionID) return baseDir;
  const hashed = hashSessionID(sessionID);
  const hashedDir = join(baseDir, hashed);
  const rawNormalized = normalizeSessionID(sessionID);
  const legacyDir = join(baseDir, rawNormalized);
  if (!existsSync(hashedDir) && existsSync(legacyDir)) {
    return legacyDir;
  }
  return hashedDir;
}
var TODOS_DIRECTORY = getTodosDirectory();
function normalizeSessionID(sessionID) {
  const normalized = sessionID.trim();
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(normalized)) {
    throw new Error("[todo store] invalid session ID");
  }
  return normalized;
}
function listSessionFiles(sessionID) {
  const safeSessionID = normalizeSessionID(sessionID);
  const prefix = "todos-";
  const suffix = ".json";
  const sessionDir = getTodosDirectory(safeSessionID);
  try {
    return readdirSync(sessionDir).flatMap((name) => {
      if (!name.startsWith(prefix) || !name.endsWith(suffix)) return [];
      const timestamp = Number(name.slice(prefix.length, -suffix.length));
      if (!Number.isSafeInteger(timestamp) || timestamp < 0) return [];
      return [{ path: join(sessionDir, name), timestamp }];
    }).sort((left, right) => right.timestamp - left.timestamp);
  } catch (error) {
    if (isMissingFile(error)) {
      const baseDir = getTodosDirectory();
      try {
        const legacyPrefix = `todos-${safeSessionID}-`;
        return readdirSync(baseDir).flatMap((name) => {
          if (!name.startsWith(legacyPrefix) || !name.endsWith(suffix))
            return [];
          const timestamp = Number(
            name.slice(legacyPrefix.length, -suffix.length)
          );
          if (!Number.isSafeInteger(timestamp) || timestamp < 0) return [];
          return [{ path: join(baseDir, name), timestamp }];
        }).sort((left, right) => right.timestamp - left.timestamp);
      } catch (legacyErr) {
        if (isMissingFile(legacyErr)) return [];
        throw legacyErr;
      }
    }
    throw error;
  }
}
function getTodoLockPath(sessionID) {
  const safeSessionID = normalizeSessionID(sessionID);
  return join(getTodosDirectory(safeSessionID), "todos.lock");
}
function getHintMarkerPath(sessionID) {
  const safeSessionID = normalizeSessionID(sessionID);
  return join(getTodosDirectory(safeSessionID), "hint-marker.json");
}
function getTodoFilePath(sessionID) {
  const safeSessionID = normalizeSessionID(sessionID);
  return listSessionFiles(safeSessionID)[0]?.path ?? join(getTodosDirectory(safeSessionID), `todos-${Date.now()}.json`);
}
function isMissingFile(error) {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
function parseTodoFile(raw) {
  try {
    const parsed = JSON.parse(raw);
    const list = Array.isArray(parsed) ? parsed : typeof parsed === "object" && parsed !== null && "todos" in parsed ? parsed.todos : void 0;
    if (!Array.isArray(list)) throw new Error("todo list is missing");
    const result = TodoItemSchema.array().safeParse(list);
    if (!result.success) {
      throw new Error(result.error.issues.map((i) => i.message).join(", "));
    }
    return result.data;
  } catch (err) {
    throw new InvalidTodoDataError(
      `[todo store read failed] invalid todo data: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}
async function readTodos(sessionID) {
  const filePath = getTodoFilePath(sessionID);
  try {
    return parseTodoFile(await readFile(filePath, "utf8"));
  } catch (error) {
    if (isMissingFile(error)) return [];
    if (error instanceof InvalidTodoDataError) throw error;
    throw new Error(
      `[todo store read failed] unable to read todo storage: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}
function readTodoData(sessionID) {
  try {
    const safeSessionID = normalizeSessionID(sessionID);
    const filePath = getTodoFilePath(safeSessionID);
    const raw = readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const todos = Array.isArray(parsed.todos) ? parsed.todos : Array.isArray(parsed) ? parsed : [];
    const version = typeof parsed.version === "number" && Number.isSafeInteger(parsed.version) ? parsed.version : 0;
    const updatedAt = typeof parsed.updatedAt === "string" ? parsed.updatedAt : (/* @__PURE__ */ new Date()).toISOString();
    return { version, todos, updatedAt };
  } catch {
    return null;
  }
}
async function updateTodos(sessionID, update) {
  const safeSessionID = normalizeSessionID(sessionID);
  const baseDir = getTodosDirectory();
  const legacyDir = join(baseDir, safeSessionID);
  const targetDir = join(baseDir, hashSessionID(safeSessionID));
  if (existsSync(legacyDir) && !existsSync(targetDir)) {
    try {
      await rename(legacyDir, targetDir);
    } catch {
    }
  }
  const sessionDir = getTodosDirectory(safeSessionID);
  await mkdir(sessionDir, { recursive: true });
  const initialPath = getTodoFilePath(safeSessionID);
  const release = await lockfile.lock(initialPath, {
    realpath: false,
    lockfilePath: getTodoLockPath(safeSessionID),
    retries: { retries: 10, minTimeout: 10, maxTimeout: 250 },
    stale: 1e4
  });
  let temporary;
  try {
    const filePath = getTodoFilePath(safeSessionID);
    let current = [];
    try {
      current = await readTodos(safeSessionID);
    } catch (error) {
      if (!(error instanceof InvalidTodoDataError)) {
        throw error;
      }
      await rename(filePath, `${filePath}.corrupt-${Date.now()}`).catch(
        () => {
        }
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
    } catch {
    }
    const payload = {
      version: prevVersion + 1,
      todos: result.data,
      updatedAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    temporary = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(payload, null, 2)}
`, "utf8");
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

// src/hint.ts
var DEFAULT_STALE_MS = 30 * 60 * 1e3;
var TODO_HINT = "<todo_hint>Active todos exist. If continuing previous work, call manage_todo_list [read] first. Ignore if the user is discussing something else.</todo_hint>";
function isTaskActive(task) {
  if (task.status === "pending" || task.status === "in_progress") return true;
  if (task.children && task.children.some(
    (c) => c.status === "pending" || c.status === "in_progress"
  )) {
    return true;
  }
  return false;
}
function isAnyTodoActive(todos) {
  return todos.some(isTaskActive);
}
function atomicWrite(file, data) {
  const tmp = `${file}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
  writeFileSync(tmp, data, "utf8");
  renameSync(tmp, file);
}
function consumeTodoHint(sessionID, options) {
  try {
    if (!sessionID) return void 0;
    const safeSessionID = normalizeSessionID(sessionID);
    const state = readTodoData(safeSessionID);
    if (!state) return void 0;
    const todos = state.todos;
    if (todos.length === 0 || !isAnyTodoActive(todos)) return void 0;
    const staleMs = options?.staleMs ?? DEFAULT_STALE_MS;
    const now = options?.now ?? Date.now();
    const updatedAt = Date.parse(state.updatedAt);
    if (Number.isFinite(updatedAt) && now - updatedAt > staleMs) {
      return void 0;
    }
    const markerFile = getHintMarkerPath(safeSessionID);
    let hintedVersion = -1;
    try {
      const marker = JSON.parse(readFileSync2(markerFile, "utf8"));
      if (typeof marker?.version === "number") hintedVersion = marker.version;
    } catch {
    }
    if (hintedVersion === state.version) return void 0;
    atomicWrite(markerFile, JSON.stringify({ version: state.version }));
    return TODO_HINT;
  } catch {
    return void 0;
  }
}

// src/index.ts
var todoListStatusSchema = z2.enum([
  "pending",
  "in_progress",
  "completed",
  "cancelled"
]);
var prioritySchema = z2.enum(["high", "medium", "low"]);
var subTodoInputSchema = z2.object({
  id: z2.string().optional(),
  title: z2.string().optional(),
  content: z2.string().optional(),
  status: todoListStatusSchema.default("pending"),
  priority: prioritySchema.optional(),
  note: z2.string().optional()
});
var manageTodoItemSchema = subTodoInputSchema.extend({
  children: z2.array(subTodoInputSchema).optional()
});
var manageTodoListSchema = z2.object({
  operation: z2.enum(["read", "write"]).describe(
    "'read' to inspect current todos, 'write' to set/replace the full list."
  ),
  todos: z2.array(manageTodoItemSchema).default([]).describe(
    "The entire todo list to write. Pass [] or omit to clear the list."
  )
});
var manageTodoListOutputSchema = z2.object({
  todos: z2.array(TodoItemSchema)
});
function normalizeStatus(raw) {
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
function buildTodosFromInput(rawTodos) {
  return rawTodos.map((item, index) => {
    const parentId = item.id?.trim() || String(index + 1);
    const content = (item.title || item.content || `Task ${parentId}`).trim();
    const status = normalizeStatus(item.status);
    const children = (item.children ?? []).map((c, cIndex) => ({
      id: c.id?.trim() || `${parentId}.${cIndex + 1}`,
      content: (c.title || c.content || `Subtask ${cIndex + 1}`).trim(),
      status: normalizeStatus(c.status),
      ...c.priority ? { priority: c.priority } : {},
      ...c.note?.trim() ? { note: c.note.trim() } : {}
    }));
    return {
      id: parentId,
      content,
      status,
      ...item.priority ? { priority: item.priority } : {},
      ...item.note?.trim() ? { note: item.note.trim() } : {},
      ...children.length > 0 ? { children } : {}
    };
  });
}
function formatReadOutput(todos) {
  return todos.length === 0 ? "No todos recorded." : renderTodoTree(todos);
}
async function registerTodoTools(ctx) {
  await ctx.tool.transform((tools) => {
    tools.add({
      name: "manage_todo_list",
      description: "Manage the todo list for multi-step tasks. Use 'write' to set/replace the full list. Exactly one active task can be 'in-progress' at a time. Mark completed immediately when done. Note: Call 'read' first if unsure of current state, as tasks can be cleared by user via UI.",
      input: manageTodoListSchema,
      output: manageTodoListOutputSchema,
      options: { codemode: false },
      execute: async (input, toolContext) => {
        const raw = input && typeof input === "object" ? { ...input } : {};
        if (raw.todos === void 0) {
          if (Array.isArray(raw.items)) raw.todos = raw.items;
          else if (Array.isArray(raw.tasks)) raw.todos = raw.tasks;
          else if (Array.isArray(raw.todo)) raw.todos = raw.todo;
        }
        const parsed = manageTodoListSchema.safeParse(raw);
        if (!parsed.success) {
          throw new Error(
            `[manage_todo_list validation failed] ${parsed.error.issues.map((i) => i.message).join(", ")}`
          );
        }
        if (parsed.data.operation === "read") {
          const todos2 = await readTodos(toolContext.sessionID);
          return { output: { todos: todos2 }, content: formatReadOutput(todos2) };
        }
        const rawTodos = parsed.data.todos ?? [];
        if (rawTodos.length === 0) {
          await updateTodos(toolContext.sessionID, () => []);
          return { output: { todos: [] }, content: "Cleared all todos." };
        }
        const formattedTodos = buildTodosFromInput(rawTodos);
        const todos = await updateTodos(
          toolContext.sessionID,
          () => formattedTodos
        );
        const stats = calculateGlobalStats(todos);
        return {
          output: { todos },
          content: `Todos (${stats.completedSubTasks}/${stats.totalSubTasks}) updated successfully.`
        };
      }
    });
  });
  await registerTodoPromptHook(ctx);
}
async function registerTodoPromptHook(ctx) {
  if (typeof ctx.session?.hook !== "function") return;
  try {
    await ctx.session.hook("context", async (sessionContext) => {
      try {
        const system = sessionContext?.system;
        if (!Array.isArray(system)) return;
        const hint = consumeTodoHint(sessionContext.sessionID);
        if (!hint) return;
        system.push({ type: "text", text: hint });
      } catch {
      }
    });
    return;
  } catch {
  }
  try {
    await ctx.session.hook("prompt", async (sessionPrompt) => {
      try {
        if (!sessionPrompt.prompt?.text?.trim()) return;
        const hint = consumeTodoHint(sessionPrompt.sessionID);
        if (hint) {
          sessionPrompt.prompt.text = `${sessionPrompt.prompt.text}

${hint}`;
        }
      } catch {
      }
    });
  } catch {
  }
}
var index_default = Plugin.define({
  id: "opencode.tools.modern.todos",
  setup: registerTodoTools
});
export {
  buildTodosFromInput,
  index_default as default,
  formatReadOutput,
  manageTodoItemSchema,
  manageTodoListOutputSchema,
  manageTodoListSchema,
  normalizeStatus,
  registerTodoPromptHook,
  registerTodoTools,
  subTodoInputSchema
};

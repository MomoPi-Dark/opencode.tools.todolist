// src/tui.tsx
import { effect as _$effect } from "@opentui/solid";
import { createTextNode as _$createTextNode } from "@opentui/solid";
import { insertNode as _$insertNode } from "@opentui/solid";
import { insert as _$insert } from "@opentui/solid";
import { memo as _$memo2 } from "@opentui/solid";
import { setProp as _$setProp } from "@opentui/solid";
import { createElement as _$createElement2 } from "@opentui/solid";
import { createComponent as _$createComponent } from "@opentui/solid";
import { Plugin } from "@opencode/plugin/tui";
import { mkdirSync, watch } from "node:fs";
import { createEffect, createMemo as createMemo2, createSignal, For, onCleanup, Show } from "solid-js";

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

// src/display.ts
function getStatusIcon(status) {
  switch (status) {
    case "completed":
      return "\u2714";
    case "in_progress":
      return "\u29BF";
    case "cancelled":
      return "\u2715";
    case "pending":
    default:
      return "\u25CB";
  }
}
function getTodoDisplaySummary(todos) {
  if (!todos || todos.length === 0) return null;
  const stats = calculateGlobalStats(todos);
  const completed = stats.completedSubTasks;
  const total = stats.totalSubTasks;
  const header = `Todos (${completed}/${total})`;
  const items = [];
  for (const parent of todos) {
    items.push({
      id: parent.id,
      content: parent.content,
      icon: getStatusIcon(parent.status),
      status: parent.status,
      depth: 0
    });
    for (const child of parent.children ?? []) {
      items.push({
        id: child.id,
        content: child.content,
        icon: getStatusIcon(child.status),
        status: child.status,
        depth: 1
      });
    }
  }
  return { header, completed, total, items };
}
function formatTodoProgress(todos) {
  const summary = getTodoDisplaySummary(todos);
  return summary ? summary.header : null;
}

// src/icons/convert.tsx
import { spread as _$spread } from "@opentui/solid";
import { mergeProps as _$mergeProps } from "@opentui/solid";
import { memo as _$memo } from "@opentui/solid";
import { createElement as _$createElement } from "@opentui/solid";
import { usePlugin } from "@opencode/plugin/tui";
import { rgbToHex } from "@opentui/core";
import { Resvg } from "@resvg/resvg-js";
import { createMemo } from "solid-js";
function SvgIcon(props) {
  const {
    source: _,
    color: __,
    ...prop
  } = props;
  const context = usePlugin();
  const pngBuffer = createMemo(() => {
    const bgToken = context.theme.background.base;
    const bg = rgbToHex(bgToken);
    const strokeColor = typeof props.color === "string" ? props.color : rgbToHex(props.color);
    const svg = props.source.replace(/stroke="[^"]*"/g, `stroke="${strokeColor}"`).replace(/color="[^"]*"/g, `color="${strokeColor}"`);
    const resvg = new Resvg(svg, {
      fitTo: {
        mode: "width",
        value: 64
      },
      background: bg
    });
    return resvg.render().asPng();
  });
  return (() => {
    var _el$ = _$createElement("image");
    _$spread(_el$, _$mergeProps({
      get source() {
        return pngBuffer();
      },
      get width() {
        return props.width ?? 2;
      },
      get height() {
        return props.height ?? 1;
      }
    }, prop), false);
    return _el$;
  })();
}

// src/icons/icons.ts
var removeSvgIcon = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" color="currentColor" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
  <path d="M3 5H17"/>
  <path d="M3 12H12"/>
  <path d="M16.0083 9.50391L18.5 11.9997M18.5 11.9997L21 14.5039M18.5 11.9997L16 14.5039M18.5 11.9997L20.9917 9.50391"/>
  <path d="M3 19H17"/>
</svg>
`;
var arrowDownSvgIcon = `
<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <path d="m6 9 6 6 6-6"/>
</svg>
`;
var arrowRightSvgIcon = `
<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <path d="m9 18 6-6-6-6"/>
</svg>
`;

// src/store.ts
import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join, posix, win32 } from "node:path";
import * as lockfile from "proper-lockfile";
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
function readTodosSync(sessionID) {
  const filePath = getTodoFilePath(sessionID);
  try {
    return parseTodoFile(readFileSync(filePath, "utf8"));
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
async function writeTodos(sessionID, todos) {
  await updateTodos(sessionID, () => todos);
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

// src/tui.tsx
var SPINNER_FRAMES = ["\u280B", "\u2819", "\u2839", "\u2838", "\u283C", "\u2834", "\u2826", "\u2827", "\u2807", "\u280F"];
function TodoProgress(props) {
  const [refresh, setRefresh] = createSignal(0);
  const [isCollapsed, setIsCollapsed] = createSignal(true);
  const [isClearHovered, setIsClearHovered] = createSignal(false);
  const [animFrame, setAnimFrame] = createSignal(0);
  let timer;
  let watcher;
  let animTimer;
  const getSessionID = () => props.sessionID ?? "";
  const checkRunning = () => {
    const sid = getSessionID();
    if (!sid) return false;
    try {
      return props.context.data.session.status(sid) === "running";
    } catch {
      return false;
    }
  };
  const [isRunning, setIsRunning] = createSignal(checkRunning());
  const unsubList = [props.context.data.on("session.execution.started", (e) => {
    const sid = getSessionID();
    if (!sid || e.data.sessionID === sid) setIsRunning(true);
  }), props.context.data.on("session.execution.interrupted", (e) => {
    const sid = getSessionID();
    if (!sid || e.data.sessionID === sid) setIsRunning(false);
  }), props.context.data.on("session.execution.succeeded", (e) => {
    const sid = getSessionID();
    if (!sid || e.data.sessionID === sid) setIsRunning(false);
  }), props.context.data.on("session.execution.failed", (e) => {
    const sid = getSessionID();
    if (!sid || e.data.sessionID === sid) setIsRunning(false);
  }), props.context.data.on("session.idle", (e) => {
    const sid = getSessionID();
    if (!sid || e.data.sessionID === sid) setIsRunning(false);
  }), props.context.data.on("session.status", (e) => {
    const sid = getSessionID();
    if (!sid || e.data.sessionID === sid) {
      setIsRunning(e.data.status.type !== "idle");
    }
  })];
  createEffect(() => {
    const sid = getSessionID();
    if (!sid) {
      setIsRunning(false);
      return;
    }
    try {
      setIsRunning(props.context.data.session.status(sid) === "running");
    } catch {
      setIsRunning(false);
    }
  });
  const startAnimation = () => {
    if (animTimer) return;
    animTimer = setInterval(() => {
      setAnimFrame((prev) => (prev + 1) % SPINNER_FRAMES.length);
    }, 100);
  };
  const stopAnimation = () => {
    if (animTimer) {
      clearInterval(animTimer);
      animTimer = void 0;
    }
  };
  try {
    const baseDir = getTodosDirectory();
    mkdirSync(baseDir, {
      recursive: true
    });
    watcher = watch(baseDir, {
      recursive: true,
      persistent: false
    }, (_, filename) => {
      const sid = getSessionID();
      if (!filename) {
        clearTimeout(timer);
        timer = setTimeout(() => setRefresh((value) => value + 1), 50);
        return;
      }
      const nameStr = String(filename);
      let hashedSid = "";
      try {
        if (sid) hashedSid = hashSessionID(sid);
      } catch {
      }
      if (!sid || hashedSid && nameStr.startsWith(hashedSid) || nameStr.startsWith(sid) || nameStr.startsWith(`todos-${sid}-`)) {
        clearTimeout(timer);
        timer = setTimeout(() => setRefresh((value) => value + 1), 50);
      }
    });
  } catch (err) {
    console.error("[todos] watcher initialization failed:", err);
  }
  onCleanup(() => {
    clearTimeout(timer);
    stopAnimation();
    watcher?.close();
    for (const unsub of unsubList) {
      try {
        unsub?.();
      } catch {
      }
    }
  });
  const summary = createMemo2(() => {
    refresh();
    const sid = getSessionID();
    if (!sid) return null;
    try {
      return getTodoDisplaySummary(readTodosSync(sid));
    } catch {
      return null;
    }
  });
  createEffect(() => {
    const hasInProgress = summary()?.items.some((i) => i.status === "in_progress");
    if (hasInProgress && isRunning()) {
      startAnimation();
    } else {
      stopAnimation();
    }
  });
  const activeItem = createMemo2(() => {
    const d = summary();
    if (!d) return null;
    return d.items.find((i) => i.status === "in_progress" && i.depth > 0) ?? d.items.find((i) => i.status === "in_progress") ?? null;
  });
  const getItemIcon = (status, fallbackIcon) => {
    if (status === "in_progress") {
      if (isRunning()) {
        return SPINNER_FRAMES[animFrame()];
      }
      return "-";
    }
    return fallbackIcon;
  };
  const theme = () => props.context.theme;
  const getStatusColor = (status) => {
    const t = theme();
    switch (status) {
      case "in_progress":
        return isRunning() ? t.text.action?.primary?.base ?? t.text.feedback.info?.base ?? t.text.base : t.text.muted;
      case "completed":
        return t.text.feedback.success.base;
      case "cancelled":
        return t.text.feedback.error.base;
      case "pending":
      default:
        return t.text.muted;
    }
  };
  const getTextColor = (status) => {
    const t = theme();
    if (status === "completed" || status === "cancelled") {
      return t.text.muted;
    }
    return t.text.base;
  };
  const getBorderColor = () => {
    return theme().border.base;
  };
  return _$createComponent(Show, {
    get when() {
      return summary();
    },
    children: (data) => (() => {
      var _el$ = _$createElement2("box"), _el$2 = _$createElement2("box"), _el$3 = _$createElement2("box"), _el$4 = _$createElement2("box"), _el$5 = _$createElement2("text"), _el$6 = _$createElement2("span"), _el$8 = _$createElement2("span"), _el$9 = _$createElement2("box");
      _$insertNode(_el$, _el$2);
      _$setProp(_el$, "flexDirection", "column");
      _$setProp(_el$, "border", true);
      _$setProp(_el$, "borderStyle", "single");
      _$setProp(_el$, "paddingLeft", 1);
      _$setProp(_el$, "paddingRight", 1);
      _$insertNode(_el$2, _el$3);
      _$insertNode(_el$2, _el$9);
      _$setProp(_el$2, "flexDirection", "row");
      _$setProp(_el$2, "justifyContent", "space-between");
      _$insertNode(_el$3, _el$4);
      _$insertNode(_el$3, _el$5);
      _$setProp(_el$3, "flexDirection", "row");
      _$setProp(_el$3, "flexGrow", 1);
      _$setProp(_el$3, "onMouseDown", (e) => {
        if (e.button === 0) {
          e.stopPropagation?.();
          setIsCollapsed(!isCollapsed());
        }
      });
      _$setProp(_el$4, "width", 2);
      _$setProp(_el$4, "height", 1);
      _$setProp(_el$4, "marginRight", 1);
      _$insert(_el$4, (() => {
        var _c$ = _$memo2(() => !!isCollapsed());
        return () => _c$() ? _$createComponent(SvgIcon, {
          source: arrowRightSvgIcon,
          get color() {
            return theme().text.muted;
          },
          width: 2,
          height: 1
        }) : _$createComponent(SvgIcon, {
          source: arrowDownSvgIcon,
          get color() {
            return theme().text.muted;
          },
          width: 2,
          height: 1
        });
      })());
      _$insertNode(_el$5, _el$6);
      _$insertNode(_el$5, _el$8);
      _$insertNode(_el$6, _$createTextNode(`Todos `));
      _$insert(_el$8, () => `(${data().completed}/${data().total})`);
      _$insert(_el$5, _$createComponent(Show, {
        get when() {
          return _$memo2(() => !!isCollapsed())() && activeItem();
        },
        children: (active) => [(() => {
          var _el$1 = _$createElement2("span");
          _$insertNode(_el$1, _$createTextNode(`  `));
          _$effect((_$p) => _$setProp(_el$1, "style", {
            fg: theme().text.muted
          }, _$p));
          return _el$1;
        })(), (() => {
          var _el$11 = _$createElement2("span"), _el$12 = _$createTextNode(` `);
          _$insertNode(_el$11, _el$12);
          _$insert(_el$11, () => getItemIcon(active().status, active().icon), _el$12);
          _$effect((_$p) => _$setProp(_el$11, "style", {
            fg: getStatusColor(active().status)
          }, _$p));
          return _el$11;
        })(), (() => {
          var _el$13 = _$createElement2("span");
          _$insert(_el$13, () => active().content);
          _$effect((_$p) => _$setProp(_el$13, "style", {
            fg: getTextColor(active().status)
          }, _$p));
          return _el$13;
        })()]
      }), null);
      _$setProp(_el$9, "flexDirection", "row");
      _$setProp(_el$9, "onMouseOver", () => setIsClearHovered(true));
      _$setProp(_el$9, "onMouseOut", () => setIsClearHovered(false));
      _$setProp(_el$9, "onMouseDown", async (e) => {
        if (e.button === 0) {
          e.stopPropagation();
          const sid = getSessionID();
          if (sid) {
            try {
              await writeTodos(sid, []);
              setRefresh((value) => value + 1);
            } catch (error) {
              console.error("[todos] clear failed:", error);
            }
          }
        }
      });
      _$insert(_el$9, _$createComponent(SvgIcon, {
        get color() {
          return _$memo2(() => !!isClearHovered())() ? theme().text.feedback.error.base : theme().text.muted;
        },
        source: removeSvgIcon,
        height: 1,
        width: 2
      }));
      _$insert(_el$, _$createComponent(Show, {
        get when() {
          return !isCollapsed();
        },
        get children() {
          var _el$0 = _$createElement2("box");
          _$setProp(_el$0, "flexDirection", "column");
          _$setProp(_el$0, "paddingTop", 1);
          _$setProp(_el$0, "maxHeight", 8);
          _$setProp(_el$0, "overflow", "hidden");
          _$insert(_el$0, _$createComponent(For, {
            get each() {
              return data().items;
            },
            children: (item) => (() => {
              var _el$14 = _$createElement2("box"), _el$15 = _$createElement2("text"), _el$18 = _$createElement2("span"), _el$19 = _$createTextNode(` `), _el$20 = _$createElement2("span");
              _$insertNode(_el$14, _el$15);
              _$setProp(_el$14, "flexDirection", "row");
              _$setProp(_el$14, "height", 1);
              _$insertNode(_el$15, _el$18);
              _$insertNode(_el$15, _el$20);
              _$insert(_el$15, _$createComponent(Show, {
                get when() {
                  return item.depth > 0;
                },
                get children() {
                  var _el$16 = _$createElement2("span");
                  _$insertNode(_el$16, _$createTextNode(`  `));
                  return _el$16;
                }
              }), _el$18);
              _$insertNode(_el$18, _el$19);
              _$insert(_el$18, () => getItemIcon(item.status, item.icon), _el$19);
              _$insert(_el$20, () => item.content);
              _$effect((_p$) => {
                var _v$4 = {
                  fg: getStatusColor(item.status)
                }, _v$5 = {
                  fg: getTextColor(item.status)
                };
                _v$4 !== _p$.e && (_p$.e = _$setProp(_el$18, "style", _v$4, _p$.e));
                _v$5 !== _p$.t && (_p$.t = _$setProp(_el$20, "style", _v$5, _p$.t));
                return _p$;
              }, {
                e: void 0,
                t: void 0
              });
              return _el$14;
            })()
          }));
          return _el$0;
        }
      }), null);
      _$effect((_p$) => {
        var _v$ = getBorderColor(), _v$2 = {
          fg: theme().text.base
        }, _v$3 = {
          fg: theme().text.muted
        };
        _v$ !== _p$.e && (_p$.e = _$setProp(_el$, "borderColor", _v$, _p$.e));
        _v$2 !== _p$.t && (_p$.t = _$setProp(_el$6, "style", _v$2, _p$.t));
        _v$3 !== _p$.a && (_p$.a = _$setProp(_el$8, "style", _v$3, _p$.a));
        return _p$;
      }, {
        e: void 0,
        t: void 0,
        a: void 0
      });
      return _el$;
    })()
  });
}
var tui_default = Plugin.define({
  id: "opencode.tools.modern.todos.tui",
  setup(context) {
    const prompt = context.ui.slot({
      after: "session.composer.top",
      render: (input) => _$createComponent(TodoProgress, {
        context,
        get sessionID() {
          return input.sessionID;
        }
      })
    });
    return () => {
      prompt();
    };
  }
});
export {
  tui_default as default,
  formatTodoProgress,
  getStatusIcon,
  getTodoDisplaySummary
};

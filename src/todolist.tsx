import { Plugin } from "@opencode/plugin/tui";
import { mkdirSync, watch } from "node:fs";
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  onCleanup,
  Show,
} from "solid-js";
import {
  formatTodoProgress,
  getStatusIcon,
  getTodoDisplaySummary,
  type TodoDisplayItem,
  type TodoDisplaySummary,
} from "./display";
import { getTodosDirectory, readTodosSync, writeTodos } from "./store";
import type { TodoStatus } from "./todo";

export {
  formatTodoProgress,
  getStatusIcon,
  getTodoDisplaySummary,
  type TodoDisplayItem,
  type TodoDisplaySummary,
};

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

function TodoProgress(props: { context: Plugin.Context; sessionID?: string }) {
  const [refresh, setRefresh] = createSignal(0);
  const [isCollapsed, setIsCollapsed] = createSignal(true);
  const [isClearHovered, setIsClearHovered] = createSignal(false);
  const [animFrame, setAnimFrame] = createSignal(0);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let watcher: ReturnType<typeof watch> | undefined;
  let animTimer: ReturnType<typeof setInterval> | undefined;

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

  const unsubList = [
    props.context.data.on("session.execution.started", (e) => {
      const sid = getSessionID();
      if (!sid || e.data.sessionID === sid) setIsRunning(true);
    }),
    props.context.data.on("session.execution.interrupted", (e) => {
      const sid = getSessionID();
      if (!sid || e.data.sessionID === sid) setIsRunning(false);
    }),
    props.context.data.on("session.execution.succeeded", (e) => {
      const sid = getSessionID();
      if (!sid || e.data.sessionID === sid) setIsRunning(false);
    }),
    props.context.data.on("session.execution.failed", (e) => {
      const sid = getSessionID();
      if (!sid || e.data.sessionID === sid) setIsRunning(false);
    }),
    props.context.data.on("session.idle", (e) => {
      const sid = getSessionID();
      if (!sid || e.data.sessionID === sid) setIsRunning(false);
    }),
    props.context.data.on("session.status", (e) => {
      const sid = getSessionID();
      if (!sid || e.data.sessionID === sid) {
        setIsRunning(e.data.status.type !== "idle");
      }
    }),
  ];

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
      animTimer = undefined;
    }
  };

  try {
    const baseDir = getTodosDirectory();
    mkdirSync(baseDir, { recursive: true });
    watcher = watch(
      baseDir,
      { recursive: true, persistent: false },
      (_, filename) => {
        const sid = getSessionID();
        if (!filename) {
          clearTimeout(timer);
          timer = setTimeout(() => setRefresh((value) => value + 1), 50);
          return;
        }

        const nameStr = String(filename);
        if (
          !sid ||
          nameStr.startsWith(sid) ||
          nameStr.startsWith(`todos-${sid}-`)
        ) {
          clearTimeout(timer);
          timer = setTimeout(() => setRefresh((value) => value + 1), 50);
        }
      },
    );
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
      } catch { }
    }
  });

  const summary = createMemo(() => {
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
    const hasInProgress = summary()?.items.some(
      (i) => i.status === "in_progress",
    );
    if (hasInProgress && isRunning()) {
      startAnimation();
    } else {
      stopAnimation();
    }
  });

  const activeItem = createMemo(() => {
    const d = summary();
    if (!d) return null;
    return (
      d.items.find((i) => i.status === "in_progress" && i.depth > 0) ??
      d.items.find((i) => i.status === "in_progress") ??
      null
    );
  });

  const getItemIcon = (status: TodoStatus, fallbackIcon: string) => {
    if (status === "in_progress") {
      if (isRunning()) {
        return SPINNER_FRAMES[animFrame()];
      }
      return "-";
    }
    return fallbackIcon;
  };

  const theme = () => props.context.theme;

  const getStatusColor = (status: TodoStatus) => {
    const t = theme();
    switch (status) {
      case "in_progress":
        return isRunning()
          ? (t.text.action?.primary?.base ??
              t.text.feedback.info?.base ??
              t.text.base)
          : t.text.muted;
      case "completed":
        return t.text.feedback.success.base;
      case "cancelled":
        return t.text.feedback.error.base;
      case "pending":
      default:
        return t.text.muted;
    }
  };

  const getTextColor = (status: TodoStatus) => {
    const t = theme();
    if (status === "completed" || status === "cancelled") {
      return t.text.muted;
    }
    return t.text.base;
  };

  const getBorderColor = () => {
    return theme().border.base;
  };

  return (
    <Show when={summary()}>
      {(data) => (
        <box
          flexDirection="column"
          border={true}
          borderStyle="single"
          borderColor={getBorderColor()}
          paddingLeft={1}
          paddingRight={1}
        >
          <box flexDirection="row" justifyContent="space-between" width="100%">
            <box
              flexDirection="row"
              flexGrow={1}
              onMouseDown={(e: any) => {
                if (e?.button === 0) {
                  e?.stopPropagation?.();
                  setIsCollapsed(!isCollapsed());
                }
              }}
            >
              <text>
                <span style={{ fg: theme().text.muted }}>
                  {isCollapsed() ? "› " : "▾ "}
                </span>
                <span style={{ fg: theme().text.base }}>{"Todos "}</span>
                <span style={{ fg: theme().text.muted }}>
                  {`(${data().completed}/${data().total})`}
                </span>
                <Show when={isCollapsed() && activeItem()}>
                  {(active) => (
                    <>
                      <span style={{ fg: theme().text.muted }}>{"  "}</span>
                      <span style={{ fg: getStatusColor(active().status) }}>
                        {getItemIcon(active().status, active().icon)}{" "}
                      </span>
                      <span style={{ fg: getTextColor(active().status) }}>
                        {active().content}
                      </span>
                    </>
                  )}
                </Show>
              </text>
            </box>

            <box
              flexDirection="row"
              onMouseOver={() => setIsClearHovered(true)}
              onMouseOut={() => setIsClearHovered(false)}
              onMouseDown={async (e: any) => {
                if (e?.button === 0) {
                  e?.stopPropagation?.();
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
              }}
            >
              <text>
                <span
                  style={{
                    fg: isClearHovered()
                      ? theme().text.feedback.error.base
                      : theme().text.muted,
                  }}
                >
                  {"✕"}
                </span>
              </text>
            </box>
          </box>

          <Show when={!isCollapsed()}>
            <box
              flexDirection="column"
              paddingTop={1}
              maxHeight={8}
              overflow="hidden"
            >
              <For each={data().items}>
                {(item) => (
                  <box flexDirection="row" height={1}>
                    <text>
                      <Show when={item.depth > 0}>
                        <span>{"    "}</span>
                      </Show>
                      <span style={{ fg: getStatusColor(item.status) }}>
                        {getItemIcon(item.status, item.icon)}{" "}
                      </span>
                      <span style={{ fg: getTextColor(item.status) }}>
                        {item.content}
                      </span>
                    </text>
                  </box>
                )}
              </For>
            </box>
          </Show>
        </box>
      )}
    </Show>
  );
}

export default Plugin.define({
  id: "opencode.tools.modern.todos.tui",
  setup(context) {
    const release = context.ui.slot({
      append: "session.composer.top",
      render: (input) => (
        <TodoProgress context={context} sessionID={input?.sessionID} />
      ),
    });

    return release;
  },
});

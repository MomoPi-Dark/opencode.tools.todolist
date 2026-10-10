import { Plugin } from "@opencode/plugin/tui";
import type { ColorInput, ScrollBoxRenderable } from "@opentui/core";
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
import { SvgIcon } from "./icons/convert";
import {
  arrowDownSvgIcon,
  arrowRightSvgIcon,
  removeSvgIcon,
} from "./icons/icons";
import {
  getTodosDirectory,
  hashSessionID,
  readTodosSync,
  writeTodos,
} from "./store";
import type { TodoStatus } from "./todo";

export {
  formatTodoProgress,
  getStatusIcon,
  getTodoDisplaySummary,
  type TodoDisplayItem,
  type TodoDisplaySummary,
};

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

/**
 * Maximum number of todo rows the panel shows before it starts scrolling.
 * Keeping the panel compact protects the composer; scrolling guarantees no
 * row is ever silently dropped.
 */
export const TODO_PANEL_MAX_ROWS = 8;

export interface TodoListRow {
  id: string;
  content: string;
  icon: string;
  iconColor: ColorInput;
  textColor: ColorInput;
  depth: number;
  status: TodoStatus;
}

/**
 * Rendered width of a row: the indentation, the icon cell and the title.
 *
 * Rows must be sized explicitly, otherwise the scroll content never grows
 * wider than the viewport and horizontal scrolling has nothing to move.
 */
export function rowWidth(row: { content: string; depth: number }): number {
  const indent = row.depth > 0 ? 2 : 0;
  // icon glyph + trailing space, then the title.
  return indent + 2 + 1 + [...row.content].length;
}

export interface FollowScrollInput {
  currentTop: number;
  activeIndex: number;
  rowCount: number;
  viewportHeight: number;
}

/**
 * Scroll offset needed to reveal the active row, or `undefined` when nothing
 * should move (no active row, already visible, or the list fits).
 *
 * Kept pure so the follow behaviour is testable without a live renderer.
 */
export function nextFollowScrollTop(input: FollowScrollInput): number | undefined {
  const { currentTop, activeIndex, rowCount, viewportHeight } = input;
  if (activeIndex < 0) return undefined;

  const viewport = Math.max(1, viewportHeight);
  const maxTop = Math.max(0, rowCount - viewport);
  if (maxTop === 0) return undefined;

  const activeBottom = activeIndex + 1;
  const visibleTop = currentTop;
  const visibleBottom = currentTop + viewport;

  if (activeIndex >= visibleTop && activeBottom <= visibleBottom) {
    return undefined;
  }

  const targetTop =
    activeIndex >= visibleBottom ? activeBottom - viewport : activeIndex;
  return Math.min(Math.max(0, targetTop), maxTop);
}

/**
 * Follow the most advanced active row: the last `in_progress` entry is the
 * task currently being executed.
 */
export function findActiveRowIndex(rows: { status: TodoStatus }[]): number {
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    if (rows[index].status === "in_progress") return index;
  }
  return -1;
}

/**
 * Presentational, context-free todo list.
 *
 * The panel is deliberately chrome-free: no indicator row, and the horizontal
 * scrollbar stays hidden. Long titles never wrap (that would break the
 * one-line-per-row layout) — they are reached by scrolling left/right, and the
 * vertical list scrolls when it exceeds `TODO_PANEL_MAX_ROWS`. When a row is
 * `in_progress` the panel follows it so the active task is never out of sight.
 */
export function TodoList(props: {
  rows: TodoListRow[];
  scrollbarColor?: ColorInput;
  ref?: (el: ScrollBoxRenderable) => void;
}) {
  const rowId = (id: string) => `todo-row-${id}`;
  const [scrollBox, setScrollBox] = createSignal<ScrollBoxRenderable>();

  const followActiveRow = (box: ScrollBoxRenderable) => {
    if (box.isDestroyed) return;
    const target = nextFollowScrollTop({
      currentTop: box.scrollTop,
      activeIndex: findActiveRowIndex(props.rows),
      rowCount: props.rows.length,
      viewportHeight: box.viewport.height,
    });
    if (target === undefined) return;
    box.scrollTo(target);
  };

  const attach = (box: ScrollBoxRenderable) => {
    setScrollBox(box);
    // `scrollX` is a constructor-only option: the JSX runtime assigns props
    // instead of constructing with them, so it never takes effect. Without it
    // OpenTUI locks the content to `maxWidth: "100%"`, the content can never
    // grow wider than the viewport, and horizontal scrolling does nothing.
    // Lifting that cap is what actually enables left/right scrolling.
    box.content.maxWidth = undefined;
    // Chain, never clobber: OpenTUI installs its own `content.onSizeChange`
    // that keeps the scrollbars in sync. Overwriting it left `scrollSize`
    // stale and produced a phantom horizontal scrollbar.
    const internalOnSizeChange = box.content.onSizeChange;
    box.content.onSizeChange = () => {
      internalOnSizeChange?.call(box.content);
      followActiveRow(box);
    };
    props.ref?.(box);
  };

  // Status-only changes (e.g. a subtask flipping to `in_progress`) keep the
  // content size identical, so re-follow whenever the row set changes.
  createEffect(() => {
    void props.rows.map((row) => `${row.id}:${row.status}`).join("|");
    const box = scrollBox();
    if (box) followActiveRow(box);
  });

  const scrollbarOptions = () =>
    props.scrollbarColor
      ? {
          trackOptions: {
            backgroundColor: props.scrollbarColor,
            foregroundColor: props.scrollbarColor,
          },
        }
      : undefined;

  return (
    <scrollbox
      ref={(el: ScrollBoxRenderable) => attach(el)}
      width="100%"
      height={Math.min(props.rows.length, TODO_PANEL_MAX_ROWS)}
      verticalScrollbarOptions={scrollbarOptions()}
      horizontalScrollbarOptions={{ visible: false }}
    >
      <box flexDirection="column" flexShrink={0}>
        <For each={props.rows}>
          {(row) => (
            <box
              id={rowId(row.id)}
              flexDirection="row"
              height={1}
              flexShrink={0}
              width={rowWidth(row)}
            >
              <text wrapMode="none">
                <Show when={row.depth > 0}>
                  <span>{"  "}</span>
                </Show>
                <span style={{ fg: row.iconColor }}>{row.icon} </span>
                <span style={{ fg: row.textColor }}>{row.content}</span>
              </text>
            </box>
          )}
        </For>
      </box>
    </scrollbox>
  );
}

function TodoProgress(props: { context: Plugin.Context; sessionID: string }) {
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
        let hashedSid = "";
        try {
          if (sid) hashedSid = hashSessionID(sid);
        } catch {}

        if (
          !sid ||
          (hashedSid && nameStr.startsWith(hashedSid)) ||
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
      } catch {}
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
          <box flexDirection="row" justifyContent="space-between">
            <box
              flexDirection="row"
              flexGrow={1}
              onMouseDown={(e) => {
                if (e.button === 0) {
                  e.stopPropagation?.();
                  setIsCollapsed(!isCollapsed());
                }
              }}
            >
              <box width={2} height={1} marginRight={1}>
                {isCollapsed() ? (
                  <SvgIcon
                    source={arrowRightSvgIcon}
                    color={theme().text.muted}
                    fallback="›"
                    width={2}
                    height={1}
                  />
                ) : (
                  <SvgIcon
                    source={arrowDownSvgIcon}
                    color={theme().text.muted}
                    fallback="⌄"
                    width={2}
                    height={1}
                  />
                )}
              </box>

              <text>
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
              onMouseDown={async (e) => {
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
              }}
            >
              <SvgIcon
                color={
                  isClearHovered()
                    ? theme().text.feedback.error.base
                    : theme().text.muted
                }
                source={removeSvgIcon}
                fallback="×"
                height={1}
                width={2}
              />
            </box>
          </box>

          <Show when={!isCollapsed()}>
            <box flexDirection="column" paddingTop={1}>
              <TodoList
                rows={data().items.map((item) => ({
                  id: item.id,
                  content: item.content,
                  icon: getItemIcon(item.status, item.icon),
                  iconColor: getStatusColor(item.status),
                  textColor: getTextColor(item.status),
                  depth: item.depth,
                  status: item.status,
                }))}
                scrollbarColor={getBorderColor()}
              />
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
    const prompt = context.ui.slot({
      after: "session.composer.top",
      render: (input) => (
        <TodoProgress context={context} sessionID={input.sessionID} />
      ),
    });

    return () => {
      prompt();
    };
  },
});

import assert from "node:assert/strict";

import { testRender } from "@opentui/solid";
import { ScrollBoxRenderable } from "@opentui/core";

const { TodoList, TODO_PANEL_MAX_ROWS } = await import("../src/tui.tsx");

// ---------------------------------------------------------------------------
// Fixture: 18 display rows — 4 parents + 14 subtasks (the reported case)
// ---------------------------------------------------------------------------

const makeRows = (count: number) =>
  Array.from({ length: count }, (_, index) => ({
    id: String(index + 1),
    content: `Row ${index + 1}`,
    icon: "✔",
    iconColor: "#00ff00",
    textColor: "#ffffff",
    depth: index % 3 === 0 ? 0 : 1,
    status: "pending" as "pending" | "in_progress",
  }));

const ROWS = makeRows(18);

let captured: ScrollBoxRenderable | undefined;

const renderList = (rows: ReturnType<typeof makeRows>) => {
  captured = undefined;
  return testRender(
    () => (
      <TodoList rows={rows} ref={(el: ScrollBoxRenderable) => (captured = el)} />
    ),
    { width: 60, height: 24 },
  );
};

/** `assert.ok` cannot narrow a `let` re-assigned to undefined; this can. */
function scrollBoxOrFail(): ScrollBoxRenderable {
  const box = captured;
  assert.ok(box, "TodoList must render a scrollbox");
  return box;
}

// Short list: the panel shrinks to its content instead of padding to the max.
{
  const app = await renderList(makeRows(3));
  try {
    await app.flush();
    assert.equal(
      scrollBoxOrFail().viewport.height,
      3,
      "a short list must shrink to its content height",
    );
    console.log("✔ TodoList shrinks to content for a short list");
  } finally {
    app.renderer.destroy();
  }
}

// Long list: every row reachable, panel stays compact.
{
  const app = await renderList(ROWS);
  try {
    await app.flush();
    const scroll = scrollBoxOrFail();

    assert.equal(
      scroll.scrollHeight,
      ROWS.length,
      "all 18 rows must exist in the scroll content (no silent truncation)",
    );
    assert.ok(
      scroll.viewport.height < scroll.scrollHeight,
      "a long list must be clipped to the viewport, not grown unbounded",
    );
    assert.ok(
      scroll.viewport.height <= TODO_PANEL_MAX_ROWS,
      `the panel must stay compact (<= ${TODO_PANEL_MAX_ROWS} rows), got ${scroll.viewport.height}`,
    );

    const first = app.captureCharFrame();
    assert.ok(first.includes("Row 1"), "the first row must be visible");
    assert.ok(
      !first.includes("Row 18"),
      "the last row is off-screen until the user scrolls",
    );

    scroll.scrollTo(1_000);
    await app.flush();
    assert.ok(
      app.captureCharFrame().includes("Row 18"),
      "scrolling must reveal the last row that maxHeight used to hide",
    );

    console.log(
      `✔ TodoList scrolls ${ROWS.length} rows inside a ${scroll.viewport.height}-row viewport`,
    );
  } finally {
    app.renderer.destroy();
  }
}

// Row isolation: every row stays exactly one terminal line tall, even when a
// todo title is longer than the panel width.
{
  const rows = makeRows(6);
  rows[2].content =
    "Refactor the long-running Valorant service loader so every command keeps resolving imports";
  const app = await renderList(rows);
  try {
    await app.flush();
    const scroll = scrollBoxOrFail();
    const rowHeights = scroll.content
      .getChildren()[0]
      .getChildren()
      .map((row) => row.height);
    assert.deepEqual(
      rowHeights,
      [1, 1, 1, 1, 1, 1],
      "todo rows must use a fixed one-line container to prevent overlap",
    );
    assert.equal(
      scroll.scrollHeight,
      rows.length,
      "a long title must not consume extra rows from the list height",
    );
    console.log("✔ TodoList rows keep an isolated fixed height");
  } finally {
    app.renderer.destroy();
  }
}

// Follow: the panel must keep the in-progress row in view as the list grows.
{
  const rows = makeRows(18);
  rows[12].status = "in_progress";
  captured = undefined;
  const app = await testRender(
    () => (
      <TodoList
        rows={rows}
        ref={(el: ScrollBoxRenderable) => (captured = el)}
      />
    ),
    { width: 60, height: 24 },
  );
  try {
    await app.flush();
    const scroll = scrollBoxOrFail();
    const frame = app.captureCharFrame();

    assert.ok(
      frame.includes("Row 13"),
      "the in-progress row must be visible without manual scrolling",
    );
    assert.ok(
      scroll.scrollTop > 0,
      `the panel must have followed the active row, got scrollTop=${scroll.scrollTop}`,
    );
    console.log(
      `✔ TodoList follows the active row (scrollTop=${scroll.scrollTop})`,
    );
  } finally {
    app.renderer.destroy();
  }
}

// No active row: the panel must stay at the top.
{
  const app = await renderList(ROWS);
  try {
    await app.flush();
    assert.equal(
      scrollBoxOrFail().scrollTop,
      0,
      "without an active row the list must not auto-scroll",
    );
    console.log("✔ TodoList stays at the top when nothing is in progress");
  } finally {
    app.renderer.destroy();
  }
}

// Vertical-only: the panel must never show a horizontal scrollbar.
{
  const app = await renderList(ROWS);
  try {
    await app.flush();
    const scroll = scrollBoxOrFail();
    assert.equal(
      scroll.horizontalScrollBar.visible,
      false,
      "the panel must not render a horizontal scrollbar",
    );
    assert.ok(
      scroll.horizontalScrollBar.scrollSize <=
        scroll.horizontalScrollBar.viewportSize,
      `horizontal scroll range must stay empty, got ${scroll.horizontalScrollBar.scrollSize} > ${scroll.horizontalScrollBar.viewportSize}`,
    );
    console.log("✔ TodoList stays vertical-only (no horizontal scrollbar)");
  } finally {
    app.renderer.destroy();
  }
}

// No chrome: the panel must not draw an indicator row of its own, but the
// rows must still be horizontally scrollable.
{
  const app = await renderList(ROWS);
  try {
    await app.flush();
    const scroll = scrollBoxOrFail();

    assert.equal(
      scroll.horizontalScrollBar.visible,
      false,
      "the horizontal scrollbar must stay hidden",
    );

    // The rendered panel is only as tall as the list: no extra indicator row.
    const listHeight = scroll.viewport.height;
    assert.ok(
      listHeight <= TODO_PANEL_MAX_ROWS,
      `the panel must not grow an extra row, got ${listHeight}`,
    );
    console.log("✔ TodoList adds no extra indicator row");
  } finally {
    app.renderer.destroy();
  }
}

// Horizontal scroll: a title wider than the panel must be reachable by
// scrolling right, with no wrapping (wrapping would break row height).
{
  const wide = makeRows(4);
  wide[1].content = "X".repeat(200);
  const app = await renderList(wide);
  try {
    await app.flush();
    const scroll = scrollBoxOrFail();

    const before = scroll.scrollLeft;
    scroll.scrollTo({ x: 10_000, y: scroll.scrollTop });
    await app.flush();

    assert.ok(
      scroll.scrollLeft > before,
      `the panel must scroll horizontally, got scrollLeft=${scroll.scrollLeft}`,
    );

    const rowHeights = scroll.content
      .getChildren()[0]
      .getChildren()
      .map((row) => row.height);
    assert.deepEqual(
      rowHeights,
      [1, 1, 1, 1],
      "a wide title must not wrap into extra lines",
    );
    console.log(
      `✔ TodoList scrolls horizontally (scrollLeft=${before} -> ${scroll.scrollLeft})`,
    );
  } finally {
    app.renderer.destroy();
  }
}

console.log("\n✔ Todo panel scroll suite passed");

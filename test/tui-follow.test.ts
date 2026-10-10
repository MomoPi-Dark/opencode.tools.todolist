import assert from "node:assert/strict";

const { nextFollowScrollTop, findActiveRowIndex } = await import("../src/tui.tsx");

// No active row: never move.
assert.equal(
  nextFollowScrollTop({ currentTop: 0, activeIndex: -1, rowCount: 18, viewportHeight: 8 }),
  undefined,
  "no active row must not scroll",
);

// Active row already visible: stay put (no jitter).
assert.equal(
  nextFollowScrollTop({ currentTop: 5, activeIndex: 7, rowCount: 18, viewportHeight: 8 }),
  undefined,
  "an already-visible active row must not move the panel",
);

// Active row below the viewport: follow it.
assert.equal(
  nextFollowScrollTop({ currentTop: 0, activeIndex: 12, rowCount: 18, viewportHeight: 8 }),
  5,
  "an active row below the viewport must be revealed",
);

// Active row above the viewport: follow it back up (minimal movement).
assert.equal(
  nextFollowScrollTop({ currentTop: 8, activeIndex: 2, rowCount: 18, viewportHeight: 8 }),
  2,
  "an active row above the viewport must be revealed with minimal movement",
);

// Never scroll past the end.
assert.equal(
  nextFollowScrollTop({ currentTop: 0, activeIndex: 17, rowCount: 18, viewportHeight: 8 }),
  10,
  "the last row must clamp to the maximum scroll offset",
);

// A short list that fits entirely never scrolls.
assert.equal(
  nextFollowScrollTop({ currentTop: 0, activeIndex: 2, rowCount: 3, viewportHeight: 8 }),
  undefined,
  "a list that fits must never scroll",
);

// Boundary: active row is the last visible row -> already visible.
assert.equal(
  nextFollowScrollTop({ currentTop: 0, activeIndex: 7, rowCount: 18, viewportHeight: 8 }),
  undefined,
  "the last visible row counts as visible",
);

// Stale/oversized index: clamp to the real end of the list.
assert.equal(
  nextFollowScrollTop({ currentTop: 0, activeIndex: 17, rowCount: 10, viewportHeight: 8 }),
  2,
  "an out-of-range active index must clamp to the maximum scroll offset",
);

// ---------------------------------------------------------------------------
// findActiveRowIndex: the LAST in-progress row wins (deepest = most current).
// ---------------------------------------------------------------------------

const statuses = (list: string[]) => list.map((status) => ({ status })) as never;

assert.equal(
  findActiveRowIndex(statuses(["completed", "in_progress", "pending", "in_progress"])),
  3,
  "the last in-progress row is the one currently executing",
);
assert.equal(
  findActiveRowIndex(statuses(["completed", "pending"])),
  -1,
  "no in-progress row yields -1",
);

console.log("✔ nextFollowScrollTop: follow, clamp, already-visible, and no-active cases");
console.log("✔ findActiveRowIndex: last in-progress wins, -1 when none");
console.log("\n✔ Todo follow logic suite passed");

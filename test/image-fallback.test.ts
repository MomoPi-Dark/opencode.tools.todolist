import assert from "node:assert/strict";

const { supportsImageRendering } = await import("../src/icons/capabilities.ts");

assert.equal(
  supportsImageRendering(null),
  false,
  "unknown terminal capabilities must use the direct icon",
);
assert.equal(
  supportsImageRendering({ kitty_graphics: false, sixel: false }),
  false,
  "terminals without Kitty or Sixel must use the direct icon",
);
assert.equal(
  supportsImageRendering({ kitty_graphics: true, sixel: false }),
  true,
  "Kitty graphics terminals may use the image icon",
);
assert.equal(
  supportsImageRendering({ kitty_graphics: false, sixel: true }),
  true,
  "Sixel terminals may use the image icon",
);

console.log("✔ Image capability fallback verified");

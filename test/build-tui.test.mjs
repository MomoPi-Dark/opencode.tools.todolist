import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(
  readFileSync(resolve(root, "package.json"), "utf8"),
);
const result = spawnSync("bun", ["scripts/build-tsx.mjs"], {
  cwd: root,
  encoding: "utf8",
});

assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);

const bundlePath = resolve(root, "tui.js");
const serverPath = resolve(root, "index.js");
assert.equal(manifest.main, "index.js");
assert.equal(manifest.exports["."], "./index.js");
assert.equal(manifest.exports["./tui"], "./tui.js");
assert.equal(manifest.scripts?.prepare, undefined);
const server = await import(
  `${pathToFileURL(serverPath).href}?test=${Date.now()}`
);
assert.equal(server.default.id, "opencode.tools.modern.todos");

const bundle = readFileSync(bundlePath, "utf8");
assert.doesNotMatch(bundle, /from\s+["']react(?:\/[^"']*)?["']/);

const plugin = await import(
  `${pathToFileURL(bundlePath).href}?test=${Date.now()}`
);
assert.equal(plugin.default.id, "opencode.tools.modern.todos.tui");
assert.equal(typeof plugin.default.setup, "function");

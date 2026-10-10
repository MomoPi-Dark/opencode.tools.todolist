import { transformAsync } from "@babel/core";
import { build } from "esbuild";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const resolve = (p) => fileURLToPath(new URL(p, import.meta.url));

/** Setara dengan @opentui/solid/bun-plugin, tapi untuk esbuild. */
const solidPlugin = {
  name: "opentui-solid",
  setup(b) {
    b.onLoad({ filter: /\.[jt]sx$/ }, async ({ path }) => {
      const source = await readFile(path, "utf8");
      const result = await transformAsync(source, {
        filename: path,
        sourceMaps: "inline",
        presets: [
          [
            "babel-preset-solid",
            { moduleName: "@opentui/solid", generate: "universal" },
          ],
          ["@babel/preset-typescript", { isTSX: true, allExtensions: true }],
        ],
      });
      return { contents: result.code, loader: "js" };
    });
  },
};

const builds = [
  { entrypoint: "../src/index.ts", output: "index.js", plugins: [] },
  {
    entrypoint: "../src/tui.tsx",
    output: "tui.js",
    plugins: [solidPlugin],
  },
];

for (const { entrypoint, output, plugins } of builds) {
  await build({
    entryPoints: [resolve(entrypoint)],
    outfile: `${root}/${output}`,
    bundle: true,
    platform: "node",
    format: "esm",
    packages: "external",
    plugins,
    logLevel: "info",
  });
}

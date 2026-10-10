import solidPlugin from "@opentui/solid/bun-plugin";
import { fileURLToPath } from "node:url";

const outdir = fileURLToPath(new URL("../dist", import.meta.url));
const builds = [
  { entrypoint: "../src/tool.ts", output: "index.js", plugins: [] },
  {
    entrypoint: "../src/todolist.tsx",
    output: "tui.js",
    plugins: [solidPlugin],
  },
];

for (const { entrypoint, output, plugins } of builds) {
  const result = await Bun.build({
    entrypoints: [fileURLToPath(new URL(entrypoint, import.meta.url))],
    outdir,
    naming: { entry: output },
    target: "bun",
    format: "esm",
    packages: "external",
    plugins,
  });

  if (!result.success) {
    throw new Error(result.logs.map((log) => log.message).join("\n"));
  }
}

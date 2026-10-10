import { readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const opentui = import.meta.resolve("@opentui/solid");
const transform = new URL("./scripts/solid-transform.js", opentui);

const { transformSolidSource } = await import(transform);

for (const name of ["tui", "icons/convert"]) {
  const source = resolve(root, `dist/${name}.jsx`);
  const output = resolve(root, `dist/${name}.js`);
  const code = await readFile(source, "utf8");

  await writeFile(output, await transformSolidSource(code, { filename: source }));
  await Promise.all([
    rm(source, { force: true }),
    rm(`${source}.map`, { force: true }),
    rm(`${output}.map`, { force: true }),
  ]);
}

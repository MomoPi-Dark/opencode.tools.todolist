import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const {
  getSkillsDirectory,
  parseSkillFile,
  parseSkillMarkdown,
  readSkills,
  registerTodoSkills,
} = await import("../src/skill.ts");

// ---------------------------------------------------------------------------
// parseSkillMarkdown
// ---------------------------------------------------------------------------

const rich = [
  "---",
  "name: todolist",
  "description: Track multi-step tasks via manage_todo_list.",
  "---",
  "",
  "# Todolist",
  "",
  "Body line.",
  "",
].join("\n");

const parsed = parseSkillMarkdown(rich);
assert.equal(parsed.name, "todolist", "frontmatter name must be parsed");
assert.equal(
  parsed.description,
  "Track multi-step tasks via manage_todo_list.",
  "frontmatter description must be parsed",
);
assert.equal(
  parsed.body,
  "# Todolist\n\nBody line.",
  "body must contain only the markdown after the frontmatter",
);
assert.ok(!parsed.body.includes("---"), "body must not leak frontmatter");

const quoted = parseSkillMarkdown('---\nname: "todos"\n---\nbody');
assert.equal(quoted.name, "todos", "surrounding quotes must be stripped");

const noFrontmatter = parseSkillMarkdown("# Just markdown");
assert.equal(noFrontmatter.name, undefined, "missing frontmatter has no name");
assert.equal(
  noFrontmatter.body,
  "# Just markdown",
  "missing frontmatter keeps the whole file as the body",
);

const blankValue = parseSkillMarkdown("---\nname:\ndescription: kept\n---\nx");
assert.equal(blankValue.name, undefined, "empty frontmatter value is ignored");
assert.equal(blankValue.description, "kept", "non-empty sibling is kept");

console.log("✔ parseSkillMarkdown: frontmatter, quotes, and no-frontmatter cases");

// ---------------------------------------------------------------------------
// parseSkillFile
// ---------------------------------------------------------------------------

const sandbox = mkdtempSync(join(tmpdir(), "opencode-skill-test-"));

try {
  const flatDir = join(sandbox, "flat");
  mkdirSync(flatDir, { recursive: true });
  writeFileSync(join(flatDir, "todos.md"), rich);

  const bundledDir = join(sandbox, "bundled");
  mkdirSync(join(bundledDir, "todos"), { recursive: true });
  writeFileSync(join(bundledDir, "todos", "SKILL.md"), rich);

  const emptyDir = join(sandbox, "empty");
  mkdirSync(emptyDir, { recursive: true });

  const orphanDir = join(sandbox, "orphans");
  mkdirSync(join(orphanDir, "broken"), { recursive: true });
  writeFileSync(join(orphanDir, "broken", "README.md"), "not a skill");
  writeFileSync(join(orphanDir, "loose.txt"), "not markdown");

  assert.equal(
    parseSkillFile(join(flatDir, "todos.md"))?.name,
    "todolist",
    "parseSkillFile reads an existing file",
  );
  assert.equal(
    parseSkillFile(join(flatDir, "missing.md")),
    null,
    "parseSkillFile returns null for a missing file",
  );

  console.log("✔ parseSkillFile: reads files and returns null when unreadable");

  // -------------------------------------------------------------------------
  // readSkills — both supported layouts
  // -------------------------------------------------------------------------

  const flat = readSkills(flatDir);
  assert.equal(flat.length, 1, "flat layout must yield one skill");
  assert.deepEqual(
    {
      id: flat[0].id,
      name: flat[0].name,
      path: flat[0].path.split("/").slice(-1)[0],
      hasDescription: typeof flat[0].description === "string",
      body: flat[0].content,
    },
    {
      id: "todos",
      name: "todolist",
      path: "todos.md",
      hasDescription: true,
      body: "# Todolist\n\nBody line.",
    },
    "flat skills/<id>.md must map to the right skill shape",
  );

  const bundled = readSkills(bundledDir);
  assert.equal(bundled.length, 1, "directory layout must yield one skill");
  assert.equal(bundled[0].id, "todos", "directory id comes from folder name");
  assert.equal(bundled[0].name, "todolist", "directory name comes from frontmatter");
  assert.ok(
    bundled[0].path.endsWith("todos/SKILL.md"),
    "directory layout must resolve <id>/SKILL.md",
  );

  assert.deepEqual(readSkills(emptyDir), [], "empty directory yields no skills");
  assert.deepEqual(
    readSkills(join(sandbox, "does-not-exist")),
    [],
    "a missing directory is tolerated and yields no skills",
  );
  assert.deepEqual(
    readSkills(orphanDir),
    [],
    "directories without SKILL.md and non-markdown files are skipped",
  );

  console.log("✔ readSkills: flat + bundled layouts, labels, and skip rules");

  // -------------------------------------------------------------------------
  // Bundled skill actually ships with the plugin
  // -------------------------------------------------------------------------

  const skillsDir = getSkillsDirectory();
  assert.ok(
    skillsDir.endsWith("skills"),
    `skills directory must be the bundled one, got ${skillsDir}`,
  );

  const shipped = readSkills();
  const todos = shipped.find((skill) => skill.id === "todos");
  assert.ok(todos, "the plugin must ship a 'todos' skill");
  assert.equal(todos.name, "todolist", "the shipped skill keeps its name");
  assert.ok(
    todos.content.includes("manage_todo_list"),
    "the shipped todolist skill must document manage_todo_list",
  );
  assert.ok(
    !todos.content.startsWith("---"),
    "a registered skill body must not include the frontmatter block",
  );

  console.log("✔ bundled skills/: the 'todos' skill is present and parsed");

  // -------------------------------------------------------------------------
  // registerTodoSkills — hands skills to the plugin API
  // -------------------------------------------------------------------------

  const added: Array<{ id: string; name: string; autoinvoke?: boolean; content: string }> = [];
  const ctx = {
    skill: {
      transform: async (callback: (editor: unknown) => void) => {
        callback({ add: (skill: (typeof added)[number]) => added.push(skill) });
      },
    },
  };

  await registerTodoSkills(ctx as never);

  assert.equal(added.length, 1, "exactly one skill must be registered");
  assert.equal(added[0].id, "todos", "the registered skill id is 'todos'");
  assert.equal(added[0].name, "todolist", "the registered skill name is 'todolist'");
  assert.equal(added[0].autoinvoke, true, "the skill must be auto-invokable");
  assert.ok(
    added[0].content.includes("manage_todo_list"),
    "registered content must reach the model",
  );

  console.log("✔ registerTodoSkills: forwards the parsed skill to ctx.skill.add");

  // The transform must be invoked exactly once per registration pass.
  let transformCalls = 0;
  await registerTodoSkills({
    skill: {
      transform: async (callback: (editor: unknown) => void) => {
        transformCalls += 1;
        callback({ add: () => {} });
      },
    },
  } as never);
  assert.equal(transformCalls, 1, "ctx.skill.transform is called exactly once");

  console.log("✔ registerTodoSkills: invokes ctx.skill.transform once");
} finally {
  rmSync(sandbox, { recursive: true, force: true });
}

console.log("\n✔ Skill loader suite passed");

import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { TodoItem } from "../src/todo";

const sandboxDir = mkdtempSync(join(tmpdir(), "opencode-todo-test-"));
process.env.OPENCODE_TODOS_DIR = sandboxDir;

const { getTodoFilePath, readTodos, writeTodos } = await import("../src/store");

assert.ok(
  getTodoFilePath("guard_probe").startsWith(sandboxDir),
  `KRITIS: Path store di luar sandbox! Target: ${getTodoFilePath("guard_probe")}, Sandbox: ${sandboxDir}`,
);

const { getTodoDisplaySummary } = await import("../src/display");
const { buildTodosFromInput, formatReadOutput, manageTodoListSchema } =
  await import("../src/tool");
const { validateAndNormalizeTodos } = await import("../src/todo");

const TEST_SESSION = "test_todolist_session";

function cleanupSandbox() {
  rmSync(sandboxDir, { recursive: true, force: true });
}

async function runSuite() {
  console.log(`[PASS GUARD] Sandbox terisolasi di: ${sandboxDir}\n`);

  {
    const input = buildTodosFromInput([
      { title: "Task 1", status: "not-started" },
      { title: "Task 2", status: "not-started" },
      { title: "Task 3", status: "not-started" },
    ]);
    await writeTodos(TEST_SESSION, input);
    const result = await readTodos(TEST_SESSION);
    assert.equal(result.length, 3);
    assert.ok(result.every((t) => t.status === "pending"));
    console.log("✔ Skenario 1: 3 item not-started tersimpan sebagai pending");
  }

  {
    const input = buildTodosFromInput([
      { title: "Task A", status: "in-progress" },
      { title: "Task B", status: "in_progress" },
    ]);
    assert.equal(input[0].status, "in_progress");
    assert.equal(input[1].status, "in_progress");
    console.log("✔ Skenario 2: Status 'in-progress' dinormalisasi ke 'in_progress'");
  }

  {
    const invalid: TodoItem[] = [
      { id: "1", content: "Task 1", status: "in_progress" },
      { id: "2", content: "Task 2", status: "in_progress" },
    ];
    const check = validateAndNormalizeTodos(invalid);
    assert.equal(check.valid, false);
    assert.match((check as any).error, /Only 1 top-level task/);
    console.log("✔ Skenario 3: Dua parent in_progress ditolak");
  }

  {
    const valid: TodoItem[] = [
      {
        id: "1",
        content: "Parent 1",
        status: "in_progress",
        children: [
          { id: "1.1", content: "Child 1", status: "in_progress" },
          { id: "1.2", content: "Child 2", status: "pending" },
        ],
      },
    ];
    const check = validateAndNormalizeTodos(valid);
    assert.equal(check.valid, true);
    console.log("✔ Skenario 4: Parent in_progress + 1 child in_progress lolos");
  }

  {
    const invalid: TodoItem[] = [
      {
        id: "1",
        content: "Parent 1",
        status: "pending",
        children: [{ id: "1.1", content: "Child 1", status: "in_progress" }],
      },
    ];
    const check = validateAndNormalizeTodos(invalid);
    assert.equal(check.valid, false);
    assert.match((check as any).error, /Set parent to 'in_progress'/);
    console.log("✔ Skenario 5: Parent pending dengan child in_progress ditolak");
  }

  {
    const invalid: TodoItem[] = [
      {
        id: "1",
        content: "Parent 1",
        status: "cancelled",
        children: [{ id: "1.1", content: "Child 1", status: "in_progress" }],
      },
    ];
    const check = validateAndNormalizeTodos(invalid);
    assert.equal(check.valid, false);
    assert.match((check as any).error, /is 'cancelled'/);
    console.log("✔ Skenario 5b: Parent cancelled dengan child in_progress ditolak");
  }

  {
    const invalid: TodoItem[] = [
      {
        id: "1",
        content: "Parent 1",
        status: "in_progress",
        children: [
          { id: "1.1", content: "Child 1", status: "in_progress" },
          { id: "1.2", content: "Child 2", status: "in_progress" },
        ],
      },
    ];
    const check = validateAndNormalizeTodos(invalid);
    assert.equal(check.valid, false);
    assert.match((check as any).error, /has 2 subtasks 'in_progress'/);
    console.log("✔ Skenario 6: Dua child in_progress di satu parent ditolak");
  }

  {
    await writeTodos(TEST_SESSION, []);
    const result = await readTodos(TEST_SESSION);
    assert.equal(result.length, 0);
    const summary = getTodoDisplaySummary(result);
    assert.equal(summary, null);
    console.log("✔ Skenario 7: write [] mengosongkan store dan getTodoDisplaySummary return null");
  }

  {
    const output = formatReadOutput([]);
    assert.equal(output, "No todos recorded.");
    console.log("✔ Skenario 8: formatReadOutput([]) mengembalikan 'No todos recorded.'");
  }

  {
    const formatted = buildTodosFromInput([
      {
        status: "not-started",
        children: [{ status: "not-started" }],
      },
    ]);
    assert.equal(formatted[0].id, "1");
    assert.equal(formatted[0].content, "Task 1");
    assert.equal(formatted[0].children?.[0].id, "1.1");
    assert.equal(formatted[0].children?.[0].content, "Subtask 1");
    console.log("✔ Skenario 9: ID berurutan dan fallback content terverifikasi");
  }

  {
    const duplicate: TodoItem[] = [
      { id: "1", content: "A", status: "pending" },
      { id: "1", content: "B", status: "pending" },
    ];
    const check = validateAndNormalizeTodos(duplicate);
    assert.equal(check.valid, false);
    assert.match((check as any).error, /Duplicate ID/);
    console.log("✔ Skenario 10: ID duplikat ditolak oleh validator");
  }

  {
    const filePath = getTodoFilePath(TEST_SESSION);
    writeFileSync(filePath, "{ corrupt json", "utf8");

    const recovered = buildTodosFromInput([{ title: "Recovered Task", status: "not-started" }]);
    await writeTodos(TEST_SESSION, recovered);

    const check = await readTodos(TEST_SESSION);
    assert.equal(check.length, 1);
    assert.equal(check[0].content, "Recovered Task");
    console.log("✔ Skenario 11: write berhasil mengarsipkan file korup dan menulis data baru");
  }

  {
    const items: TodoItem[] = [
      {
        id: "1",
        content: "Parent 2",
        status: "cancelled",
        children: [
          { id: "1.1", content: "Subtask 2.1", status: "completed" },
          { id: "1.2", content: "Subtask 2.2", status: "completed" },
        ],
      },
    ];
    const check = validateAndNormalizeTodos(items);
    assert.ok(check.valid);
    if (check.valid) {
      assert.equal(check.data[0].status, "completed");
    }
    console.log("✔ Skenario 12: Parent dengan semua child completed otomatis menjadi 'completed'");
  }

  {
    const session = "io_error_session";
    const sessionDir = join(sandboxDir, session);
    mkdirSync(sessionDir, { recursive: true });
    const p = join(sessionDir, "todos-1.json");
    mkdirSync(p);
    await assert.rejects(
      () => writeTodos(session, buildTodosFromInput([{ title: "x" }])),
      /unable to read todo storage/,
    );
    assert.ok(statSync(p).isDirectory());
    rmSync(p, { recursive: true });
    console.log("✔ Skenario 13: Error I/O (EISDIR) melempar error dan tidak menimpa data");
  }

  {
    const session = "migration_rule_session";
    const sessionDir = join(sandboxDir, session);
    mkdirSync(sessionDir, { recursive: true });
    const p = join(sessionDir, "todos-1.json");
    writeFileSync(
      p,
      JSON.stringify({
        version: 1,
        updatedAt: "x",
        todos: [
          {
            id: "1",
            content: "P",
            status: "pending",
            children: [{ id: "1.1", content: "C", status: "in_progress" }],
          },
        ],
      }),
    );
    const legacy = await readTodos(session);
    assert.equal(legacy[0].children?.[0].status, "in_progress");

    await writeTodos(session, buildTodosFromInput([{ title: "Baru" }]));
    assert.ok(
      !readdirSync(sessionDir).some((f) => f.startsWith("todos-1.json.corrupt-")),
      "file yang hanya melanggar aturan tidak boleh diarsipkan",
    );
    assert.equal((await readTodos(session))[0].content, "Baru");
    console.log("✔ Skenario 14a: File bentuk valid tapi langgar aturan tetap terbaca dan ditimpa tanpa arsip");
  }

  {
    const session = "migration_shape_session";
    const sessionDir = join(sandboxDir, session);
    mkdirSync(sessionDir, { recursive: true });
    const p = join(sessionDir, "todos-1.json");
    writeFileSync(
      p,
      JSON.stringify({ version: 1, updatedAt: "x", todos: { notAnArray: true } }),
    );
    await writeTodos(session, buildTodosFromInput([{ title: "Baru" }]));

    const archived = readdirSync(sessionDir).some((f) =>
      f.startsWith("todos-1.json.corrupt-"),
    );
    assert.ok(archived, "File bentuk rusak harus terbukti diarsipkan di disk");

    const check = await readTodos(session);
    assert.equal(check[0].content, "Baru");
    console.log("✔ Skenario 14b: File bentuk rusak diarsipkan dan ditimpa data baru");
  }

  {
    const parsed = manageTodoListSchema.safeParse({ operation: "write" });
    assert.ok(parsed.success);
    assert.deepEqual(parsed.data.todos, []);
    console.log("✔ Skenario 15: write tanpa field todos sukses dengan default []");
  }

  {
    const tuiSource = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "../src/todolist.tsx"),
      "utf8",
    );
    assert.match(
      tuiSource,
      /<For each=\{data\(\)\.items\}>[\s\S]*?<box flexDirection="row" height=\{1\}>[\s\S]*?<\/box>\s*\)\}\s*<\/For>/,
      "todo rows must use a fixed-height row container to prevent overlap",
    );
    console.log("✔ Skenario 16: Baris TUI memiliki layout row terisolasi");
  }

  {
    const inputWithNotes = buildTodosFromInput([
      {
        id: "1",
        title: "Setup database",
        note: "PostgreSQL 16 connection pooling",
        children: [
          {
            id: "1.1",
            title: "Run migrations",
            note: "Prisma schema v2",
          },
        ],
      },
    ]);

    assert.equal(inputWithNotes[0].note, "PostgreSQL 16 connection pooling");
    assert.equal(inputWithNotes[0].children?.[0].note, "Prisma schema v2");

    const rendered = formatReadOutput(inputWithNotes);
    assert.ok(
      rendered.includes("    ↳ note: PostgreSQL 16 connection pooling"),
      "Output render harus memuat note parent dengan anak panah ↳",
    );
    assert.ok(
      rendered.includes("        ↳ note: Prisma schema v2"),
      "Output render harus memuat note subtask dengan anak panah ↳",
    );
    console.log("✔ Skenario 17: Field note terintegrasi pada input, model, dan tree render dengan anak panah");
  }

  cleanupSandbox();
}

runSuite().catch((err) => {
  cleanupSandbox();
  console.error("\nTEST SUITE GAGAL:", err);
  process.exit(1);
});

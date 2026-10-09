import assert from "node:assert/strict";
import {
  existsSync,
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

const {
  getTodoFilePath,
  getTodosDirectory,
  hashSessionID,
  readTodos,
  writeTodos,
  resolveConfigHome,
  resolveHomeDir,
  resolveTodosBaseDir,
} = await import("../src/store");

assert.ok(
  getTodoFilePath("guard_probe").startsWith(sandboxDir),
  `CRITICAL: Store path is outside sandbox! Target: ${getTodoFilePath("guard_probe")}, Sandbox: ${sandboxDir}`,
);

const { getTodoDisplaySummary } = await import("../src/display");
const { buildTodosFromInput, formatReadOutput, manageTodoListSchema, registerTodoPromptHook } =
  await import("../src/tool");
const { consumeTodoHint, TODO_HINT } = await import("../src/hint");
const { readTodoData } = await import("../src/store");
const { validateAndNormalizeTodos } = await import("../src/todo");

const TEST_SESSION = "test_todolist_session";

function cleanupSandbox() {
  rmSync(sandboxDir, { recursive: true, force: true });
}

async function runSuite() {
  console.log(`[PASS GUARD] Sandbox isolated at: ${sandboxDir}\n`);

  {
    const input = buildTodosFromInput([
      { title: "Task 1" },
      { title: "Task 2", status: "pending" },
      { title: "Task 3" },
    ]);
    await writeTodos(TEST_SESSION, input);
    const result = await readTodos(TEST_SESSION);
    assert.equal(result.length, 3);
    assert.ok(result.every((t) => t.status === "pending"));
    console.log("✔ Scenario 1: Items without status default to pending");
  }

  {
    const input = buildTodosFromInput([
      { title: "Task A", status: "in_progress" },
      { title: "Task B", status: "pending" },
    ]);
    assert.equal(input[0].status, "in_progress");
    assert.equal(input[1].status, "pending");
    console.log("✔ Scenario 2: Status 'in_progress' and 'pending' are valid");
  }

  {
    const invalid: TodoItem[] = [
      { id: "1", content: "Task 1", status: "in_progress" },
      { id: "2", content: "Task 2", status: "in_progress" },
    ];
    const check = validateAndNormalizeTodos(invalid);
    assert.equal(check.valid, false);
    assert.match((check as any).error, /Only 1 top-level task/);
    console.log("✔ Scenario 3: Two top-level in_progress tasks are rejected");
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
    console.log("✔ Scenario 4: Parent in_progress + 1 child in_progress passes");
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
    console.log("✔ Scenario 5: Pending parent with child in_progress is rejected");
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
    console.log("✔ Scenario 5b: Cancelled parent with child in_progress is rejected");
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
    console.log("✔ Scenario 6: Two in_progress children in one parent are rejected");
  }

  {
    await writeTodos(TEST_SESSION, []);
    const result = await readTodos(TEST_SESSION);
    assert.equal(result.length, 0);
    const summary = getTodoDisplaySummary(result);
    assert.equal(summary, null);
    console.log("✔ Scenario 7: write [] clears store and getTodoDisplaySummary returns null");
  }

  {
    const output = formatReadOutput([]);
    assert.equal(output, "No todos recorded.");
    console.log("✔ Scenario 8: formatReadOutput([]) returns 'No todos recorded.'");
  }

  {
    const formatted = buildTodosFromInput([
      {
        children: [{}],
      },
    ]);
    assert.equal(formatted[0].id, "1");
    assert.equal(formatted[0].content, "Task 1");
    assert.equal(formatted[0].status, "pending");
    assert.equal(formatted[0].children?.[0].id, "1.1");
    assert.equal(formatted[0].children?.[0].content, "Subtask 1");
    assert.equal(formatted[0].children?.[0].status, "pending");
    console.log("✔ Scenario 9: Sequential IDs, default pending, and fallback content verified");
  }

  {
    const duplicate: TodoItem[] = [
      { id: "1", content: "A", status: "pending" },
      { id: "1", content: "B", status: "pending" },
    ];
    const check = validateAndNormalizeTodos(duplicate);
    assert.equal(check.valid, false);
    assert.match((check as any).error, /Duplicate ID/);
    console.log("✔ Scenario 10: Duplicate IDs are rejected by validator");
  }

  {
    const filePath = getTodoFilePath(TEST_SESSION);
    writeFileSync(filePath, "{ corrupt json", "utf8");

    const recovered = buildTodosFromInput([{ title: "Recovered Task" }]);
    await writeTodos(TEST_SESSION, recovered);

    const check = await readTodos(TEST_SESSION);
    assert.equal(check.length, 1);
    assert.equal(check[0].content, "Recovered Task");
    assert.equal(check[0].status, "pending");
    console.log("✔ Scenario 11: write archives corrupt file and stores new valid data");
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
    console.log("✔ Scenario 12: Parent with all completed children automatically completes");
  }

  {
    const session = "io_error_session";
    const sessionDir = getTodosDirectory(session);
    mkdirSync(sessionDir, { recursive: true });
    const p = join(sessionDir, "todos-1.json");
    mkdirSync(p);
    await assert.rejects(
      () => writeTodos(session, buildTodosFromInput([{ title: "x" }])),
      /unable to read todo storage/,
    );
    assert.ok(statSync(p).isDirectory());
    rmSync(p, { recursive: true });
    console.log("✔ Scenario 13: I/O error (EISDIR) throws cleanly without overwriting");
  }

  {
    const session = "migration_rule_session";
    const sessionDir = getTodosDirectory(session);
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
      "files that only violate rules must not be marked corrupt",
    );
    assert.equal((await readTodos(session))[0].content, "Baru");
    console.log("✔ Scenario 14a: Valid JSON violating rules is overwritten cleanly without corruption archive");
  }

  {
    const session = "migration_shape_session";
    const sessionDir = getTodosDirectory(session);
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
    assert.ok(archived, "Malformed JSON must be archived on disk");

    const check = await readTodos(session);
    assert.equal(check[0].content, "Baru");
    console.log("✔ Scenario 14b: Malformed file is archived and replaced with new data");
  }

  {
    const parsed = manageTodoListSchema.safeParse({ operation: "write" });
    assert.ok(parsed.success);
    assert.deepEqual(parsed.data.todos, []);
    console.log("✔ Scenario 15: write without todos field defaults to []");
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
    console.log("✔ Scenario 16: TUI rows have isolated layout row structure");
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
      "Render output must include parent note with branch arrow ↳",
    );
    assert.ok(
      rendered.includes("        ↳ note: Prisma schema v2"),
      "Render output must include subtask note with branch arrow ↳",
    );
    console.log("✔ Scenario 17: Note field integrated across input, model, and tree rendering with branch arrow");
  }

  {
    // Scenario 18a: Non-existent session -> undefined
    const hintEmpty = consumeTodoHint("non_existent_session");
    assert.equal(hintEmpty, undefined);

    // Scenario 18b: Active todos session -> static hint
    const activeSession = "active_hint_session";
    await writeTodos(
      activeSession,
      buildTodosFromInput([
        { id: "1", title: "Task 1", status: "completed" },
        { id: "2", title: "Task 2", status: "in_progress" },
        { id: "3", title: "Task 3", status: "pending" },
      ]),
    );
    const hintActive = consumeTodoHint(activeSession);
    assert.equal(hintActive, TODO_HINT);
    assert.ok(hintActive?.includes("manage_todo_list [read]"));
    assert.ok(!/\d+\/\d+/.test(hintActive ?? ""), "hint must not contain dynamic counter numbers");

    // Scenario 18c: Dedupe -> second turn without state changes returns undefined
    const hintRepeat = consumeTodoHint(activeSession);
    assert.equal(hintRepeat, undefined, "same state version must not trigger duplicate hints");

    // Scenario 18d: State change -> version bump -> hint triggers once again
    const dataBefore = readTodoData(activeSession);
    await writeTodos(
      activeSession,
      buildTodosFromInput([
        { id: "1", title: "Task 1", status: "completed" },
        { id: "2", title: "Task 2", status: "completed" },
        { id: "3", title: "Task 3", status: "in_progress" },
      ]),
    );
    const dataAfter = readTodoData(activeSession);
    assert.ok(
      (dataAfter?.version ?? 0) > (dataBefore?.version ?? 0),
      "version must increment after write",
    );
    const hintAfterChange = consumeTodoHint(activeSession);
    assert.equal(hintAfterChange, TODO_HINT);
    assert.equal(
      consumeTodoHint(activeSession),
      undefined,
      "hint must only be consumed once per version",
    );

    // Scenario 18e: All finished session -> undefined (0 token overhead)
    const doneSession = "done_hint_session";
    await writeTodos(
      doneSession,
      buildTodosFromInput([
        { id: "1", title: "Task 1", status: "completed" },
        { id: "2", title: "Task 2", status: "cancelled" },
      ]),
    );
    const hintDone = consumeTodoHint(doneSession);
    assert.equal(hintDone, undefined);

    // Scenario 18f: Stale timer (> 30 mins) -> undefined
    const changedSession = "stale_hint_session";
    await writeTodos(
      changedSession,
      buildTodosFromInput([{ id: "1", title: "Task 1", status: "pending" }]),
    );
    const staleTime = Date.now() + 31 * 60 * 1000;
    const hintStale = consumeTodoHint(changedSession, { now: staleTime });
    assert.equal(hintStale, undefined);

    // Scenario 18g: Preferred hook path: 'context' (ephemeral SystemPart, zero TUI leak)
    let contextHookCb: ((ctx: any) => Promise<void>) | undefined;
    const fakeContextCtx = {
      session: {
        hook: async (name: string, cb: any) => {
          if (name === "context") contextHookCb = cb;
        },
      },
    } as any;

    await registerTodoPromptHook(fakeContextCtx);
    assert.ok(typeof contextHookCb === "function", "Context hook must be registered");

    const hookSession = "hook_hint_session";
    await writeTodos(
      hookSession,
      buildTodosFromInput([{ id: "1", title: "Task 1", status: "in_progress" }]),
    );

    const contextPayload = {
      sessionID: hookSession,
      system: [{ type: "text", text: "Original system instruction" }],
      prompt: { text: "User prompt text" },
    };
    await contextHookCb!(contextPayload);
    assert.equal(contextPayload.prompt.text, "User prompt text", "prompt.text must NOT be touched by context hook");
    assert.equal(contextPayload.system.length, 2);
    assert.deepEqual(contextPayload.system[1], { type: "text", text: TODO_HINT });

    // Second request with same version: must not duplicate
    const secondContextPayload = {
      sessionID: hookSession,
      system: [{ type: "text", text: "Original system instruction" }],
      prompt: { text: "Turn 2" },
    };
    await contextHookCb!(secondContextPayload);
    assert.equal(secondContextPayload.system.length, 1, "Dedupe must be active in context hook");

    // Scenario 18h: Fallback path to 'prompt' if host does not support 'context'
    let promptHookCb: ((sp: any) => Promise<void>) | undefined;
    const fakeFallbackCtx = {
      session: {
        hook: async (name: string, cb: any) => {
          if (name === "context") throw new Error("Unsupported hook context");
          if (name === "prompt") promptHookCb = cb;
        },
      },
    } as any;

    await registerTodoPromptHook(fakeFallbackCtx);
    assert.ok(typeof promptHookCb === "function", "Fallback prompt hook must register when context fails");

    const fallbackSession = "hook_fallback_session";
    await writeTodos(
      fallbackSession,
      buildTodosFromInput([{ id: "1", title: "Fallback 1", status: "in_progress" }]),
    );

    const fallbackPromptPayload = {
      sessionID: fallbackSession,
      prompt: { text: "Hello there" },
    };
    await promptHookCb!(fallbackPromptPayload);
    assert.ok(fallbackPromptPayload.prompt.text.includes(`Hello there\n\n${TODO_HINT}`));

    // Second turn on fallback: dedupe prevents re-injection
    const secondFallbackPayload = {
      sessionID: fallbackSession,
      prompt: { text: "Next turn" },
    };
    await promptHookCb!(secondFallbackPayload);
    assert.equal(secondFallbackPayload.prompt.text, "Next turn");

    // Empty or whitespace-only prompt: must skip to avoid ghost messages
    const emptyPayload = {
      sessionID: fallbackSession,
      prompt: { text: "   " },
    };
    await promptHookCb!(emptyPayload);
    assert.equal(emptyPayload.prompt.text, "   ");

    console.log("✔ Scenario 18: Ephemeral context injection (zero TUI leak), fallback prompt, and dedupe verified");
  }

  {
    // Scenario 19: Anonymized/Hashed session directory on disk
    const secretSession = "ses_ee0a685c9ffer3Sx3vzq5ORWw9";
    await writeTodos(
      secretSession,
      buildTodosFromInput([{ id: "1", title: "Secret task", status: "pending" }]),
    );

    const hashedName = hashSessionID(secretSession);
    assert.match(hashedName, /^s_[a-f0-9]{32}$/, "Hash must match s_<32-hex>");

    // Ensure raw sessionID directory does NOT exist on disk
    const rawDir = join(sandboxDir, secretSession);
    assert.equal(existsSync(rawDir), false, "Raw sessionID directory must not exist on disk");

    // Ensure hashed directory exists
    const hashedDir = join(sandboxDir, hashedName);
    assert.equal(existsSync(hashedDir), true, "Hashed sessionID directory must exist on disk");

    // Verify data reads back accurately
    const readBack = await readTodos(secretSession);
    assert.equal(readBack[0].content, "Secret task");

    // Scenario 20: Backward compatibility & Auto-migration
    const legacySession = "ses_legacy_unmigrated_123";
    const legacyDir = join(sandboxDir, legacySession);
    mkdirSync(legacyDir, { recursive: true });
    writeFileSync(
      join(legacyDir, "todos-1000.json"),
      JSON.stringify({
        version: 1,
        updatedAt: new Date().toISOString(),
        todos: [{ id: "1", content: "Legacy task", status: "pending" }],
      }),
    );

    // Reading legacy unmigrated directory succeeds
    const legacyRead = await readTodos(legacySession);
    assert.equal(legacyRead[0].content, "Legacy task");

    // Writing migrates legacy directory to hashed directory
    await writeTodos(
      legacySession,
      buildTodosFromInput([{ id: "1", title: "Migrated task", status: "completed" }]),
    );
    const legacyHashed = hashSessionID(legacySession);
    assert.equal(existsSync(legacyDir), false, "Legacy directory must be renamed/migrated");
    assert.equal(existsSync(join(sandboxDir, legacyHashed)), true, "Hashed migrated directory must exist");

    const migratedRead = await readTodos(legacySession);
    assert.equal(migratedRead[0].status, "completed");

    console.log("✔ Scenarios 19 & 20: Hashed sessionID directory (zero raw leakage) and auto-migration verified");
  }

  {
    // Scenario 21: Cross-platform home directory resolution
    const winHome = resolveHomeDir({
      platform: "win32",
      env: { USERPROFILE: "C:\\Users\\Alice" },
    });
    assert.equal(winHome, "C:\\Users\\Alice", "Windows must prefer USERPROFILE");

    const winLegacy = resolveHomeDir({
      platform: "win32",
      env: { HOMEDRIVE: "D:", HOMEPATH: "\\Users\\Bob" },
    });
    assert.equal(winLegacy, "D:\\Users\\Bob", "Windows must support HOMEDRIVE+HOMEPATH");

    const nixHome = resolveHomeDir({
      platform: "linux",
      env: { HOME: "/home/alice" },
    });
    assert.equal(nixHome, "/home/alice", "Linux must prefer HOME");

    const macHome = resolveHomeDir({
      platform: "darwin",
      env: { HOME: "/Users/alice" },
    });
    assert.equal(macHome, "/Users/alice", "macOS must prefer HOME");

    // Explicit home override always wins (used by tests/tooling)
    assert.equal(
      resolveHomeDir({ platform: "win32", home: "X:\\forced", env: {} }),
      "X:\\forced",
      "Explicit home override must win",
    );

    console.log("✔ Scenario 21: Home directory resolves per-platform (win32 USERPROFILE/HOMEDRIVE, linux/macOS HOME)");
  }

  {
    // Scenario 22: Platform-native config home resolution
    const winCfg = resolveConfigHome({
      platform: "win32",
      env: { USERPROFILE: "C:\\Users\\Alice", APPDATA: "C:\\Users\\Alice\\AppData\\Roaming" },
    });
    assert.equal(
      winCfg,
      "C:\\Users\\Alice\\AppData\\Roaming",
      "Windows must use %APPDATA%",
    );

    const winLocal = resolveConfigHome({
      platform: "win32",
      env: { USERPROFILE: "C:\\Users\\Alice", LOCALAPPDATA: "C:\\Users\\Alice\\AppData\\Local" },
    });
    assert.equal(
      winLocal,
      "C:\\Users\\Alice\\AppData\\Local",
      "Windows must fall back to %LOCALAPPDATA%",
    );

    const winDefault = resolveConfigHome({
      platform: "win32",
      env: { USERPROFILE: "C:\\Users\\Alice" },
    });
    assert.equal(
      winDefault,
      "C:\\Users\\Alice\\AppData\\Roaming",
      "Windows default must be ~/AppData/Roaming",
    );

    const macCfg = resolveConfigHome({
      platform: "darwin",
      env: { HOME: "/Users/alice" },
    });
    assert.equal(
      macCfg,
      "/Users/alice/Library/Application Support",
      "macOS must use ~/Library/Application Support",
    );

    const linuxCfg = resolveConfigHome({
      platform: "linux",
      env: { HOME: "/home/alice" },
    });
    assert.equal(linuxCfg, "/home/alice/.config", "Linux must use ~/.config");

    const xdgCfg = resolveConfigHome({
      platform: "linux",
      env: { HOME: "/home/alice", XDG_CONFIG_HOME: "/custom/xdg" },
    });
    assert.equal(xdgCfg, "/custom/xdg", "XDG_CONFIG_HOME must override ~/.config");

    console.log("✔ Scenario 22: Config home resolves per-platform (APPDATA, Application Support, XDG/.config)");
  }

  {
    // Scenario 23: Todo base dir precedence + platform joining
    const explicit = resolveTodosBaseDir({
      platform: "win32",
      env: { OPENCODE_TODOS_DIR: "C:\\todo\\override", USERPROFILE: "C:\\Users\\Alice" },
    });
    assert.equal(explicit, "C:\\todo\\override", "OPENCODE_TODOS_DIR must win");

    const opencodeDir = resolveTodosBaseDir({
      platform: "win32",
      env: { OPENCODE_CONFIG_DIR: "C:\\oc-config", USERPROFILE: "C:\\Users\\Alice" },
    });
    assert.equal(
      opencodeDir,
      "C:\\oc-config\\tmp",
      "OPENCODE_CONFIG_DIR must be honored and joined with win32 separators",
    );

    const winBase = resolveTodosBaseDir({
      platform: "win32",
      env: { USERPROFILE: "C:\\Users\\Alice", APPDATA: "C:\\Users\\Alice\\AppData\\Roaming" },
    });
    assert.equal(
      winBase,
      "C:\\Users\\Alice\\AppData\\Roaming\\opencode\\tmp",
      "Windows base dir must use %APPDATA%\\opencode\\tmp",
    );

    const macBase = resolveTodosBaseDir({
      platform: "darwin",
      env: { HOME: "/Users/alice" },
    });
    assert.equal(
      macBase,
      "/Users/alice/Library/Application Support/opencode/tmp",
      "macOS base dir must use Application Support/opencode/tmp",
    );

    const linuxBase = resolveTodosBaseDir({
      platform: "linux",
      env: { HOME: "/home/alice" },
    });
    assert.equal(linuxBase, "/home/alice/.config/opencode/tmp", "Linux base dir must use ~/.config/opencode/tmp");

    // The live runtime must still honor the sandbox override from setup.
    assert.equal(
      getTodosDirectory(),
      sandboxDir,
      "Live getTodosDirectory must keep honoring OPENCODE_TODOS_DIR",
    );

    console.log("✔ Scenario 23: Todo base dir precedence (override → OPENCODE_CONFIG_DIR → platform native) verified");
  }

  cleanupSandbox();
}

runSuite().catch((err) => {
  cleanupSandbox();
  console.error("\nTEST SUITE FAILED:", err);
  process.exit(1);
});

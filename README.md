# OpenCode Todo List Plugin

Hierarchical todo list management tool and real-time TUI progress widget for OpenCode.

## Overview

Mounts above the session composer to track task execution in real-time.

**Collapsed (Default):**

```text
┌─────────────────────────────────────────────────────────────┐
│ › Todos (2/4)   ⠋ 2.2 API endpoints                       ✕ │
└─────────────────────────────────────────────────────────────┘
```

**Expanded:**

```text
┌─────────────────────────────────────────────────────────────┐
│ ▾ Todos (2/4)                                             ✕ │
│ ✔ 1. Design architecture                                    │
│ ⠋ 2. Implement backend                                      │
│   ✔ 2.1 Database schema                                     │
│   ⠋ 2.2 API endpoints                                       │
│ ○ 3. Write tests                                            │
└─────────────────────────────────────────────────────────────┘
```

- Click `› Todos` to expand/collapse.
- Click `✕` to clear all todos.

---

## Tool: `manage_todo_list`

### Operations

- `read`: Returns current todos and formatted progress tree.
- `write`: Replaces the todo list. Pass `todos: []` (or omit) to clear.

### Schema

#### 1. `ManageTodoItemInput` (Top-Level Task Input)

Input schema for main tasks accepted in `operation: "write"`:

| Property   | Type                                                       | Default                  | Description                                             |
| ---------- | ---------------------------------------------------------- | ------------------------ | ------------------------------------------------------- |
| `id`       | `string`                                                   | Auto (`"1"`, `"2"`, ...) | Task identifier. Auto-assigned sequentially if omitted. |
| `title`    | `string`                                                   | Optional                 | Task title (used as fallback for `content`).            |
| `content`  | `string`                                                   | `"Task <id>"`            | Task summary shown in the TUI list.                     |
| `note`     | `string`                                                   | Optional                 | Technical context (rendered with `↳` below the task).   |
| `status`   | `"pending" \| "in_progress" \| "completed" \| "cancelled"` | `"pending"`              | Current task status.                                    |
| `priority` | `"high" \| "medium" \| "low"`                              | Optional                 | Task priority level.                                    |
| `children` | `Array<SubTodoInput>`                                      | Optional                 | Nested subtasks list.                                   |

#### 2. `SubTodoInput` (Subtask Input)

Input schema for nested subtasks inside `children`:

| Property   | Type                                                       | Default                      | Description                                              |
| ---------- | ---------------------------------------------------------- | ---------------------------- | -------------------------------------------------------- |
| `id`       | `string`                                                   | Auto (`"<parentId>.1"`, ...) | Subtask identifier. Auto-assigned if omitted.            |
| `title`    | `string`                                                   | Optional                     | Subtask title (used as fallback for `content`).          |
| `content`  | `string`                                                   | `"Subtask <index>"`          | Subtask summary shown in the TUI list.                   |
| `note`     | `string`                                                   | Optional                     | Technical context (rendered with `↳` below the subtask). |
| `status`   | `"pending" \| "in_progress" \| "completed" \| "cancelled"` | `"pending"`                  | Current subtask status.                                  |
| `priority` | `"high" \| "medium" \| "low"`                              | Optional                     | Subtask priority level.                                  |

#### 3. `TodoItem` (Stored / Output Schema)

Normalized schema stored in disk and returned in `manageTodoListOutputSchema` (`{ todos: TodoItem[] }`):

| Property   | Type                                                       | Description                                                                                             |
| ---------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `id`       | `string`                                                   | Unique task identifier (e.g. `"1"`).                                                                    |
| `content`  | `string`                                                   | Normalized task description.                                                                            |
| `note`     | `string`                                                   | Optional technical notes rendered below the task on `read`.                                             |
| `status`   | `"pending" \| "in_progress" \| "completed" \| "cancelled"` | Normalized status.                                                                                      |
| `priority` | `"high" \| "medium" \| "low"`                              | Optional priority.                                                                                      |
| `children` | `Array<SubTodo>`                                           | Optional list of normalized subtasks (`id`, `content`, optional `note`, `status`, optional `priority`). |

### Rules

1. **Single active task**: At most 1 task or subtask may be `in_progress` at any time.
2. **Hierarchy invariant**: If a subtask is `in_progress`, its parent must also be `in_progress`.
3. **Auto-completion**: Parent resolves to `completed` once all its subtasks are `completed`.

---

## Examples

### Read Todos

**Request:**

```json
{
  "operation": "read"
}
```

**Output:**

```text
[x] 1. Design architecture
[~] 2. Implement backend (1/2)
    ↳ note: Ensure strict input validation
    [x] 2.1 Database schema
    [~] 2.2 API endpoints
        ↳ note: Return 401 when unauthenticated
[ ] 3. Write tests
```

### Write / Update Todos

**Request:**

```json
{
  "operation": "write",
  "todos": [
    {
      "id": "1",
      "content": "Design architecture",
      "status": "completed"
    },
    {
      "id": "2",
      "content": "Implement backend",
      "status": "in_progress",
      "priority": "high",
      "note": "Ensure strict input validation",
      "children": [
        { "id": "2.1", "content": "Database schema", "status": "completed" },
        {
          "id": "2.2",
          "content": "API endpoints",
          "status": "in_progress",
          "note": "Return 401 when unauthenticated"
        }
      ]
    },
    {
      "id": "3",
      "content": "Write tests",
      "status": "pending"
    }
  ]
}
```

**Output:**

```text
Todos (2/4) updated successfully.
```

### Clear Todos

**Request:**

```json
{
  "operation": "write",
  "todos": []
}
```

**Output:**

```text
Cleared all todos.
```

---

## Automatic Context Hinting (`<todo_hint>`)

The plugin injects a lightweight hint into the prompt so the model stays anchored to active work, without polluting the transcript:

- **Conditional Injection:** Hints are added only when todos exist and at least one is `pending` or `in_progress`. Idle or fully finished sessions inject nothing (0 extra tokens).
- **Deduplicated per State Change:** A `version` counter bumps on every write (tool `manage_todo_list` or the TUI clear button). The hint is injected **at most once per version**, tracked in a dedicated `hint-marker.json` so repeated turns stay clean.
- **Static Text (No Stale Numbers):** The hint carries no dynamic counts, so old turns in the history never show outdated figures:
  ```xml
  <todo_hint>Active todos exist. If continuing previous work, call manage_todo_list [read] first. Ignore if the user is discussing something else.</todo_hint>
  ```
- **Empty-Prompt Guard:** Attachment-only or whitespace-only prompts are skipped, so a hint never fabricates a ghost user message.
- **Stale Expiration:** If a session is inactive for more than 30 minutes, hints stop automatically.
- **Universal Portability:** Works out of the box on any OpenCode setup without manual system prompt edits.

- **Ephemeral System Part (100% Invisible in TUI):** The hint is injected directly into the model request's `system` parts via the `context` lifecycle hook. Because this payload is reconstructed per request and never persisted to the chat transcript, **the hint reaches the LLM completely invisibly** — no ghost text in the TUI, no clutter in history.
- **Graceful Fallback:** If a custom host does not expose the `context` hook, it seamlessly falls back to prompt hook injection with whitespace guards.
- **Hashed Session Directories (Privacy & Security):** Directories on disk are anonymized using deterministic SHA-256 hashes (`s_<32-hex>`), preventing raw session identifiers from leaking in file system trees. Existing plaintext directories are automatically migrated.
- **Cross-Platform Native Paths:** Storage locations adapt to the host OS (Windows, macOS, Linux) using each platform's native conventions, with environment-variable overrides respected.

---

## Storage Location (Cross-Platform)

Todo files are stored under a platform-native base directory with no configuration required:

| Platform        | Base directory                                                      | Resolved example                                        |
| --------------- | ------------------------------------------------------------------- | ------------------------------------------------------- |
| **Windows**     | `%APPDATA%\opencode\tmp`                                            | `C:\Users\Alice\AppData\Roaming\opencode\tmp`           |
| **macOS**       | `~/Library/Application Support/opencode/tmp`                        | `/Users/alice/Library/Application Support/opencode/tmp` |
| **Linux / BSD** | `$XDG_CONFIG_HOME/opencode/tmp` (fallback `~/.config/opencode/tmp`) | `/home/alice/.config/opencode/tmp`                      |

Home directory resolution also adapts per platform:

- **Windows:** `USERPROFILE`, then `HOMEDRIVE`+`HOMEPATH`, then `HOME`.
- **macOS / Linux / BSD:** `HOME`.

### Environment overrides (checked in priority order)

1. `OPENCODE_TODOS_DIR` — explicit override for the todo storage root (used by the test suite).
2. `OPENCODE_CONFIG_DIR` — honored as `<OPENCODE_CONFIG_DIR>/tmp`.
3. `XDG_CONFIG_HOME` — honored on **every** platform, so an XDG-style layout can be forced even on Windows/macOS.

Because directory names are hashed (`s_<32-hex>`), the raw `sessionID` never appears on disk, and legacy plaintext directories are migrated transparently on the next write.

---

## Installation

```bash
git clone https://github.com/MomoPi-Dark/opencode-todolist.git ~/.config/opencode/plugins/opencode.tools.todolist
cd ~/.config/opencode/plugins/opencode.tools.todolist
bun install
```

> **Important:** `bun install` is **required**. OpenCode loads local plugins from the directory but does not install their dependencies for you. Without it, the plugin will fail to load with `Cannot find package 'zod'`.

## Development

```bash
bun run check
```

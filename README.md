# OpenCode Todo List Tool (`opencode.tools.todolist`)

Hierarchical todo list management tool and real-time TUI progress widget for OpenCode.

## Overview

The plugin provides dual interfaces for tracking multi-step workflows in OpenCode:
1. **Interactive TUI Widget**: Mounts directly above the session composer (`session.composer.top`) with live animations and clickable collapse/clear controls.
2. **LLM Tool Interface (`manage_todo_list`)**: Exposes structured JSON read/write operations with hierarchical ASCII tree output.

### 1. TUI Widget Display

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
│   ✔ 1. Design architecture                                  │
│   ⠋ 2. Implement backend                                    │
│       ✔ 2.1 Database schema                                 │
│       ⠋ 2.2 API endpoints                                   │
│   ○ 3. Write tests                                          │
└─────────────────────────────────────────────────────────────┘
```

* **Header Controls**: Click the header title (`› Todos`) to toggle expand/collapse, or click `✕` on the far right to clear the task list.
* **Status Glyphs**: `✔` completed, `⠋` in-progress spinner (or `⦿` when idle), `○` pending, and `✕` cancelled.

### 2. Tool Text Output (`read`)

When inspected by an agent via `manage_todo_list` (`operation: "read"`), tasks are formatted into an ASCII tree with branch arrows (`↳`) for attached notes:

```text
[x] 1. Design architecture
[~] 2. Implement backend (1/2)
    ↳ note: Ensure strict input validation
    [x] 2.1 Database schema
    [~] 2.2 API endpoints
        ↳ note: Return 401 when unauthenticated
[ ] 3. Write tests
```

## Tool: `manage_todo_list`

The plugin exposes a single tool `manage_todo_list` to track and update multi-step task progress.

### Operations

- `read`: Returns the current todo list hierarchy and progress for the active session.
- `write`: Sets or replaces the todo list hierarchy. Passing `todos: []` (or omitting `todos`) clears the list.

### Parameters (`write`)

| Field | Type | Required | Description |
|---|---|---|---|
| `operation` | `"read" \| "write"` | Required | Operation to perform. |
| `todos` | `Array<ManageTodoItemInput>` | Optional | Hierarchical task list (defaults to `[]` when omitted). |

#### `ManageTodoItemInput` (Input Item)

Input schema accepted by `manage_todo_list`:

| Property | Type | Default | Description |
|---|---|---|---|
| `id` | `string` | Auto (`"1"`, `"2"`, ...) | Task identifier. Auto-assigned sequentially if omitted. |
| `title` | `string` | Optional | Task title (used as fallback for `content`). |
| `content` | `string` | `"Task <id>"` | Task summary shown in the compact TUI list. |
| `note` | `string` | Optional | Additional technical notes, paths, or execution details. |
| `status` | `"pending" \| "in_progress" \| "completed" \| "cancelled"` | `"pending"` | Current task status. |
| `priority` | `"high" \| "medium" \| "low"` | Optional | Task priority. |
| `children` | `Array<SubTodoInput>` | Optional | Nested subtasks list. |

#### `SubTodoInput` (Input Subtask)

Nested subtask schema inside `children`:

| Property | Type | Default | Description |
|---|---|---|---|
| `id` | `string` | Auto (`"<parentId>.1"`, ...) | Subtask identifier. Auto-assigned if omitted. |
| `title` | `string` | Optional | Subtask title (used as fallback for `content`). |
| `content` | `string` | `"Subtask <index>"` | Subtask summary shown in the compact TUI list. |
| `note` | `string` | Optional | Subtask technical notes or acceptance criteria. |
| `status` | `"pending" \| "in_progress" \| "completed" \| "cancelled"` | `"pending"` | Current subtask status. |
| `priority` | `"high" \| "medium" \| "low"` | Optional | Subtask priority. |

#### Stored / Output Schema (`TodoItem`)

Normalized schema returned in `manageTodoListOutputSchema` (`{ todos: TodoItem[] }`):

| Property | Type | Description |
|---|---|---|
| `id` | `string` | Unique task identifier (e.g. `"1"`). |
| `content` | `string` | Task summary or description. |
| `note` | `string` | Optional technical notes. Rendered below the task on `read`. |
| `status` | `"pending" \| "in_progress" \| "completed" \| "cancelled"` | Normalized status. |
| `priority` | `"high" \| "medium" \| "low"` | Optional priority. |
| `children` | `Array<SubTodo>` | Optional list of normalized subtasks (`id`, `content`, optional `note`, `status`, optional `priority`). |

### Status Rules

1. **Single Active Task**: At most one task or subtask may be `in_progress` at any time.
2. **Hierarchy Invariant**: If a subtask is `in_progress`, its parent task must also be `in_progress`.
3. **Auto-Completion**: When all subtasks of a parent are `completed`, the parent automatically resolves to `completed`.

### Usage Examples

#### Reading Current Todos

```json
{
  "operation": "read"
}
```

#### Writing / Updating Todos

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
        {
          "id": "2.1",
          "content": "Database schema",
          "status": "completed"
        },
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

#### Clearing Todos

```json
{
  "operation": "write",
  "todos": []
}
```

---

## Installation

Clone into your OpenCode plugins directory:

```bash
git clone https://github.com/MomoPi-Dark/opencode.tools.todolist.git ~/.config/opencode/plugins/opencode.tools.todolist
cd ~/.config/opencode/plugins/opencode.tools.todolist
bun install
```

## Development

```bash
bun run check
```

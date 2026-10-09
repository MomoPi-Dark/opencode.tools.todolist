# OpenCode Todo List Tool (`opencode.tools.todolist`)

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

* Click `› Todos` to expand/collapse.
* Click `✕` to clear all todos.

---

## Tool: `manage_todo_list`

### Operations

- `read`: Returns current todos and formatted progress tree.
- `write`: Replaces the todo list. Pass `todos: []` (or omit) to clear.

### Schema

#### 1. `ManageTodoItemInput` (Top-Level Task Input)

Input schema for main tasks accepted in `operation: "write"`:

| Property | Type | Default | Description |
|---|---|---|---|
| `id` | `string` | Auto (`"1"`, `"2"`, ...) | Task identifier. Auto-assigned sequentially if omitted. |
| `title` | `string` | Optional | Task title (used as fallback for `content`). |
| `content` | `string` | `"Task <id>"` | Task summary shown in the TUI list. |
| `note` | `string` | Optional | Technical context (rendered with `↳` below the task). |
| `status` | `"pending" \| "in_progress" \| "completed" \| "cancelled"` | `"pending"` | Current task status. |
| `priority` | `"high" \| "medium" \| "low"` | Optional | Task priority level. |
| `children` | `Array<SubTodoInput>` | Optional | Nested subtasks list. |

#### 2. `SubTodoInput` (Subtask Input)

Input schema for nested subtasks inside `children`:

| Property | Type | Default | Description |
|---|---|---|---|
| `id` | `string` | Auto (`"<parentId>.1"`, ...) | Subtask identifier. Auto-assigned if omitted. |
| `title` | `string` | Optional | Subtask title (used as fallback for `content`). |
| `content` | `string` | `"Subtask <index>"` | Subtask summary shown in the TUI list. |
| `note` | `string` | Optional | Technical context (rendered with `↳` below the subtask). |
| `status` | `"pending" \| "in_progress" \| "completed" \| "cancelled"` | `"pending"` | Current subtask status. |
| `priority` | `"high" \| "medium" \| "low"` | Optional | Subtask priority level. |

#### 3. `TodoItem` (Stored / Output Schema)

Normalized schema stored in disk and returned in `manageTodoListOutputSchema` (`{ todos: TodoItem[] }`):

| Property | Type | Description |
|---|---|---|
| `id` | `string` | Unique task identifier (e.g. `"1"`). |
| `content` | `string` | Normalized task description. |
| `note` | `string` | Optional technical notes rendered below the task on `read`. |
| `status` | `"pending" \| "in_progress" \| "completed" \| "cancelled"` | Normalized status. |
| `priority` | `"high" \| "medium" \| "low"` | Optional priority. |
| `children` | `Array<SubTodo>` | Optional list of normalized subtasks (`id`, `content`, optional `note`, `status`, optional `priority`). |

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
        { "id": "2.2", "content": "API endpoints", "status": "in_progress", "note": "Return 401 when unauthenticated" }
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

## Installation

```bash
git clone https://github.com/MomoPi-Dark/opencode.tools.todolist.git ~/.config/opencode/plugins/opencode.tools.todolist
cd ~/.config/opencode/plugins/opencode.tools.todolist
bun install
```

## Development

```bash
bun run check
```

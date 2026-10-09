# OpenCode Todo List Tool (`opencode.tools.todolist`)

Hierarchical todo list management tool and real-time TUI progress widget for OpenCode.

## Overview

The plugin mounts a collapsible widget above the session composer (`session.composer.top`) to reflect task execution in real-time:

**Collapsed (Default):**
```text
┌─────────────────────────────────────────────────────────────┐
│ › Todos (1/3)   ⠋ 2.2 API endpoints                       ✕ │
└─────────────────────────────────────────────────────────────┘
```

**Expanded:**
```text
┌─────────────────────────────────────────────────────────────┐
│ ▾ Todos (1/3)                                             ✕ │
│   [x] 1. Design architecture                                │
│   [~] 2. Implement backend                                  │
│       [x] 2.1 Database schema                               │
│       ⠋ 2.2 API endpoints                                   │
│   [ ] 3. Write tests                                        │
└─────────────────────────────────────────────────────────────┘
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
| `content` | `string` | `"Task <id>"` | Task description. |
| `status` | `"not-started" \| "in-progress" \| "pending" \| "in_progress" \| "completed" \| "cancelled"` | `"not-started"` | Current task status. Normalized internally to `"pending"`, `"in_progress"`, `"completed"`, or `"cancelled"`. |
| `priority` | `"high" \| "medium" \| "low"` | Optional | Task priority. |
| `children` | `Array<SubTodoInput>` | Optional | Nested subtasks list. |

#### `SubTodoInput` (Input Subtask)

Nested subtask schema inside `children`:

| Property | Type | Default | Description |
|---|---|---|---|
| `id` | `string` | Auto (`"<parentId>.1"`, ...) | Subtask identifier. Auto-assigned if omitted. |
| `title` | `string` | Optional | Subtask title (used as fallback for `content`). |
| `content` | `string` | `"Subtask <index>"` | Subtask description. |
| `status` | `"not-started" \| "in-progress" \| "pending" \| "in_progress" \| "completed" \| "cancelled"` | `"not-started"` | Current subtask status. |
| `priority` | `"high" \| "medium" \| "low"` | Optional | Subtask priority. |

#### Stored / Output Schema (`TodoItem`)

Normalized schema returned in `manageTodoListOutputSchema` (`{ todos: TodoItem[] }`):

| Property | Type | Description |
|---|---|---|
| `id` | `string` | Unique task identifier (e.g. `"1"`). |
| `content` | `string` | Task summary or description. |
| `status` | `"pending" \| "in_progress" \| "completed" \| "cancelled"` | Normalized status. |
| `priority` | `"high" \| "medium" \| "low"` | Optional priority. |
| `children` | `Array<SubTodo>` | Optional list of normalized subtasks (`id`, `content`, `status`, optional `priority`). |

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
      "children": [
        {
          "id": "2.1",
          "content": "Database schema",
          "status": "completed"
        },
        {
          "id": "2.2",
          "content": "API endpoints",
          "status": "in_progress"
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

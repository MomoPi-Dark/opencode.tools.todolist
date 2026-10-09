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

| Field | Type | Description |
|---|---|---|
| `operation` | `"read" \| "write"` | Operation to execute. |
| `todos` | `Array<TodoItem>` | List of hierarchical todo items (optional on `write`, defaults to `[]`). |

#### `TodoItem` Schema

| Property | Type | Required | Description |
|---|---|---|---|
| `id` | `string` | Optional | Task ID (e.g. `"1"`, `"1.1"`). Auto-assigned sequentially if omitted. |
| `title` / `content` | `string` | Optional | Task summary or description. |
| `status` | `string` | Optional | `"pending"`, `"in_progress"`, `"completed"`, or `"cancelled"` (default: `"pending"`). |
| `priority` | `string` | Optional | `"high"`, `"medium"`, or `"low"`. |
| `children` | `Array<SubTodo>` | Optional | Nested subtasks. |

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

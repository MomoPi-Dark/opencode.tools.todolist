---
name: todolist
description: Automatic task tracking, step-by-step progress tracking, and multi-step plan execution via the manage_todo_list tool. Activates whenever the user asks to implement a feature, fix a bug, refactor, execute a plan, create a roadmap, track steps, or anytime a request involves 2 or more steps or operations.
---

# Todolist Management Skill

Manage and track multi-step task execution using `manage_todo_list`.

## Core Principles

1. **Auto-Trigger & Proactive Initialization**:
   - Whenever a task involves 2 or more sequential or parallel steps (features, refactor, bugfixes, setup, migrations), immediately initialize the todo list via `manage_todo_list [operation=write]`.
   - Do NOT ask permission to create the todo list. Do NOT require the user to explicitly say "create a todo list".

2. **Single Active Task Rule**:
   - Exactly **ONE** task or subtask can be `in_progress` at any time.
   - If a subtask is `in_progress`, its parent MUST be `in_progress`.
   - Never set multiple items or subtasks to `in_progress` simultaneously.

3. **Auto-Completion Hierarchy**:
   - When all children (`children`) under a parent are `completed`, the parent automatically becomes `completed`.
   - A parent cannot be `cancelled` or `pending` if all of its subtasks succeeded.

4. **Real-time Status Updates**:
   - Immediately update status via `manage_todo_list` as work transitions:
     - `pending`: task queued.
     - `in_progress`: task actively being worked on (triggers TUI spinner).
     - `completed`: task finished and verified.
     - `cancelled`: task skipped or abandoned.

5. **Technical Context via `note` Field**:
   - Keep `content` concise and brief so the compact TUI widget remains clean and single-line.
   - Place execution details, acceptance criteria, file paths, or verification instructions in the optional `note` field.
   - On `read`, notes appear under their parent or subtask indented with a branch arrow (`↳ note: ...`).

## Tool Interface

### Read Current Todos

```json
{
  "operation": "read"
}
```

**Formatted Output Preview:**

```text
[~] 1. Parent Task Title (1/2)
    ↳ note: Milestone technical context
    [x] 1.1 First subtask
        ↳ note: Unit tests passing
    [~] 1.2 Second subtask
        ↳ note: Implement endpoint validation in src/auth.ts
[ ] 2. Next Parent Task
```

### Write / Update Full List

```json
{
  "operation": "write",
  "todos": [
    {
      "id": "1",
      "content": "Parent Task Title",
      "status": "in_progress",
      "note": "Milestone technical context",
      "children": [
        {
          "id": "1.1",
          "content": "First subtask",
          "status": "completed",
          "note": "Unit tests passing"
        },
        {
          "id": "1.2",
          "content": "Second subtask",
          "status": "in_progress",
          "note": "Implement endpoint validation in src/auth.ts"
        }
      ]
    },
    {
      "id": "2",
      "content": "Next Parent Task",
      "status": "pending"
    }
  ]
}
```

### Clear Todo List

```json
{
  "operation": "write",
  "todos": []
}
```

_(Passing `operation: "write"` with an empty array or omitting `todos` clears the list)._

## Workflow Pattern

```
1. User provides complex request / multi-step task (>= 2 operations)
   │
   ▼
2. Call `manage_todo_list` [operation="write"] BEFORE any file tool
   - Break down into milestones (parent) and atomic steps (children)
   - Step 1 / 1.1 set to `in_progress`
   - Remaining steps set to `pending`
   │
   ▼
3. Print to chat:
   ▶ Starting (1/N): <Task Name>
   │
   ▼
4. Execute code changes (edit / write / shell) for Step 1.1
   │
   ▼
5. Call `manage_todo_list` [operation="write"]:
   - Update Step 1.1 status to `completed`
   - Append artifact evidence to `note` (e.g., "created: src/auth.ts", "test passed")
   - Set Step 1.2 to `in_progress`
   │
   ▼
6. Print to chat:
   ✔ Completed (1/N): <Task Name>
   │
   ▼
7. Repeat loop until all tasks reach `completed` (Todos N/N)
```

## Anti-Patterns (STRICTLY FORBIDDEN)

- ❌ **No Ghost Execution**: Do NOT write/edit files without an initialized todo list.
- ❌ **No Batch Completion**: Do NOT jump multiple todos from `pending` straight to `completed` without active execution in between.
- ❌ **No Missing Artifacts**: Always log touched files or test outcomes in the `note` field upon completing each step.

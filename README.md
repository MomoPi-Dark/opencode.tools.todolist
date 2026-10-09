# OpenCode Todo List Plugin (`opencode.tools.todolist`)

> **Note**: This plugin is specifically designed for **OpenCode v2** (`>= 2.0.0`) using the modern TUI slot architecture (`context.ui.slot`) and SolidJS (`@opentui/solid`).

A real-time hierarchical task and todo list manager widget for the [OpenCode](https://opencode.ai) v2 TUI composer and agent workflows.

```text
┌ Todos (2/3) ──────────────────────┐
│ [x] 1. Investigate architecture   │
│ [~] 2. Implement core engine  ⠋   │
│     [x] 2.1 Storage backend       │
│     [~] 2.2 Reconciler layout ⠋   │
│ [ ] 3. Run test verification      │
└───────────────────────────────────┘
```

---

## Compatibility

- **OpenCode**: `v2.0.0` or higher
- **Runtime**: Bun (`>= 1.0.0`)

---

## Features

- **Hierarchical Task Management**: Structured parent tasks and subtasks with real-time progress calculation.
- **Active Task Spinner**: Running braille spinner on active tasks (`in_progress`) synced with session execution.
- **Auto Completion**: Automatically marks parent tasks completed when all subtasks succeed.
- **Session-Scoped Storage**: Isolated JSON storage per session under `~/.config/opencode/tmp/<sessionID>/` with file locking and corruption recovery.
- **Collapsible TUI Widget**: Mounts into `session.composer.top` with single-click expansion and clear actions.
- **Theme-Aware**: Seamlessly adapts to active OpenCode v2 theme borders and status colors.

---

## Installation

### Method 1: Local Plugin Directory (Recommended)

Clone the repository into your OpenCode plugins folder:

```bash
git clone https://github.com/MomoPi-Dark/opencode.tools.todolist.git ~/.config/opencode/plugins/opencode.tools.todolist
```

Install dependencies:

```bash
bun install
```

---

## Development

```bash
bun run typecheck
bun run test
bun run build
```

The test suite uses an isolated temporary storage directory and does not modify real session data.

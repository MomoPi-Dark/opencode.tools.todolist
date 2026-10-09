# Contributing

Thank you for contributing to `opencode.tools.todolist`!

## Development Setup

Requirements:
- [Bun](https://bun.sh) (v1.1+)

```bash
git clone https://github.com/MomoPi-Dark/opencode.tools.todolist.git
cd opencode.tools.todolist
bun install
```

## Running Checks

Ensure all typechecks, unit tests, and builds pass before submitting changes:

```bash
bun run check
```

Or run steps individually:
- `bun run typecheck` (TypeScript typecheck without emit)
- `bun run test` (17+ unit & regression test scenarios)
- `bun run build` (TUI Solid build check)

## Commit Conventions

Follow the [Conventional Commits](https://www.conventionalcommits.org/) specification:
- `feat`: New features or enhancements
- `fix`: Bug fixes
- `docs`: Documentation updates
- `chore`: Maintenance, dependency bumps, tooling
- `refactor`: Code improvements without changing external behavior

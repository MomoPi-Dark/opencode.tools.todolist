import { type Plugin, Skill } from "@opencode/plugin";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Skill metadata parsed from a markdown file's YAML frontmatter. */
export interface ParsedSkill {
  name?: string;
  description?: string;
  body: string;
}

/** A skill resolved from disk, ready to be handed to the plugin API. */
export interface LocalSkill {
  id: string;
  name: string;
  description?: string;
  path: string;
  content: string;
}

/** Parses `name`/`description` frontmatter and returns the markdown body. */
export function parseSkillMarkdown(raw: string): ParsedSkill {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(raw);
  if (!match) return { body: raw.trim() };

  const parsed: ParsedSkill = { body: raw.slice(match[0].length).trim() };
  for (const line of match[1].split(/\r?\n/)) {
    const separator = line.indexOf(":");
    if (separator === -1) continue;
    const key = line.slice(0, separator).trim().toLowerCase();
    const value = line
      .slice(separator + 1)
      .trim()
      .replace(/^["']|["']$/g, "");
    if (!value) continue;
    if (key === "name") parsed.name = value;
    else if (key === "description") parsed.description = value;
  }
  return parsed;
}

/** Reads a single skill markdown file, or `null` when it cannot be read. */
export function parseSkillFile(file: string): ParsedSkill | null {
  try {
    return parseSkillMarkdown(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

/**
 * Locates the bundled `skills/` directory. The build emits the ESM bundle at
 * the package root while the sources live in `src/`, so both are probed.
 */
export function getSkillsDirectory(): string {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.join(moduleDir, "skills"),
    path.resolve(moduleDir, "..", "skills"),
  ];
  return candidates.find((dir) => fs.existsSync(dir)) ?? candidates[0];
}

/**
 * Loads every skill from the bundled `skills/` directory, supporting both
 * `skills/<id>/SKILL.md` directories and flat `skills/<id>.md` files.
 * Pass `dir` to read from another location (used by tests).
 */
export function readSkills(dir: string = getSkillsDirectory()): LocalSkill[] {
  try {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const candidates = entry.isDirectory()
        ? [
            path.join(dir, entry.name, "SKILL.md"),
            path.join(dir, entry.name, `${entry.name}.md`),
          ]
        : path.extname(entry.name) === ".md"
          ? [path.join(dir, entry.name)]
          : [];

      for (const file of candidates) {
        const parsed = parseSkillFile(file);
        if (!parsed) continue;
        const id = entry.isDirectory()
          ? entry.name
          : path.basename(entry.name, ".md");
        return [
          {
            id,
            name: parsed.name || id,
            description: parsed.description,
            path: file,
            content: parsed.body,
          },
        ];
      }
      return [];
    });
  } catch {
    return [];
  }
}

/**
 * Registers the bundled skills so the model always knows how to drive
 * `manage_todo_list` and never loses the thread of a multi-step task.
 */
export async function registerTodoSkills(ctx: Plugin.Context): Promise<void> {
  const skills = readSkills();
  if (skills.length === 0) return;

  await ctx.skill.transform((editor) => {
    for (const skill of skills) {
      editor.add(
        Skill.Info.make({
          // Disk values are plain strings; the schema brands them at the boundary.
          id: skill.id as Skill.ID,
          name: skill.name as Skill.Name,
          path: skill.path as Skill.Info["path"],
          content: skill.content,
          autoinvoke: true,
          ...(skill.description ? { description: skill.description } : {}),
        }),
      );
    }
  });
}

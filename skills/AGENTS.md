# Skills DOX

## Purpose

The `skills/` subtree contains built-in Prompt Paul Agent Skills and the registry that makes them available to the extension.

## Ownership

- `skills/skills.json` owns the built-in skill registry.
- Each `skills/<name>/SKILL.md` file owns the source instructions and metadata for one built-in skill.
- Root AGENTS.md owns the canonical Agent Skills specification.

## Local Contracts

- Every built-in skill must be registered in `skills/skills.json` with `id`, `name`, `description`, and `path`.
- Every `SKILL.md` must start with YAML frontmatter containing at least `name` and `description`.
- Skill names must be lowercase and may use hyphens.
- `user-invocable: true` enables the `/<skill-name>` shortcut.
- `disable-model-invocation: true` hides a skill from model auto-suggestions.
- `command-dispatch: "tool"` requires a matching runtime tool implementation.

## Work Guidance

- Keep skill instructions concise and directly actionable.
- Add or update examples in `docs/SKILL_EXAMPLES.md` when user-facing skill behavior changes.
- Update root AGENTS.md when the skill format, metadata fields, or runtime resolution flow changes.
- Keep registry paths relative to the repository root.

## Verification

- Run `npm run test` after adding or changing built-in skills.
- Verify `/skills`, `/skill <name>`, and any user-invocable shortcut in the side panel when behavior changes.

## Child DOX Index

- No child AGENTS.md files are currently needed under `skills/`.

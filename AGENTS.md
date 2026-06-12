# DOX Framework

- DOX is the AGENTS.md hierarchy installed for Prompt Paul.
- Agents must follow this file and every applicable child AGENTS.md before editing.

## Core Contract

- AGENTS.md files are binding work contracts for their subtrees.
- Work products, source materials, instructions, records, assets, and durable docs must stay understandable from the nearest applicable AGENTS.md plus every parent AGENTS.md above it.

## Read Before Editing

1. Read the root AGENTS.md.
2. Identify every file or folder you expect to touch.
3. Walk from the repository root to each target path.
4. Read every AGENTS.md found along each route.
5. If a parent AGENTS.md lists a child AGENTS.md whose scope contains the path, read that child and continue from there.
6. Use the nearest AGENTS.md as the local contract and parent docs for repo-wide rules.
7. If docs conflict, the closer doc controls local work details, but no child doc may weaken DOX.

Do not rely on memory. Re-read the applicable DOX chain in the current session before editing.

## Update After Editing

Every meaningful change requires a DOX pass before the task is done.

Update the closest owning AGENTS.md when a change affects:

- purpose, scope, ownership, or responsibilities
- durable structure, contracts, workflows, or operating rules
- required inputs, outputs, permissions, constraints, side effects, or artifacts
- user preferences about behavior, communication, process, organization, or quality
- AGENTS.md creation, deletion, move, rename, or index contents

Update parent docs when parent-level structure, ownership, workflow, or child index changes. Update child docs when parent changes alter local rules. Remove stale or contradictory text immediately. Small edits that do not change behavior or contracts may leave docs unchanged, but the DOX pass still must happen.

## Hierarchy

- Root AGENTS.md is the DOX rail: project-wide instructions, global preferences, durable workflow rules, and the top-level Child DOX Index.
- Child AGENTS.md files own domain-specific instructions and their own Child DOX Index.
- Each parent explains what its direct children cover and what stays owned by the parent.
- The closer a doc is to the work, the more specific and practical it must be.

## Child Doc Shape

- Create a child AGENTS.md when a folder becomes a durable boundary with its own purpose, rules, responsibilities, workflow, materials, or quality standards.
- Work Guidance must reflect the current standards of the project or user instructions; if there are no specific standards or instructions yet, leave it empty.
- Verification must reflect an existing check; if no verification framework exists yet, leave it empty and update it when one exists.

Default section order:

- Purpose
- Ownership
- Local Contracts
- Work Guidance
- Verification
- Child DOX Index

## Style

- Keep docs concise, current, and operational.
- Document stable contracts, not diary entries.
- Put broad rules in parent docs and concrete details in child docs.
- Prefer direct bullets with explicit names.
- Do not duplicate rules across many files unless each scope needs a local version.
- Delete stale notes instead of explaining history.
- Trim obvious statements, repeated rules, misplaced detail, and warnings for risks that no longer exist.

## Closeout

1. Re-check changed paths against the DOX chain.
2. Update nearest owning docs and any affected parents or children.
3. Refresh every affected Child DOX Index.
4. Remove stale or contradictory text.
5. Run existing verification when relevant.
6. Report any docs intentionally left unchanged and why.

## Purpose

Prompt Paul is a Manifest V3 Chrome extension for sending selected text, media, and page content to an LLM from context menus and a side panel chat. It also implements an OpenClaw-compatible Agent Skills system for reusable AI instructions.

## Ownership

- Root owns project-wide contracts, `manifest.json`, package metadata, root extension entry points, shared browser UI files, README and changelog files, and the top-level DOX index.
- Root owns top-level extension surfaces: `background.js`, `chat.js`, `options.js`, content scripts, HTML/CSS entry files, theme/loading helpers, and design prototypes.
- Child docs own durable subtrees listed in the Child DOX Index.
- Generated build output such as `dist/` is not source of truth and should not be edited directly.

## Local Contracts

- The extension is Manifest V3 and uses `background.js` as an ES module service worker.
- API keys, profiles, custom instructions, tools, skills, and user settings live in Chrome storage.
- Remote LLM calls happen only when the user sends a prompt or invokes an action.
- Browser-internal pages, extension pages, and Chrome Web Store pages must be blocked or reported before content extraction.
- Broad host permissions are intentional for page extraction and context-menu workflows.
- Built-in and custom skills are instructions by default, not executable tools, unless deterministic tool dispatch is explicitly implemented.
- Keep privacy-sensitive analytics opt-out and safe-label handling intact.

## Work Guidance

- Use 2-space indentation and single quotes in JavaScript.
- Add `@fileoverview` and `@module` JSDoc to new source modules.
- Prefer explicit exports from modules under `src/`.
- Keep shared logic in `src/chat/`, `src/utils/`, or `src/orchestrator/` instead of adding more large blocks to root entry points.
- Keep `docs/`, README, tests, and DOX files current when behavior, workflows, or structure changes.
- Do not edit vendored libraries or binary assets unless the task is specifically about those files.
- Preserve existing user changes in the working tree.

## Verification

- `npm run test` checks module structure, manifest references, skill files, and regression guards.
- `npm run smoke` checks manifest file references and vendored dependency conflicts.
- `npm run build` copies the extension into `dist/` for unpacked or packaged testing.
- `npm run validate` runs lint, formatting checks, tests, and smoke checks.
- For UI or browser-runtime changes, also reload the unpacked extension in Chrome or Edge and exercise the affected flow.

## Agent Skills Specification

This section is the canonical specification reference for Prompt Paul skill format, metadata, and runtime behavior. For end-user examples and workflows, see `docs/SKILL_EXAMPLES.md`.

### Using Skills In Chat

1. List all skills: `/skills`
2. Invoke canonical command: `/skill <name> [input]`
3. Invoke per-skill shortcut when user-invocable: `/<skill-name> [input]`
4. Invoke by natural language trigger: `use <skill> skill and [your request]`

### Supported Skill Intent Patterns

| Pattern | Example | Status |
| --- | --- | --- |
| `use /<skill>` | `use /humanizer and rewrite` | supported |
| `use <skill> skill` | `use humanizer skill and rewrite` | supported |
| `apply /<skill>` | `apply /summarizer to this` | supported |
| `with /<skill>` | `with /humanizer, rewrite this` | supported |
| `invoke /<skill>` | `invoke /weather-guide explain forecast` | supported |
| `use <skill> and/to/for` | `use humanizer and rewrite` | supported |
| `please use <skill> to` | `please use humanizer to rewrite` | supported |

### Skill Format

Skills follow the Agent Skills specification with YAML frontmatter.

```markdown
---
name: 'skill-name'
description: 'Brief description of what this skill does'
license: 'MIT'
user-invocable: true
disable-model-invocation: false
metadata: { 'tags': 'category', 'version': '1.0.0' }
---

# Skill Name

## Purpose

Explain when and why to use this skill.

## Guidelines

1. Step-by-step instructions
2. Best practices
3. Expected outputs

## Examples

**Input:** Example input
**Output:** Expected output
```

### Frontmatter Fields

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `name` | string | required | Unique identifier, lowercase with optional hyphens |
| `description` | string | required | Brief description for AI and user discovery |
| `license` | string | optional | License identifier, for example MIT or Apache-2.0 |
| `user-invocable` | boolean | true | Creates `/<name>` shortcut command when true |
| `disable-model-invocation` | boolean | false | Hides from model auto-suggestions when true |
| `command-dispatch` | enum | null | Set to `tool` for deterministic execution |
| `command-tool` | string | null | Tool name when command-dispatch is `tool` |
| `command-arg-mode` | string | `raw` | Argument passing mode for tool dispatch |
| `homepage` | string | null | URL for skill documentation |
| `metadata` | object | `{}` | OpenClaw-compatible nested metadata |

### Metadata Object

The `metadata` field supports OpenClaw-style nested configuration:

```yaml
metadata:
  {
    'tags': 'coding, python',
    'version': '1.0.0',
    'openclaw':
      {
        'requires': { 'bins': ['python'], 'env': ['PYTHON_PATH'] },
        'install': [{ 'kind': 'brew', 'formula': 'python' }],
      },
  }
```

### Built-In Skills

Built-in skills are configured in `skills/skills.json`.

- `humanizer`: transforms AI-generated text to sound more natural and human.
- `weather-guide`: explains weather reports and meteorological terminology.

Each built-in skill source lives in `skills/<name>/SKILL.md`.

### Importing Skills

- From skills.sh: paste the skill URL into Prompt Paul Options -> Import from skills.sh.
- From file: export skills from another Prompt Paul instance, then import the JSON file from Options -> Import Skills.
- Manual import: create a `SKILL.md` file and place it in the skills directory, or create it via the Options page.

### Troubleshooting Skills

- If a skill does not appear in `/skills`, check `disable-model-invocation`, frontmatter validity, and extension reload state.
- If a slash command does not work, check `user-invocable`, lowercase hyphenated names, and save/load state.
- If metadata is not preserved, check YAML formatting and JSON syntax inside `metadata`.

### OpenClaw Compatibility

- `SKILL.md` format uses standard Agent Skills frontmatter.
- Metadata supports `metadata.openclaw.*`.
- Skills can specify required binaries or environment variables.
- Metadata can include installation instructions.

### Skill Resolution Flow

1. User enters `/skill <name> ...` or matching intent.
2. `chat.js` parses command or intent and resolves skill name.
3. Request is sent to `background.js`.
4. `SkillManager` resolves skill content and metadata.
5. `RunOrchestrator` injects skill instructions into runtime context.
6. Model response is generated with skill guidance applied.

### Skill Manager API

```javascript
const skills = skillManager.getSkillsList();
const eligible = skillManager.getEligibleSnapshot();
const skill = skillManager.resolveSkill('humanizer');
const commands = skillManager.getSlashCommands();
```

### Deterministic Tool-Dispatched Skills

1. Set `command-dispatch: "tool"`.
2. Set `command-tool: "your-tool-name"`.
3. Implement the tool dispatch handling in orchestrator or runtime code.

## User Preferences

When the user requests a durable behavior change, record it here or in the relevant child AGENTS.md.

## Child DOX Index

- `docs/AGENTS.md`: documentation files, user guides, architecture notes, and development workflow docs.
- `src/AGENTS.md`: source modules shared by extension entry points, with deeper contracts for chat, utilities, and orchestration.
- `scripts/AGENTS.md`: build, smoke, and test scripts.
- `skills/AGENTS.md`: built-in skill registry and `SKILL.md` source files.
- `libs/AGENTS.md`: vendored browser libraries and third-party assets.
- `icons/AGENTS.md`: extension icons and copy/action image assets.

# Agent Skills Documentation

Prompt Paul implements an OpenClaw-compatible Agent Skills system for specialized AI capabilities.

This file is the canonical **specification reference** for skill format, metadata, and runtime behavior.
For end-user examples and workflows, see `docs/SKILL_EXAMPLES.md`.

## Quick Start

### Using Skills in Chat

1. **List all skills**: `/skills`
2. **Invoke canonical command**: `/skill <name> [input]`
3. **Invoke per-skill shortcut** (user-invocable only): `/<skill-name> [input]`
4. **Natural language trigger**: `use <skill> skill and [your request]`

### Supported Skill Intent Patterns

| Pattern | Example | Status |
|---|---|---|
| `use /<skill>` | `use /humanizer and rewrite` | supported |
| `use <skill> skill` | `use humanizer skill and rewrite` | supported |
| `apply /<skill>` | `apply /summarizer to this` | supported |
| `with /<skill>` | `with /humanizer, rewrite this` | supported |
| `invoke /<skill>` | `invoke /weather-guide explain forecast` | supported |
| `use <skill> and/to/for` | `use humanizer and rewrite` | supported |
| `please use <skill> to` | `please use humanizer to rewrite` | supported |

## Skill Specification

Skills follow the Agent Skills specification with YAML frontmatter.

```markdown
---
name: "skill-name"
description: "Brief description of what this skill does"
license: "MIT"
user-invocable: true
disable-model-invocation: false
metadata:
  {"tags": "category", "version": "1.0.0"}
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
|-------|------|---------|-------------|
| `name` | string | required | Unique identifier (lowercase, hyphens allowed) |
| `description` | string | required | Brief description for AI and user discovery |
| `license` | string | optional | License identifier (for example MIT, Apache-2.0) |
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
    "tags": "coding, python",
    "version": "1.0.0",
    "openclaw": {
      "requires": {
        "bins": ["python"],
        "env": ["PYTHON_PATH"]
      },
      "install": [
        {"kind": "brew", "formula": "python"}
      ]
    }
  }
```

## Built-in Skills

Configured in `skills/skills.json`.

- **humanizer**: transforms AI-generated text to sound more natural and human.
- **weather-guide**: explains weather reports and meteorological terminology.

Each built-in skill source lives in `skills/<name>/SKILL.md`.

## Importing Skills

### From skills.sh

1. Find a skill on [skills.sh](https://skills.sh)
2. Copy the skill URL (`https://skills.sh/owner/repo/skill-name`)
3. Paste in Prompt Paul Options -> Import from skills.sh
4. Click **Import**

### From File

1. Export skills from another Prompt Paul instance
2. Go to Options -> Import Skills
3. Select the JSON file
4. Skills are imported and validated

### Manual Import

Create a `SKILL.md` file and place it in the skills directory, or create it via the Options page.

## Troubleshooting

### Skill Not Appearing in /skills

- Check that `disable-model-invocation` is not `true`
- Verify frontmatter is valid
- Reload the extension

### Slash Command Not Working

- Ensure skill is marked as `user-invocable: true`
- Check that skill name uses lowercase/hyphen format
- Verify the skill is saved and loaded

### Metadata Not Preserved

- Ensure metadata is valid JSON
- Check YAML formatting in frontmatter
- Verify no JSON syntax errors

## OpenClaw Compatibility

Prompt Paul skills are compatible with the OpenClaw ecosystem:

- **SKILL.md format**: standard Agent Skills frontmatter
- **Metadata**: supports OpenClaw `metadata.openclaw.*` structure
- **Gating**: skills can specify required binaries/environment variables
- **Installers**: metadata can include installation instructions

## For Developers

### Skill Resolution Flow

1. User enters `/skill <name> ...` or matching intent
2. `chat.js` parses command/intent and resolves skill name
3. Request is sent to `background.js`
4. SkillManager resolves skill content and metadata
5. Orchestrator injects skill instructions into runtime context
6. Model response is generated with skill guidance applied

### Skill Manager API

```javascript
const skills = skillManager.getSkillsList();
const eligible = skillManager.getEligibleSnapshot();
const skill = skillManager.resolveSkill("humanizer");
const commands = skillManager.getSlashCommands();
```

### Extending Skills

To enable deterministic tool-dispatched skills:

1. Set `command-dispatch: "tool"`
2. Set `command-tool: "your-tool-name"`
3. Implement the tool dispatch handling in orchestrator/runtime code

---

Prompt Paul Agent Skills - OpenClaw Compatible
Documentation Version: 1.1

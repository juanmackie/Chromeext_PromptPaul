# Agent Skills Documentation

Prompt Paul implements an OpenClaw-compatible Agent Skills system for specialized AI capabilities.

## Quick Start

### Using Skills in Chat

1. **List all skills**: Type `/skills` in the chat
2. **Invoke by canonical command**: `/skill <name> [your input]`
3. **Quick command (user-invocable skills)**: `/<skill-name> [your input]`
4. **Natural language**: `use <skill> skill and [your request]`

### Example Commands

```
/skill humanizer Make this sound more natural: "The implementation will require resources."
/humanizer Rewrite this text to be more conversational
use humanizer skill and make this paragraph less formal
/skill weather-guide Explain this forecast: "Scattered showers with isolated thunderstorms"
```

## Skill Specification

Skills follow the Agent Skills specification with YAML frontmatter:

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
| `license` | string | optional | License identifier (e.g., MIT, Apache-2.0) |
| `user-invocable` | boolean | true | Creates `/name` shortcut command when true |
| `disable-model-invocation` | boolean | false | Hides from AI auto-suggestions when true |
| `command-dispatch` | enum | null | Set to "tool" for deterministic execution |
| `command-tool` | string | null | Tool name when command-dispatch is "tool" |
| `command-arg-mode` | string | "raw" | Argument passing mode for tool dispatch |
| `homepage` | string | null | URL for skill documentation |
| `metadata` | object | {} | OpenClaw-compatible nested metadata |

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

### humanizer
Transforms AI-generated text to sound more natural and human.

**Invocation:**
```
/humanizer Make this sound more natural: "The implementation will require resources."
/skill humanizer Rewrite this text to be more conversational
```

**Behavior:**
- Varies sentence structure
- Uses contractions
- Adds natural imperfections
- Removes AI tells ("Furthermore", "In conclusion")
- Injects personality

### weather-guide
A guide for understanding weather reports and terminology.

**Invocation:**
```
/weather-guide Explain this forecast: "Scattered showers with isolated thunderstorms"
/skill weather-guide What does "barometric pressure" mean?
```

**Behavior:**
- Explains weather terminology
- Interprets forecasts
- Provides context for conditions

## Creating Custom Skills

1. Open Prompt Paul **Options**
2. Navigate to **Agent Skills** section
3. Click **Add/Edit Skill**
4. Fill in required fields:
   - **Skill Name**: Unique identifier (e.g., `my-custom-skill`)
   - **Description**: What it does
   - **Instructions**: Detailed markdown instructions
5. Configure optional fields:
   - **User Invocable**: Check to create `/skillname` command
   - **Disable Model Invocation**: Check to hide from AI suggestions
   - **Metadata**: JSON object for additional configuration
6. Click **Save Skill**

### Skill Authoring Best Practices

1. **Be specific** in instructions - the AI follows them exactly
2. **Include examples** showing input/output pairs
3. **Define scope clearly** - what the skill does and doesn't do
4. **Use user-invocable** for skills users invoke frequently
5. **Set disable-model-invocation** for skills only meant for explicit use
6. **Test thoroughly** before relying on the skill

### Skill Templates

#### Basic Skill
```markdown
---
name: "summarizer"
description: "Summarize text into key points"
user-invocable: true
---

# Summarizer

## Purpose
Extract the most important points from text.

## Guidelines
1. Identify 3-5 key points
2. Use bullet format
3. Maintain original meaning
4. Remove fluff words

## Output Format
- Point 1
- Point 2
- Point 3
```

#### Advanced Skill with Metadata
```markdown
---
name: "code-reviewer"
description: "Review code for best practices and bugs"
user-invocable: true
disable-model-invocation: false
metadata:
  {"language": "javascript", "tags": "code, review"}
---

# Code Reviewer

## Purpose
Review code and provide constructive feedback.

## Guidelines
1. Check for bugs and edge cases
2. Suggest performance improvements
3. Verify error handling
4. Comment on code style

## Review Format
**Issues:** List any bugs or problems
**Suggestions:** Improvements that could be made
**Style:** Notes on code style and conventions
```

## Importing Skills

### From skills.sh

1. Find a skill on [skills.sh](https://skills.sh)
2. Copy the skill URL: `https://skills.sh/owner/repo/skill-name`
3. Paste in Prompt Paul Options → Import from skills.sh
4. Click **Import**

### From File

1. Export skills from another Prompt Paul instance
2. Go to Options → Import Skills
3. Select the JSON file
4. Skills are imported and validated

### Manual Import

Create a `SKILL.md` file and place it in the skills directory, or use the Options page to create it manually.

## Troubleshooting

### Skill Not Appearing in /skills
- Check that `disable-model-invocation` is not `true`
- Verify the skill has valid frontmatter
- Restart the extension to refresh

### Slash Command Not Working
- Ensure skill is marked as `user-invocable: true`
- Check that skill name has no spaces (use hyphens)
- Verify the skill is saved and loaded

### Skill Instructions Not Being Followed
- Check that instructions are clear and specific
- Verify the SKILL.md format is correct
- Try invoking explicitly with `/skill name` instead of natural language

### Metadata Not Preserved
- Ensure metadata is valid JSON
- Check for proper YAML formatting in frontmatter
- Verify no syntax errors in the JSON object

## OpenClaw Compatibility

Prompt Paul skills are designed to be compatible with the OpenClaw ecosystem:

- **SKILL.md format**: Standard Agent Skills frontmatter
- **Metadata**: Supports OpenClaw `metadata.openclaw.*` structure
- **Gating**: Skills can specify requirements (bins, env vars)
- **Installers**: Metadata can include installation instructions

Skills created for Prompt Paul can be shared with OpenClaw users and vice versa, with full metadata preservation.

## For Developers

### Skill Resolution Flow

1. User types `/skill humanizer rewrite this`
2. Chat.js parses command and extracts skill name
3. Request sent to background.js with `requestedSkill: "humanizer"`
4. RunOrchestrator resolves skill and injects instructions
5. Instructions added to conversation context
6. AI generates response following skill guidelines

### Skill Manager API

```javascript
// Get all skills with metadata
const skills = skillManager.getSkillsList();

// Get eligible skills (not disable-model-invocation)
const eligible = skillManager.getEligibleSnapshot();

// Resolve specific skill
const skill = skillManager.resolveSkill("humanizer");

// Get user-invocable slash commands
const commands = skillManager.getSlashCommands();
```

### Extending Skills

Skills can be extended with custom behavior by:

1. Setting `command-dispatch: "tool"`
2. Specifying `command-tool: "your-tool-name"`
3. Implementing the tool in `RunOrchestrator.js`

This enables deterministic skill execution that bypasses the AI model entirely.

---

*Prompt Paul Agent Skills - OpenClaw Compatible*  
*Documentation Version: 1.0*

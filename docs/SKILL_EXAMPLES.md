# Skill Usage Examples

This guide shows how to use Prompt Paul's Agent Skills system.

For the full skill specification, see [AGENTS.md](../AGENTS.md).

## Commands

Canonical command:

```text
/skill <name> [input]
```

Examples:

```text
/skill humanizer Make this sound more natural.
/skill weather-guide Explain what dew point means.
/skill humanizer Rewrite this paragraph in a warmer tone.
```

Shortcut command for user-invocable skills:

```text
/<skill-name> [input]
```

Examples:

```text
/humanizer Make this sound less robotic.
/weather-guide What does a 70 F dew point feel like?
```

Natural language triggers:

```text
use humanizer skill and rewrite this paragraph
apply humanizer to this message
with weather-guide, explain this forecast
```

## Import and Export

Custom skill imports and exports use the canonical v2 Agent Skills format: an object with
`version: '2.0'` and a `skills` array whose entries contain `skillMd` frontmatter and instructions.
Legacy arrays and field-based skill records are not imported.

## Working With Context

- Use `/skill humanizer` on text you pasted or selected
- Load page content first, then ask the skill to work on that page
- Use `/skills` to list available skills before choosing one

## Example Custom Skill

```markdown
---
name: 'code-reviewer'
description: 'Reviews code for correctness, maintainability, and obvious risks'
license: 'MIT'
user-invocable: true
metadata: { 'tags': 'coding, review' }
---

# Code Reviewer

## Purpose

Review code and point out defects, regressions, or missing tests.

## Guidelines

1. Check for correctness first
2. Call out unclear or redundant logic
3. Identify missing edge-case handling
4. Keep suggestions concrete and actionable

## Output

Return a focused review with the highest-priority issues first.
```

## Quick Reference

```text
/skills
/skill <name> [input]
/<skill-name> [input]
```

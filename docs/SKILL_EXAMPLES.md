# Skill Usage Examples

This document provides comprehensive examples of using Prompt Paul's Agent Skills system.

## Table of Contents

1. [Basic Skill Invocation](#basic-skill-invocation)
2. [Advanced Skill Usage](#advanced-skill-usage)
3. [Creating Custom Skills](#creating-custom-skills)
4. [Real-World Scenarios](#real-world-scenarios)

---

## Basic Skill Invocation

### Method 1: Canonical Slash Command (Always Works)

The `/skill` command is the canonical way to invoke any skill.

```
/skill <name> [your input here]
```

**Examples:**
```
/skill humanizer Make this sound more natural: "The implementation will require resources."
/skill weather-guide Explain what "dew point" means
/skill summarizer Summarize this article in 3 bullet points: [paste text]
```

### Method 2: Per-Skill Shortcut Command

For skills marked as `user-invocable: true`, you can use a shortcut:

```
/<skill-name> [your input here]
```

**Examples:**
```
/humanizer Make this sound more natural
/weather-guide What does "barometric pressure" mean?
/summarizer Summarize the selected text
```

### Method 3: Natural Language Detection

Prompt Paul can detect skill intent from natural language:

```
use <skill> skill and [your request]
apply <skill> skill to [content]
invoke <skill> skill for [task]
```

**Examples:**
```
use humanizer skill and make this paragraph less formal
apply summarizer skill to this article
invoke weather-guide skill to explain this forecast
```

---

## Advanced Skill Usage

### Combining Skills with Context

**With selected text:**
1. Select text on any webpage
2. Right-click → "Process with Prompt Paul"
3. In the instruction box: `/skill humanizer rewrite the selected text`
4. Submit

**With loaded content:**
1. Click "Load Content" in the chat sidebar
2. The page content is now in context
3. Type: `/skill summarizer Summarize the loaded content into 3 bullet points`

### Chaining Multiple Skills

You can chain skills by using the output of one as input to another:

```
User: /skill summarizer Summarize this paragraph: "Long paragraph here..."
AI: [Provides bullet-point summary]
User: /skill humanizer Make that summary sound more conversational
AI: [Rewrites summary in natural language]
```

---

## Creating Custom Skills

### Example 1: Code Review Skill

```markdown
---
name: "code-reviewer"
description: "Reviews code for best practices, bugs, and style issues"
license: "MIT"
user-invocable: true
metadata:
  {"tags": "coding, review", "languages": "javascript, python"}
---

# Code Reviewer

## Purpose
Provide thorough code reviews focusing on correctness, performance, and maintainability.

## Guidelines
1. Check for syntax errors and runtime exceptions
2. Identify potential security vulnerabilities
3. Review error handling and edge cases
4. Assess code readability and naming conventions
5. Suggest performance optimizations

## Review Format
**Issues:** [Critical/High/Medium/Low] - Description and suggested fix
**Suggestions:** Improvements that enhance code quality
**Style:** Notes on formatting, naming, and conventions
**Performance:** Optimization opportunities
**Security:** Security concerns and mitigations
```

**How to use:**
```
/code-reviewer Review this function: [paste code]
/skill code-reviewer Check for security issues in: [paste code]
```

### Example 2: Email Writer Skill

```markdown
---
name: "email-writer"
description: "Drafts professional emails with appropriate tone and structure"
license: "MIT"
user-invocable: true
metadata:
  {"tags": "writing, email, professional"}
---

# Email Writer

## Purpose
Create well-structured, professional emails appropriate for business communication.

## Guidelines
1. Start with appropriate greeting (Dear, Hello, Hi)
2. State purpose clearly in opening paragraph
3. Use bullet points for multiple items
4. Include clear call-to-action
5. End with professional sign-off

## Output Format
```
Subject: [Clear, concise subject line]

Dear [Recipient],

[Opening: Context and purpose]

[Body: Details, requests, or information]

[Closing: Next steps and call-to-action]

Best regards,
[Your name]
```
```

**How to use:**
```
/email-writer Write a follow-up email to the client about the project delay
/skill email-writer Draft a meeting request for the project kickoff
```

### Example 3: Technical Explainer Skill

```markdown
---
name: "tech-explainer"
description: "Explains technical concepts to non-technical audiences"
license: "MIT"
user-invocable: true
metadata:
  {"tags": "education, technical, communication"}
---

# Technical Explainer

## Purpose
Translate complex technical concepts into clear, accessible explanations.

## Guidelines
1. Use analogies and real-world comparisons
2. Avoid jargon or explain it immediately
3. Start with the "why" before the "how"
4. Use concrete examples, not abstract concepts
5. Structure: Concept → Analogy → Example → Application

## Explanation Framework
1. **The Big Picture**: Why does this matter?
2. **The Analogy**: What is it like in everyday life?
3. **How It Works**: Simple technical explanation
4. **Real Example**: Concrete use case
5. **Business Value**: Why stakeholders should care
```

**How to use:**
```
/tech-explainer Explain what blockchain is to my manager
/skill tech-explainer Explain cloud computing vs on-premise servers
```

---

## Real-World Scenarios

### Scenario 1: Content Creation Workflow

**User is writing a blog post and needs help:**

1. **Research phase:**
   ```
   User: /skill summarizer Summarize these 3 articles about AI trends
   AI: [Provides condensed summaries]
   ```

2. **Drafting phase:**
   ```
   User: [Writes rough draft]
   User: /skill humanizer Make this introduction more engaging
   AI: [Rewrites in conversational tone]
   ```

3. **Editing phase:**
   ```
   User: /skill code-reviewer Check this Python script I embedded in the post
   AI: [Reviews code and suggests improvements]
   ```

4. **Final polish:**
   ```
   User: /skill summarizer Create a 2-sentence summary for the meta description
   AI: [Provides concise summary]
   ```

### Scenario 2: Developer Debugging Session

**Developer encounters an error:**

1. **Paste error message:**
   ```
   User: I'm getting this error: "TypeError: Cannot read property 'map' of undefined"
   AI: [General explanation]
   ```

2. **Add context with code:**
   ```
   User: Here's the code: [paste code]
   User: /skill code-reviewer Identify why this map function is failing
   AI: [Specific analysis with fix]
   ```

3. **Get explanation for team:**
   ```
   User: /skill tech-explainer Explain this bug and fix to my non-technical PM
   AI: [Business-friendly explanation]
   ```

### Scenario 3: Business Communication

**Preparing for an important meeting:**

1. **Draft agenda:**
   ```
   User: /skill email-writer Write a meeting agenda email for the quarterly review
   AI: [Professional email with clear agenda]
   ```

2. **Prepare presentation:**
   ```
   User: /skill summarizer Convert these 10 pages of data into 5 key slides
   AI: [Bullet-point summaries]
   ```

3. **Practice explanation:**
   ```
   User: /skill tech-explainer How do I explain our new API strategy to executives?
   AI: [Executive-friendly explanation]
   ```

---

## Quick Reference Card

### Commands
```
/skills                    # List all skills
/skill <name> [input]     # Invoke any skill (canonical)
/<skill-name> [input]     # Invoke user-invocable skill (shortcut)
```

### Frontmatter Template
```markdown
---
name: "your-skill-name"
description: "What this skill does"
user-invocable: true
disable-model-invocation: false
metadata:
  {"tags": "category", "version": "1.0.0"}
---
```

---

*For more information, see [AGENTS.md](AGENTS.md) for complete skill specification.*

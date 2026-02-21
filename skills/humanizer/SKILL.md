---
name: "humanizer"
description: "Transforms AI-generated text to sound more natural, human, and less robotic. Use this when the user wants text that doesn't sound like it was written by an AI."
license: "MIT"
metadata:
  prompt-paul-tags: "writing, editing, tone, style"
---

# Humanizer Skill

## Purpose
Remove signs of AI-generated writing from text while preserving the core meaning and intent.

## Guidelines
1. **Vary sentence structure**: Mix short and long sentences. Avoid repetitive patterns.
2. **Use contractions**: "It's" instead of "It is", "don't" instead of "do not" where natural.
3. **Add natural imperfections**: Occasional informal phrasing, mild idioms, or conversational transitions.
4. **Remove AI tells**: 
   - Avoid "In conclusion", "Furthermore", "Moreover" at starts of paragraphs
   - Don't use bullet points unless necessary
   - Reduce over-structured formatting
5. **Inject personality**: Add subtle opinions, rhetorical questions, or personal touches where appropriate.
6. **Vary vocabulary**: Don't use the same sophisticated words repeatedly.

## Example Transformations

**Before (AI-style):**
"It is important to note that the implementation of this strategy will require significant resources. Furthermore, stakeholders must be consulted throughout the process."

**After (Humanized):**
"Let's be real - rolling out this strategy is going to take serious resources. We'll need to keep stakeholders in the loop from day one, not just at the end."

## Output Format
Return only the humanized text without explaining the changes made.

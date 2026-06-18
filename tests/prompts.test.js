import { describe, it, expect } from 'vitest';
import { composeUserPrompt } from '../src/prompts.js';

describe('composeUserPrompt', () => {
  it('returns a plain instruction unchanged when there is no context', () => {
    const result = composeUserPrompt({ instruction: 'Summarize this.' });

    expect(result).toBe('Summarize this.');
  });

  it('wraps selected text with explicit context boundaries', () => {
    const result = composeUserPrompt({
      instruction: 'Explain this.',
      context: {
        type: 'selected_text',
        text: 'Selected content',
      },
    });

    expect(result).toContain('--- Selected text ---');
    expect(result).toContain('Selected content');
    expect(result).toContain('--- End Selected text ---');
  });

  it('keeps reply instructions separate from email source material', () => {
    const result = composeUserPrompt({
      instruction: 'Compose an informal yet professional reply to the below business email.',
      context: {
        type: 'selected_text',
        text: 'Good afternoon team,\n\nI have tried to call as many as possible.',
      },
    });

    expect(result).toContain('Compose an informal yet professional reply');
    expect(result).toContain('--- Selected text ---');
    expect(result).toContain('Good afternoon team');
    expect(result).toContain('Do not continue or imitate the context author or sender');
    expect(result).toContain('write from the user perspective');
  });

  it('wraps page content as page context', () => {
    const result = composeUserPrompt({
      instruction: 'Provide an executive summary.',
      context: {
        type: 'page_content',
        text: 'Page body',
      },
    });

    expect(result).toContain('--- Page content ---');
    expect(result).toContain('Page body');
    expect(result).toContain('Use the context as source material for the task');
  });

  it('labels previous-response follow-ups without selected text boundaries', () => {
    const result = composeUserPrompt({
      instruction: 'Make that shorter.',
      context: {
        type: 'previous_response',
      },
    });

    expect(result).toContain('Context: Apply this task to the previous assistant response');
    expect(result).not.toContain('--- Selected text ---');
  });

  it('does not wrap media context with boundaries (media is attached separately)', () => {
    const result = composeUserPrompt({
      instruction: 'Analyze this image.',
      context: {
        type: 'media',
      },
    });

    expect(result).toBe('Analyze this image.');
  });
});

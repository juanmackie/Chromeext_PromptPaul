import { describe, expect, it } from 'vitest';
import { buildHermesTurn, resolveHistoryBudget } from '../src/utils/hermesContext.js';

describe('Hermes context preparation', () => {
  it('replays page context and earlier answers on a follow-up without duplicating the current question', () => {
    const result = buildHermesTurn([
      {
        role: 'user',
        content: 'Loaded page data: Asset A passed; Asset B failed.',
        _promptPaulContext: { type: 'page_content' },
      },
      { role: 'user', content: 'Which asset failed?' },
      { role: 'assistant', content: 'Asset B failed.' },
      { role: 'user', content: 'Was it repaired?' },
    ]);

    expect(result.input).toBe('Was it repaired?');
    expect(result.conversationHistory).toEqual([
      { role: 'user', content: 'Loaded page data: Asset A passed; Asset B failed.' },
      { role: 'user', content: 'Which asset failed?' },
      { role: 'assistant', content: 'Asset B failed.' },
    ]);
  });

  it('keeps current-turn multimodal input but removes old image data from history', () => {
    const result = buildHermesTurn([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Describe this image.' },
          { type: 'image_url', image_url: { url: 'data:image/png;base64,secret' } },
        ],
      },
      { role: 'assistant', content: 'It shows a chart.' },
      { role: 'user', content: 'What trend did you see?' },
    ]);

    expect(result.input).toBe('What trend did you see?');
    expect(result.conversationHistory).toEqual([
      { role: 'user', content: 'Describe this image.' },
      { role: 'assistant', content: 'It shows a chart.' },
    ]);
    expect(JSON.stringify(result.conversationHistory)).not.toContain('data:image');
  });

  it('keeps the bounded history below the default unknown-model input budget', () => {
    const result = buildHermesTurn([
      { role: 'user', content: 'x'.repeat(220000), _promptPaulContext: { type: 'page_content' } },
      { role: 'assistant', content: 'Earlier answer.' },
      { role: 'user', content: 'Follow up.' },
    ]);

    expect(resolveHistoryBudget()).toBe(49000);
    expect(result.conversationHistory[0].content.length).toBeLessThan(220000);
  });

  it('uses the larger reserved budget when Hermes identifies a large-context model', () => {
    expect(resolveHistoryBudget({ modelId: 'gpt-5.2' })).toBe(113000);
    expect(resolveHistoryBudget({ modelId: 'mini-fast' })).toBe(49000);
  });
});

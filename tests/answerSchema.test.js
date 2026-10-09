import { describe, expect, it } from 'vitest';
import {
  createAnswerCardDecoder,
  createAnswerCardProgressiveParser,
  normalizeAnswerCards,
  validateAnswerCards,
} from '../src/utils/answerSchema.js';

const cards = {
  version: 1,
  blocks: [
    {
      type: 'summary',
      title: 'Summary',
      text: 'A short summary.',
      points: ['First point'],
      sourceIds: ['src-1'],
    },
    {
      type: 'comparison',
      title: 'Options',
      columns: ['Feature', 'A', 'B'],
      rows: [['Cost', '$1', '$2']],
    },
  ],
};

function wire(payload = cards, answer = 'Readable Markdown answer.') {
  return `${answer}\n\n${'```'}promptpaul-cards\n${JSON.stringify(payload)}\n${'```'}`;
}

describe('answer card schema', () => {
  it('projects only allowed block fields and resolves source ids against host sources', () => {
    const result = normalizeAnswerCards(wire(), { sources: [{ id: 'src-1' }] });
    expect(result).toEqual({
      content: 'Readable Markdown answer.',
      answerCards: cards,
      status: 'valid',
    });
    expect(
      validateAnswerCards({ ...cards, extra: true }, { sources: [{ id: 'src-1' }] })
    ).toBeNull();
    expect(
      validateAnswerCards(
        { ...cards, blocks: [{ ...cards.blocks[0], sourceIds: ['https://attacker.test'] }] },
        { sources: [{ id: 'src-1' }] }
      )
    ).toBeNull();
  });

  it('rejects unknown constructs, inconsistent tables, oversized blocks and text', () => {
    expect(
      validateAnswerCards({
        version: 1,
        blocks: [{ type: 'summary', title: 'x', text: 'x', points: [], html: '<img>' }],
      })
    ).toBeNull();
    expect(
      validateAnswerCards({
        version: 1,
        blocks: [{ type: 'comparison', title: 'x', columns: ['A', 'B'], rows: [['only one']] }],
      })
    ).toBeNull();
    expect(
      validateAnswerCards({ version: 1, blocks: Array.from({ length: 13 }, () => cards.blocks[0]) })
    ).toBeNull();
    expect(
      validateAnswerCards({
        version: 1,
        blocks: [{ type: 'summary', title: 'x', text: 'x'.repeat(2_001), points: [] }],
      })
    ).toBeNull();
  });

  it('handles quoted brackets in depth scanning and rejects deep or oversized JSON', () => {
    const quoted = {
      version: 1,
      blocks: [{ type: 'summary', title: '[{ not nesting', text: 'Readable', points: [] }],
    };
    expect(normalizeAnswerCards(wire(quoted)).answerCards).not.toBeNull();
    const deep = '{"version":1,"blocks":[],"x":' + '['.repeat(8) + '0' + ']'.repeat(8) + '}';
    expect(
      normalizeAnswerCards(`Readable\n\n${'```'}promptpaul-cards\n${deep}\n${'```'}`).status
    ).toBe('invalid');
    const huge = { version: 1, blocks: [], note: 'x'.repeat(33 * 1024) };
    expect(normalizeAnswerCards(wire(huge)).status).toBe('oversized');
  });

  it('keeps malformed, incomplete, bare, and payload-only structures out of readable content', () => {
    expect(normalizeAnswerCards(wire('not json')).content).toBe('Readable Markdown answer.');
    expect(normalizeAnswerCards(`Readable\n\n${'```'}promptpaul-cards\n{"version":1`).content).toBe(
      'Readable'
    );
    expect(normalizeAnswerCards(wire(cards, '')).status).toBe('missing_fallback');
    expect(normalizeAnswerCards(JSON.stringify(cards)).content).toBe(
      'The response did not include a readable answer.'
    );
    expect(normalizeAnswerCards('Readable\n```promptpaul-card').content).toBe('Readable');
  });

  it('uses a readable fallback for incomplete or oversized card frames with no prefix', () => {
    const fallback = 'The response did not include a readable answer.';
    const incompleteFrames = [
      '```promptpaul-card',
      '```promptpaul-cards\n{"version":1,"blocks":[',
      wire(cards, ''),
    ];
    for (const frame of incompleteFrames) {
      expect(normalizeAnswerCards(frame)).toMatchObject({
        content: fallback,
        answerCards: null,
        status: 'missing_fallback',
      });
    }

    const oversized = `\`\`\`promptpaul-cards\n{"version":1,"blocks":[],"extra":"${'x'.repeat(33 * 1024)}"}\n\`\`\``;
    expect(normalizeAnswerCards(oversized)).toMatchObject({
      content: fallback,
      answerCards: null,
      status: 'missing_fallback',
    });
  });

  it('uses standalone closing fences and scrubs later tagged payloads', () => {
    const valueWithFence = {
      version: 1,
      blocks: [{ type: 'summary', title: '``` inside a value', text: 'Safe', points: [] }],
    };
    const crlfWire = wire(valueWithFence).replaceAll('\n', '\r\n');
    expect(normalizeAnswerCards(crlfWire)).toMatchObject({ status: 'valid' });

    const second = wire(cards, '');
    const combined = `${wire(cards)}\n\nMore readable text\n\n${second}`;
    const normalized = normalizeAnswerCards(combined);
    expect(normalized.answerCards).toBeNull();
    expect(normalized.content).toContain('More readable text');
    expect(normalized.content).not.toContain('promptpaul-cards');
  });
});

describe('answer card stream framing', () => {
  it('strips a tagged section across every important fence split and leaves ordinary fences intact', () => {
    const input = `One\n${'```'}js\nconst x = 1;\n${'```'}\n${'```'}promptpaul-cards\n${JSON.stringify(cards)}\n${'```'}`;
    for (let split = 0; split <= input.length; split += 1) {
      const decoder = createAnswerCardDecoder();
      const output =
        decoder.push(input.slice(0, split)) + decoder.push(input.slice(split)) + decoder.finish();
      expect(output).toBe(`One\n${'```'}js\nconst x = 1;\n${'```'}\n`);
    }
  });

  it('tracks line starts across chunks and preserves an inline lookalike', () => {
    const decoder = createAnswerCardDecoder();
    const visible =
      decoder.push('Inline ') + decoder.push('```promptpaul-cards') + decoder.finish();
    expect(visible).toBe('Inline ```promptpaul-cards');
  });

  it('hides a partial tagged marker on finish and resets cleanly', () => {
    const decoder = createAnswerCardDecoder();
    expect(decoder.push('Readable\n```promptpaul-card')).toBe('Readable\n');
    expect(decoder.finish()).toBe('');
    decoder.reset();
    expect(decoder.push('New answer')).toBe('New answer');
  });

  it('withholds a leading bare answer envelope and preserves unrelated JSON prose', () => {
    const cardsDecoder = createAnswerCardDecoder();
    const bare = '{"version":1,"blocks":[]}';
    expect(cardsDecoder.push(bare)).toBe('');
    expect(cardsDecoder.finish()).toBe('');
    const jsonDecoder = createAnswerCardDecoder();
    expect(jsonDecoder.push('{"message":"hello"}')).toBe('');
    expect(jsonDecoder.finish()).toBe('{"message":"hello"}');
  });

  it('resumes readable output after a misplaced nonterminal envelope', () => {
    const decoder = createAnswerCardDecoder();
    const input = `Answer\n${'```'}promptpaul-cards\n{"version":1}\n${'```'}\nMore after tools`;
    const visible =
      decoder.push(input.slice(0, 35)) + decoder.push(input.slice(35)) + decoder.finish();
    expect(visible).toBe('Answer\n\nMore after tools');
    expect(normalizeAnswerCards(input).content).toBe('Answer\nMore after tools');
  });

  it('handles split opening and closing markers with CRLF boundaries', () => {
    const decoder = createAnswerCardDecoder();
    const input = `Answer\r\n\r\n${'```'}promptpaul-cards\r\n${JSON.stringify(cards)}\r\n${'```'}\r\n`;
    let output = '';
    for (const piece of input.match(/.{1,7}/gs) || []) output += decoder.push(piece);
    output += decoder.finish();
    expect(output).toBe('Answer\r\n\r\n');
    expect(normalizeAnswerCards(input, { sources: [{ id: 'src-1' }] })).toMatchObject({
      status: 'valid',
    });
  });

  it('preserves an ordinary code fence whose closing delimiter is the final chunk', () => {
    const decoder = createAnswerCardDecoder();
    const input = `${'```'}js\nconst value = 1;\n${'```'}`;
    expect(decoder.push(input)).toBe(`${'```'}js\nconst value = 1;\n`);
    expect(decoder.finish()).toBe('```');
  });
});

describe('progressive answer cards', () => {
  it('emits only complete valid block prefixes across small chunks', () => {
    const parser = createAnswerCardProgressiveParser({ sources: [{ id: 'src-1' }] });
    const input = wire();
    const updates = [];
    for (const chunk of input.match(/.{1,5}/gs) || []) {
      const update = parser.push(chunk);
      if (update) updates.push(update);
    }
    expect(updates).toHaveLength(2);
    expect(updates[0].blocks).toHaveLength(1);
    expect(updates[0].blocks[0].type).toBe('summary');
    expect(updates[1]).toEqual(cards);
  });

  it('waits for readable fallback and invalidates prior cards on malformed or oversized tails', () => {
    const noFallback = createAnswerCardProgressiveParser();
    expect(noFallback.push(`${'```'}promptpaul-cards\n${JSON.stringify(cards)}\n${'```'}`)).toBe(
      null
    );

    const parser = createAnswerCardProgressiveParser({ sources: [{ id: 'src-1' }] });
    const prefix = `Fallback\n${'```'}promptpaul-cards\n{"version":1,"blocks":[${JSON.stringify(cards.blocks[0])}`;
    expect(parser.push(prefix)?.blocks).toHaveLength(1);
    expect(parser.push(',{"type":"unknown","title":"x"}')).toMatchObject({ invalid: true });

    parser.reset({ sources: [{ id: 'src-1' }] });
    expect(parser.push(prefix)?.blocks).toHaveLength(1);
    expect(parser.push(' '.repeat(33 * 1024))).toMatchObject({ invalid: true });
  });

  it('invalidates a preview when the block list or root JSON structure becomes malformed', () => {
    const firstBlock = JSON.stringify(cards.blocks[0]);
    const prefix = `Fallback\n${'```'}promptpaul-cards\n{"version":1,"blocks":[${firstBlock}`;
    for (const malformedTail of [
      `${firstBlock}]}`, // missing comma between blocks
      `,,${firstBlock}]}`, // repeated separator
      `,]}`, // trailing comma
      `]} ,"unexpected":true}`, // unknown root key after the block list
    ]) {
      const parser = createAnswerCardProgressiveParser({ sources: [{ id: 'src-1' }] });
      expect(parser.push(prefix)?.blocks).toHaveLength(1);
      expect(parser.push(malformedTail)).toMatchObject({ invalid: true });
      expect(parser.push(' a later valid-looking block')).toBeNull();
    }
  });

  it('accepts a split closing fence followed by bounded trailing whitespace', () => {
    const parser = createAnswerCardProgressiveParser({ sources: [{ id: 'src-1' }] });
    const firstBlock = JSON.stringify(cards.blocks[0]);
    const prefix = `Fallback\n${'```'}promptpaul-cards\n{"version":1,"blocks":[${firstBlock}]}`;
    expect(parser.push(prefix)?.blocks).toHaveLength(1);
    expect(parser.push('\n')).toBeNull();
    expect(parser.push('```')).toBeNull();
    expect(parser.push('\n\n  \n')).toBeNull();

    parser.reset({ sources: [{ id: 'src-1' }] });
    expect(parser.push(prefix)?.blocks).toHaveLength(1);
    expect(parser.push('\n```\n\n')).toBeNull();

    parser.reset({ sources: [{ id: 'src-1' }] });
    expect(parser.push(prefix)?.blocks).toHaveLength(1);
    expect(parser.push('\n````')).toMatchObject({ invalid: true });
  });

  it('handles quoted braces and rejects nesting beyond the parser bound', () => {
    const quotedCards = {
      version: 1,
      blocks: [{ type: 'summary', title: 'Brace } and quote "', text: 'Safe', points: [] }],
    };
    const parser = createAnswerCardProgressiveParser();
    expect(parser.push(wire(quotedCards))?.blocks).toEqual(quotedCards.blocks);

    const deepParser = createAnswerCardProgressiveParser();
    const deep = `Fallback\n${'```'}promptpaul-cards\n{"version":1,"blocks":[{"type":"summary","title":"x","text":"x","points":[[[[["deep"]]]]]}]}`;
    expect(deepParser.push(deep)).toBeNull();
  });
});

import { describe, expect, it } from 'vitest';
import { extractGroundingPages } from '../src/utils/webFetchGrounding.js';

describe('webFetchGrounding', () => {
  it('reads at most three valid result URLs and preserves bounded page content', async () => {
    const requested = [];
    const pages = await extractGroundingPages(
      [
        { id: 'one', title: 'One', url: 'https://one.example/' },
        { id: 'private', title: 'Private', url: 'http://127.0.0.1/' },
        { id: 'two', title: 'Two', url: 'https://two.example/' },
        { id: 'three', title: 'Three', url: 'https://three.example/' },
        { id: 'four', title: 'Four', url: 'https://four.example/' },
      ],
      async (url) => {
        requested.push(url);
        return { content: `Content from ${url}`, title: 'Fetched title', url };
      },
      { maxBytes: 200 }
    );

    expect(requested).toEqual([
      'https://one.example/',
      'https://two.example/',
      'https://three.example/',
    ]);
    expect(pages).toHaveLength(3);
    expect(pages[0]).toMatchObject({ id: 'one', title: 'Fetched title' });
  });

  it('skips an inaccessible page without losing other results', async () => {
    const pages = await extractGroundingPages(
      [
        { id: 'bad', url: 'https://bad.example/' },
        { id: 'good', url: 'https://good.example/' },
      ],
      async (url) => {
        if (url.includes('bad')) throw new Error('unavailable');
        return { content: 'usable content', url };
      }
    );

    expect(pages).toHaveLength(1);
    expect(pages[0].id).toBe('good');
  });

  it('clamps extracted content to the shared byte budget', async () => {
    const pages = await extractGroundingPages(
      [{ id: 'one', url: 'https://one.example/' }],
      async () => ({ content: 'x'.repeat(500) }),
      { maxBytes: 100 }
    );

    expect(pages).toHaveLength(1);
    expect(pages[0].markdown).toContain('[page content truncated]');
    expect(new TextEncoder().encode(pages[0].markdown).byteLength).toBeLessThanOrEqual(100);
  });

  it('propagates aborts so the run can stop promptly', async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      extractGroundingPages(
        [{ id: 'one', url: 'https://one.example/' }],
        async () => ({ content: 'should not be used' }),
        { signal: controller.signal }
      )
    ).rejects.toMatchObject({ name: 'AbortError' });
  });
});

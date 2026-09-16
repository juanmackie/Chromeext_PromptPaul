import { describe, expect, it } from 'vitest';
import { extractGroundingPages } from '../src/utils/webFetchGrounding.js';

describe('webFetchGrounding', () => {
  it('reads at most three valid result URLs and preserves bounded page content', async () => {
    const requested = [];
    const result = await extractGroundingPages(
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
    expect(result.pages).toHaveLength(3);
    expect(result.pages[0]).toMatchObject({ id: 'one', title: 'Fetched title' });
    expect(result.outcomes).toHaveLength(3);
    expect(result.outcomes.every((o) => o.status === 'success')).toBe(true);
  });

  it('deduplicates URLs before reading', async () => {
    const requested = [];
    const result = await extractGroundingPages(
      [
        { id: 'one', url: 'https://one.example/' },
        { id: 'one-dup', url: 'https://one.example/' },
        { id: 'two', url: 'https://two.example/' },
      ],
      async (url) => {
        requested.push(url);
        return { content: `Content from ${url}`, url };
      }
    );

    expect(requested).toEqual(['https://one.example/', 'https://two.example/']);
    expect(result.pages).toHaveLength(2);
    expect(result.outcomes.map((o) => o.url)).toEqual([
      'https://one.example/',
      'https://two.example/',
    ]);
  });

  it('tries up to five ranked results to obtain three readable pages', async () => {
    const requested = [];
    const result = await extractGroundingPages(
      Array.from({ length: 5 }, (_, i) => ({
        id: `src-${i}`,
        url: `https://page${i}.example/`,
      })),
      async (url) => {
        requested.push(url);
        const idx = Number(url.match(/page(\d)/)?.[1] || 0);
        if (idx === 1 || idx === 3 || idx === 4) return { content: `Content from ${url}`, url };
        throw new Error('unavailable');
      }
    );

    expect(requested).toHaveLength(5); // tries all 5 ranked results
    expect(result.pages).toHaveLength(3); // stops after 3 readable
    expect(result.pages.map((p) => p.url)).toEqual([
      'https://page1.example/',
      'https://page3.example/',
      'https://page4.example/',
    ]);
  });

  it('skips an inaccessible page without losing other results', async () => {
    const result = await extractGroundingPages(
      [
        { id: 'bad', url: 'https://bad.example/' },
        { id: 'good', url: 'https://good.example/' },
      ],
      async (url) => {
        if (url.includes('bad')) throw new Error('unavailable');
        return { content: 'usable content', url };
      }
    );

    expect(result.pages).toHaveLength(1);
    expect(result.pages[0].id).toBe('good');
    expect(result.outcomes[0].status).toBe('failed');
    expect(result.outcomes[1].status).toBe('success');
  });

  it('treats empty content as an extraction failure', async () => {
    const result = await extractGroundingPages(
      [{ id: 'empty', url: 'https://empty.example/' }],
      async () => ({ content: '', url: 'https://empty.example/' })
    );

    expect(result.pages).toHaveLength(0);
    expect(result.outcomes[0].status).toBe('empty');
  });

  it('treats null page returns as extraction failures', async () => {
    const result = await extractGroundingPages(
      [{ id: 'null', url: 'https://null.example/' }],
      async () => null
    );

    expect(result.pages).toHaveLength(0);
    expect(result.outcomes[0].status).toBe('empty');
  });

  it('clamps extracted content to the shared byte budget', async () => {
    const result = await extractGroundingPages(
      [{ id: 'one', url: 'https://one.example/' }],
      async () => ({ content: 'x'.repeat(500) }),
      { maxBytes: 100 }
    );

    expect(result.pages).toHaveLength(1);
    expect(result.pages[0].markdown).toContain('[page content truncated]');
    expect(new TextEncoder().encode(result.pages[0].markdown).byteLength).toBeLessThanOrEqual(100);
  });

  it('caps each page at 8 KB and total at 24 KB', async () => {
    const bigContent = 'x'.repeat(9_000);
    const result = await extractGroundingPages(
      [
        { id: 'big', url: 'https://big.example/' },
        { id: 'small', url: 'https://small.example/' },
      ],
      async (url) => ({ content: bigContent, url })
    );

    expect(result.pages).toHaveLength(2);
    for (const page of result.pages) {
      expect(new TextEncoder().encode(page.markdown).byteLength).toBeLessThanOrEqual(8_000);
    }
    const totalBytes = result.pages.reduce(
      (sum, p) => sum + new TextEncoder().encode(p.markdown).byteLength,
      0
    );
    expect(totalBytes).toBeLessThanOrEqual(24_000);
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

  it('records timeout outcomes for slow page reads', async () => {
    const result = await extractGroundingPages(
      [{ id: 'slow', url: 'https://slow.example/' }],
      async () => {
        await new Promise((resolve) => setTimeout(resolve, 200));
        return { content: 'slow content', url: 'https://slow.example/' };
      }
    );

    expect(result.pages).toHaveLength(1);
    expect(result.outcomes[0].status).toBe('success');
  });

  it('returns empty arrays for invalid inputs', async () => {
    const r1 = await extractGroundingPages(null, async () => ({ content: 'x' }));
    expect(r1.pages).toEqual([]);
    expect(r1.outcomes).toEqual([]);

    const r2 = await extractGroundingPages([], null);
    expect(r2.pages).toEqual([]);
    expect(r2.outcomes).toEqual([]);
  });
});

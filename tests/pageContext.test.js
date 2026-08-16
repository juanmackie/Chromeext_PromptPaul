import { describe, expect, it } from 'vitest';
import { prepareLoadedPageContext } from '../src/chat/PageContext.js';

describe('prepareLoadedPageContext', () => {
  it('prepares the page chip and model context from one consistent payload', () => {
    const prepared = prepareLoadedPageContext({
      title: 'Failure report',
      siteName: 'PDF document',
      byline: 'Operations',
      url: 'https://example.test/report.pdf',
      platform: 'pdf',
      content: 'Asset A passed. Asset B failed.',
    });

    expect(prepared.sourceInfo).toBe('Failure report (PDF document) by Operations');
    expect(prepared.details).toBe('https://example.test/report.pdf');
    expect(prepared.pageContext.platform).toBe('pdf');
    expect(prepared.historyMessage.role).toBe('user');
    expect(prepared.historyMessage.content).toContain('--- Page content ---');
    expect(prepared.historyMessage.content).toContain('Asset B failed.');
  });

  it('includes extraction and media notes in the structured context', () => {
    const prepared = prepareLoadedPageContext(
      {
        title: 'Article',
        url: 'https://example.test/article',
        content: 'Article body',
        readStrategy: 'reader',
        extractionSource: 'readability',
        extractionReason: 'Reader mode succeeded',
        screenshot: 'data:image/png;base64,abc',
      },
      { hasMediaContext: true }
    );

    expect(prepared.historyMessage.content).toContain('Read strategy: reader.');
    expect(prepared.historyMessage.content).toContain(
      'Extraction source: readability. Reader mode succeeded'
    );
    expect(prepared.historyMessage.content).toContain('Visual screenshot context is available.');
    expect(prepared.historyMessage.content).toContain(
      'Additional media attachment context is active.'
    );
  });
});

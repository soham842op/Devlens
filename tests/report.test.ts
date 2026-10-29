import { describe, expect, it } from 'vitest';
import { markdownToHTML } from '../src/report';

describe('markdownToHTML', () => {
  it('renders # headings and * bullets the way llama3 writes them', () => {
    const html = markdownToHTML('# Summary\n\n* first point\n* second point');
    expect(html).toContain('<h2>Summary</h2>');
    expect(html).toContain('<ul><li>first point</li>\n<li>second point</li></ul>');
  });

  it('keeps separate lists from swallowing the headings between them', () => {
    const html = markdownToHTML('- a\n\n## Next\n\n- b');
    expect(html).toContain('<h2>Next</h2>');
    expect(html.match(/<ul>/g)).toHaveLength(2);
  });

  it('still renders bold and italic inside bullets', () => {
    expect(markdownToHTML('* **Python**: *8 files*')).toContain('<li><strong>Python</strong>: <em>8 files</em></li>');
  });

  it('escapes HTML in model output', () => {
    expect(markdownToHTML('Use Result<T> & handle errors')).toContain('Result&lt;T&gt; &amp; handle');
  });
});

import { renderAssistantMessage } from '../../../frontend/utils/markdown.js';

test('assistant markdown escapes HTML and denies executable or encoded link schemes', () => {
    for (const input of ['[click](javascript:alert)', '[click](JaVaScRiPt:alert)', '[click](data:text/html,test)', '[click](jav&#x61;script:alert)', '[click](java\nscript:alert)', '<img src=x onerror=alert(1)>']) {
        const html = renderAssistantMessage(input);
        expect(html).not.toMatch(/href="(?:javascript|data):/i);
        expect(html).not.toMatch(/<(?:script|img)\b/i);
    }
});
test('safe links and formatting remain available without automatic remote images', () => {
    const html = renderAssistantMessage('**Hello** [documentation](https://example.com/a?b=1&c=2)\n![remote](https://example.com/pixel)');
    expect(html).toContain('<strong>Hello</strong>');
    expect(html).toContain('href="https://example.com/a?b=1&amp;c=2"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).not.toContain('<img');
});

import { JSDOM } from 'jsdom';

const BASE_HTML = `
  <html lang="en">
    <body id="mermaid-server">
      <svg id="svg"/>
    </body>
  </html>
`;

const MOCKED_BBOX = { x: 0, y: 0, width: 100, height: 100 };

function setProperty(obj: any, key: string, value: unknown): void {
  obj[key] = value;
}

export async function withEnvironment<T>(fn: () => Promise<T>): Promise<T> {
  const oldWindow = global.window;
  const oldDocument = global.document;
  const oldMutationObserver = (global as any).MutationObserver;

  try {
    const dom = new JSDOM(BASE_HTML, {
      resources: 'usable',
      beforeParse(window) {
        setProperty(window.Element.prototype, 'getBBox', () => ({ ...MOCKED_BBOX }));
        setProperty(window.Element.prototype, 'getComputedTextLength', function (this: Element) {
          const text = this.textContent ?? '';
          return text.length * 8;
        });
      },
    });

    setProperty(global, 'window', dom.window);
    setProperty(global, 'document', dom.window.document);
    setProperty(global, 'MutationObserver', undefined);

    return await fn();
  } finally {
    setProperty(global, 'window', oldWindow);
    setProperty(global, 'document', oldDocument);
    setProperty(global, 'MutationObserver', oldMutationObserver);
  }
}

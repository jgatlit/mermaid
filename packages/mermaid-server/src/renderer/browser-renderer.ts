import { chromium, type Browser, type Page } from 'playwright';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join, normalize } from 'node:path';
import { readFile } from 'node:fs/promises';
import type { MermaidConfig } from 'mermaid';

/**
 * Browser-backed rendering.
 *
 * jsdom has no getBBox, no getComputedTextLength, no getBoundingClientRect and no
 * canvas 2d, so every diagram type that measures its own output renders with wrong
 * geometry or not at all — mindmap, timeline, kanban, quadrantChart, journey, and (since
 * upstream 11.17) architecture-beta. Upstream confirms the same conclusion in
 * mermaid-js/mermaid#8210, where their own estimator branch still shows ~9% node-size
 * error and up to 160px position drift against Chromium.
 *
 * Only `render` comes here. `parse` and `detect` never measure anything, so they stay on
 * the cheap in-process path.
 *
 * One browser, one page, reused. Page creation costs far more than a render, and the
 * caller already serialises through the render queue.
 */

const here = dirname(fileURLToPath(import.meta.url));
const ASSETS = resolve(here, '../../assets');
const PACKAGES = resolve(here, '../../../');

/**
 * A synthetic origin. Chromium blocks ES module imports over file://, so the shell is
 * served from here and every relative import inside the bundles resolves same-origin.
 */
const ORIGIN = 'http://mermaid.local';
const SHELL_URL = `${ORIGIN}/render-shell.html`;

const MIME: Record<string, string> = {
  '.html': 'text/html',
  '.mjs': 'text/javascript',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.map': 'application/json',
  '.css': 'text/css',
};

/** Map a request path onto disk: /packages/... to the monorepo, anything else to assets. */
function resolveRequest(pathname: string): string | null {
  const clean = normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, '');
  const base = clean.startsWith('/packages/')
    ? join(PACKAGES, clean.slice('/packages/'.length))
    : join(ASSETS, clean);
  // Refuse anything that escapes the two roots we intend to serve.
  return base.startsWith(PACKAGES) || base.startsWith(ASSETS) ? base : null;
}

export interface BrowserRenderResult {
  svg: string;
  diagramType: string | null;
}

export class BrowserRenderer {
  private browser: Browser | null = null;
  private page: Page | null = null;
  private starting: Promise<void> | null = null;

  /** Populated once the page boots — surfaced on /health. */
  status: { ready: boolean; layouts: string[]; iconPacks: string[]; error: string | null } = {
    ready: false,
    layouts: [],
    iconPacks: [],
    error: null,
  };

  async start(): Promise<void> {
    if (this.page) {
      return;
    }
    // Concurrent callers must not each launch a browser.
    this.starting ??= this.launch();
    await this.starting;
  }

  private async launch(): Promise<void> {
    this.browser = await chromium.launch({
      args: ['--no-sandbox', '--disable-dev-shm-usage', '--font-render-hinting=none'],
    });
    const page = await this.browser.newPage({ viewport: { width: 1600, height: 1200 } });
    page.on('pageerror', (e) => {
      this.status.error = String(e);
    });
    await page.route(`${ORIGIN}/**`, async (route) => {
      const target = resolveRequest(new URL(route.request().url()).pathname);
      if (!target) {
        await route.fulfill({ status: 403, body: 'out of tree' });
        return;
      }
      try {
        const body = await readFile(target);
        const ext = target.slice(target.lastIndexOf('.'));
        await route.fulfill({
          status: 200,
          contentType: MIME[ext] ?? 'application/octet-stream',
          body,
        });
      } catch {
        await route.fulfill({ status: 404, body: 'not found' });
      }
    });
    await page.goto(SHELL_URL);
    await page.waitForFunction(
      () => (window as unknown as { __mermaidStatus?: () => { ready: boolean } }).__mermaidStatus?.().ready === true,
      undefined,
      { timeout: 30_000 }
    );
    const s = (await page.evaluate(() =>
      (window as unknown as { __mermaidStatus: () => unknown }).__mermaidStatus()
    )) as { layouts: string[]; iconPacks: string[]; error: string | null };
    this.status = { ready: true, layouts: s.layouts, iconPacks: s.iconPacks, error: s.error };
    this.page = page;
  }

  async render(id: string, text: string, config: MermaidConfig): Promise<BrowserRenderResult> {
    await this.start();
    if (!this.page) {
      throw new Error('browser renderer unavailable');
    }
    return this.page.evaluate(
      ([renderId, diagram, cfg]) =>
        (
          window as unknown as {
            __render: (i: string, t: string, c: unknown) => Promise<BrowserRenderResult>;
          }
        ).__render(renderId as string, diagram as string, cfg),
      [id, text, config] as [string, string, MermaidConfig]
    );
  }

  async stop(): Promise<void> {
    await this.browser?.close().catch(() => undefined);
    this.browser = null;
    this.page = null;
    this.starting = null;
    this.status = { ready: false, layouts: [], iconPacks: [], error: null };
  }
}

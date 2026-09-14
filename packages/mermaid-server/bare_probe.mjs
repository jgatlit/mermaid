// Bare probe: render the four failing types in a REAL browser with STOCK mermaid
// and its own default config — no mermaid-server code in the path at all.
// If the defects vanish here, they are ours (config/bridge). If they persist,
// they are upstream.
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const ROOT = '/tmp/p4';
const DIAGRAMS = {
  timeline: 'timeline\n  title T\n  section S\n    2021 : a : b\n    2022 : c',
  kanban: 'kanban\n  Todo\n    [Task one]\n  Doing\n    [Task two]',
  quadrantChart:
    'quadrantChart\n  title Q\n  x-axis Low --> High\n  y-axis Low --> High\n  A: [0.3, 0.6]\n  B: [0.8, 0.2]',
  journey: 'journey\n  title T\n  section S\n    Do it: 5: Me',
};

const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR:', String(e).slice(0, 200)));

// Serve the built bundle from a synthetic http origin (Chromium blocks ESM on file://)
await page.route('http://probe.local/**', (route) => {
  const url = new URL(route.request().url());
  if (url.pathname === '/index.html') {
    return route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html><html><body><div id="c"></div>
<script type="module">
import mermaid from '/packages/mermaid/dist/mermaid.esm.min.mjs';
mermaid.initialize({ startOnLoad: false });
window.__render = async (t) => (await mermaid.render('probe-' + Math.random().toString(36).slice(2), t)).svg;
window.__ready = true;
</script></body></html>`,
    });
  }
  try {
    return route.fulfill({
      contentType: url.pathname.endsWith('.mjs') ? 'text/javascript' : 'application/json',
      body: readFileSync(ROOT + url.pathname),
    });
  } catch {
    return route.fulfill({ status: 404, body: '' });
  }
});

await page.goto('http://probe.local/index.html');
await page.waitForFunction('window.__ready === true', null, { timeout: 30000 });

for (const [name, text] of Object.entries(DIAGRAMS)) {
  try {
    const svg = await page.evaluate((t) => window.__render(t), text);
    const undef = (svg.match(/class="[^"]*\bundefined\b[^"]*"/g) || []).length;
    const nan = (svg.match(/NaN/g) || []).length;
    const fo = (svg.match(/<foreignObject/g) || []).length;
    console.log(
      `${name.padEnd(14)} classUndefined=${undef} NaN=${nan} foreignObject=${fo} len=${svg.length}`
    );
  } catch (e) {
    console.log(`${name.padEnd(14)} ERROR ${String(e).slice(0, 160)}`);
  }
}
await browser.close();

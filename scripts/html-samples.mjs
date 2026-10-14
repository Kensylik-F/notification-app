// Renders demo/html-samples.ts the two ways HTML reaches the cabinet: as the
// service returns it (`raw`) and as the editor would have cleaned it
// (`edited`), opened on the notifications page. Also prints what the
// editor's cleaner keeps. `node scripts/html-samples.mjs`
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { createServer } from 'vite';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(ROOT, 'shots/html');
mkdirSync(OUT, { recursive: true });
const server = await createServer({
  root: resolve(ROOT, 'demo'),
  configFile: resolve(ROOT, 'demo/vite.config.ts'),
  logLevel: 'error',
});
await server.listen();
const base = `http://localhost:${server.config.server.port}`;
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
});
const dialogs = [];
const errors = [];

for (const mode of ['raw', 'edited']) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    locale: 'ru-RU',
  });
  const page = await context.newPage();
  page.on('dialog', d => {
    dialogs.push(`${mode}: ${d.message()}`);
    void d.dismiss();
  });
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(
    `${base}/?samples=html&banners=0${mode === 'edited' ? '&clean=1' : ''}`
  );
  await page.getByText('1. Только текст').first().waitFor();
  const rows = page.locator('.main li button');
  const count = await rows.count();
  for (let i = 0; i < count; i += 1) {
    const row = rows.nth(i);
    const name = (await row.innerText()).split('\n')[0];
    await row.click();
    await page.waitForTimeout(900);
    await page.screenshot({
      path: resolve(OUT, `${name.slice(0, 2).replace('.', '')}-${mode}.png`),
    });
  }
  // A link into the cabinet opens in place (the host's navigate).
  await rows.nth(2).click();
  await page.waitForTimeout(900);
  const frame = page.frameLocator('.main iframe');
  await frame.getByText(/оформить по источнику 4821/).click();
  await page.waitForTimeout(400);
  const route = await page
    .locator('.demoRoute')
    .innerText()
    .catch(() => 'none');
  console.log(`${mode}: in-app link -> ${route.replace(/\s+/g, ' ')}`);
  await page.screenshot({ path: resolve(OUT, `3-${mode}-followed.png`) });
  await context.close();
}

// What the editor keeps, sample by sample.
const page = await browser.newPage();
await page.goto(`${base}/?samples=html&banners=0`);
const cleaned = await page.evaluate(async () => {
  const kit = await import(
    '/@fs/home/claude/notification-app/src/notifications-kit/react/admin/richtext.ts'
  );
  const { HTML_SAMPLES } = await import('/html-samples.ts');
  return HTML_SAMPLES.filter(s => s.bodyHtml).map(s => ({
    key: s.key,
    before: s.bodyHtml,
    after: kit.sanitizeHtml(s.bodyHtml),
    text: kit.htmlToText(kit.sanitizeHtml(s.bodyHtml)),
  }));
});
writeFileSync(resolve(OUT, 'cleaned.json'), JSON.stringify(cleaned, null, 2));

await browser.close();
await server.close();
console.log(
  dialogs.length
    ? `dialogs:\n${dialogs.join('\n')}`
    : 'no dialogs (no script ran)'
);
console.log(errors.length ? `errors:\n${errors.join('\n')}` : 'no page errors');

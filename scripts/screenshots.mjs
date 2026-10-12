// Renders the demo in Chromium and saves screenshots of the main states to
// ./shots. A visual check for the maintainer; not part of the test suite.
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { createServer } from 'vite';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(ROOT, 'shots');
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
const errors = [];

async function open(query = '', viewport = { width: 1366, height: 800 }) {
  const context = await browser.newContext({ viewport, locale: 'ru-RU' });
  const page = await context.newPage();
  page.on('console', m => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(`${base}/${query}`);
  await page.waitForSelector('[role="alertdialog"]');
  return page;
}
const shot = (page, name) =>
  page.screenshot({ path: resolve(OUT, `${name}.png`) });

{
  const page = await open();
  await page.waitForTimeout(600);
  await shot(page, '01-modal-toast-corner');
  await page.getByRole('button', { name: 'Понятно' }).click();
  await page.waitForTimeout(700);
  await shot(page, '02-list-with-toast-and-corner');
  await page
    .getByRole('button', { name: /Уведомления, непрочитанных/ })
    .click();
  await page.waitForTimeout(700);
  await shot(page, '03-bell-open');
  await page.keyboard.press('Escape');
  await page.getByRole('tab', { name: /Непрочитанные/ }).click();
  await page.waitForTimeout(600);
  await shot(page, '04-unread-tab');
  await page.getByRole('tab', { name: 'Все' }).click();
  await page.waitForTimeout(500);
  await page
    .getByRole('button', { name: /Нужна информация по предзаказу/ })
    .first()
    .click();
  await page.waitForTimeout(700);
  await shot(page, '05-item-open');
  await page.getByRole('button', { name: '← К списку' }).click();
  await page.waitForTimeout(500);
  await page
    .getByRole('region', { name: 'Объявления' })
    .getByRole('button', { name: 'Закрыть' })
    .click();
  await page.waitForTimeout(8500);
  await shot(page, '05b-toast-gone-corner-dismissed');
  await page.getByRole('button', { name: 'Прочитать все' }).click();
  await page.waitForTimeout(700);
  await shot(page, '06-after-mark-all-read');
  await page.getByRole('button', { name: 'Показать ещё' }).click();
  await page.waitForTimeout(700);
  await page.locator('.main').evaluate(el => el.scrollTo(0, el.scrollHeight));
  await page.waitForTimeout(200);
  await shot(page, '07-load-more-bottom');
  await page.context().close();
}
{
  const page = await open('?theme=dark');
  await page.waitForTimeout(600);
  await shot(page, '08-dark-modal');
  await page.getByRole('button', { name: 'Понятно' }).click();
  await page
    .getByRole('button', { name: /Уведомления, непрочитанных/ })
    .click();
  await page.waitForTimeout(700);
  await shot(page, '09-dark-bell');
  await page.context().close();
}
{
  const page = await open('', { width: 420, height: 800 });
  await page.getByRole('button', { name: 'Понятно' }).click();
  await page.waitForTimeout(700);
  await shot(page, '10-narrow');
  await page.context().close();
}
{
  const page = await open('?item=00000000-0000-4000-8000-999999999999');
  await page.getByRole('button', { name: 'Понятно' }).click();
  await page.waitForTimeout(700);
  await shot(page, '11-item-not-found');
  await page.context().close();
}

await browser.close();
await server.close();
console.log(
  errors.length ? `console errors:\n${errors.join('\n')}` : 'no console errors'
);

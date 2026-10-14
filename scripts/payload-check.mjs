// Fills the announcement form in the demo like a moderator would, publishes,
// and prints the request bodies the kit sent - to compare with the service's
// PublishAnnouncementRequest. `node scripts/payload-check.mjs`
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { createServer } from 'vite';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const server = await createServer({
  root: resolve(ROOT, 'demo'),
  configFile: resolve(ROOT, 'demo/vite.config.ts'),
  logLevel: 'error',
});
await server.listen();
const base = `http://localhost:${server.config.server.port}`;
const browser = await chromium.launch();
const page = await (
  await browser.newContext({
    viewport: { width: 1440, height: 900 },
    locale: 'ru-RU',
  })
).newPage();
await page.addInitScript(() => {
  window.__nkRequests = [];
});
await page.goto(`${base}/?view=announce&flags=all&banners=0`);
await page.waitForTimeout(500);
await page.getByLabel('Тема').fill('Плановые работы 21 октября');
await page.getByRole('textbox', { name: 'Текст' }).click();
await page.keyboard.type('В ночь на 21 октября сервис будет ');
await page.keyboard.press('Control+b');
await page.keyboard.type('недоступен');
await page.keyboard.press('Control+b');
await page.keyboard.type(' с 00:00 до 06:00.');
await page.keyboard.press('Enter');
await page.getByRole('button', { name: 'Маркированный список' }).click();
await page.keyboard.type('Сохраните черновики');
await page.locator('label').filter({ hasText: 'По роли' }).click();
await page.getByRole('combobox', { name: 'Роль' }).click();
await page.getByRole('option', { name: 'Модератор' }).click();
await page.getByRole('radio', { name: /Окном по центру/ }).click();
await page.locator('label').filter({ hasText: 'С даты' }).click();
await page.getByRole('button', { name: 'Опубликовать' }).click();
await page.waitForTimeout(400);
await page
  .getByRole('alertdialog')
  .getByRole('button', { name: 'Опубликовать' })
  .click();
await page.waitForTimeout(2000);
const log = await page.evaluate(() =>
  window.__nkRequests.filter(r => r.method === 'POST')
);
console.log(JSON.stringify(log, null, 2));
await browser.close();
await server.close();

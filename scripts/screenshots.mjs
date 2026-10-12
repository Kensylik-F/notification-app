// Renders the demo in Chromium and saves screenshots of the main states to
// ./shots. A visual check for the maintainer; not part of the test suite.
import { mkdirSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { createServer } from 'vite';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(ROOT, 'shots');
rmSync(OUT, { recursive: true, force: true });
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
const only = process.argv[2];

async function open(query = '', viewport = { width: 1366, height: 860 }) {
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
const wait = (page, ms) => page.waitForTimeout(ms);
const acknowledge = async page => {
  await page.getByRole('button', { name: 'Понятно' }).click();
  await wait(page, 400);
};
const quietOverlays = page =>
  page.addStyleTag({ content: '[class*="overlay"]{display:none!important}' });
const scrollMain = (page, y) =>
  page.locator('.main').evaluate((el, to) => el.scrollTo(0, to), y);
const run = name => !only || name.startsWith(only);

// ---------------------------------------------------------------- inbox
if (run('inbox')) {
  const page = await open();
  await wait(page, 700);
  await shot(page, '01-modal');
  await acknowledge(page);
  await wait(page, 500);
  await shot(page, '02-list-and-deck');
  await page.locator('[class*="deck"][role="button"]').click();
  await wait(page, 500);
  await shot(page, '03-deck-expanded');
  await page.keyboard.press('Escape');
  await page
    .getByRole('button', { name: /Уведомления, непрочитанных/ })
    .click();
  await wait(page, 600);
  await shot(page, '04-bell');
  await page.keyboard.press('Escape');
  await quietOverlays(page);
  await page
    .locator('.main')
    .getByRole('button', { name: /Нужна информация по предзаказу/ })
    .first()
    .click();
  await wait(page, 900);
  await shot(page, '05-row-html');
  await page.getByRole('button', { name: 'Тёмная тема' }).click();
  await wait(page, 700);
  await shot(page, '05b-row-html-after-theme-switch');
  await page.getByRole('button', { name: 'Светлая тема' }).click();
  await wait(page, 500);
  await page.getByRole('button', { name: 'Закрыть все' }).click();
  await wait(page, 300);
  await shot(page, '06-dismiss-all-confirm');
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Закрыть все' })
    .click();
  await wait(page, 400);
  await shot(page, '07-dismiss-all-progress');
  await wait(page, 6000);
  await shot(page, '08-dismiss-all-done');
  await page.context().close();
}
if (run('inbox')) {
  const page = await open('?item=00000000-0000-4000-8000-000000000001');
  await acknowledge(page);
  await quietOverlays(page);
  await wait(page, 800);
  await shot(page, '09-item-page-html');
  await page.context().close();
}

// -------------------------------------------------------- announcements
if (run('feed')) {
  const page = await open('?feed=announcements');
  await acknowledge(page);
  await quietOverlays(page);
  await wait(page, 500);
  await page
    .locator('.main')
    .getByRole('button', { name: /Выгрузки стали быстрее/ })
    .click();
  await wait(page, 700);
  await shot(page, '10-feed-active');
  await page.locator('.main').getByRole('button', { name: 'Закрыть' }).click();
  await wait(page, 500);
  await page.getByRole('tab', { name: 'Закрытые' }).click();
  await wait(page, 400);
  await page
    .locator('.main')
    .getByRole('button', { name: /Выгрузки стали быстрее/ })
    .click();
  await wait(page, 700);
  await shot(page, '11-feed-dismissed');
  await page.context().close();
}

// -------------------------------------------------------------- compose
if (run('compose')) {
  const page = await open('?view=compose');
  await acknowledge(page);
  await quietOverlays(page);
  await shot(page, '20-compose-empty');
  // Type and erase: the placeholder must come back and the body read empty.
  await page.getByRole('textbox', { name: 'Текст' }).click();
  await page.keyboard.type('x');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Backspace');
  await page.keyboard.press('Backspace');
  await wait(page, 200);
  await shot(page, '20b-compose-editor-erased');
  await page.getByRole('button', { name: 'Отправить' }).click();
  await wait(page, 200);
  await shot(page, '21-compose-errors');
  await scrollMain(page, 0);
  await page.getByLabel('Тема').fill('Плановые работы 14 октября');
  const editor = page.getByRole('textbox', { name: 'Текст' });
  await editor.click();
  await page.keyboard.type('В ночь на 14 октября сервис будет ');
  await page.keyboard.press('Control+b');
  await page.keyboard.type('недоступен');
  await page.keyboard.press('Control+b');
  await page.keyboard.type(' с 00:00 до 06:00.');
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Маркированный список' }).click();
  await page.keyboard.type('Сохраните черновики заранее');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Выгрузки, начатые до 00:00, завершатся');
  await wait(page, 1400);
  await shot(page, '22-compose-editor-preview');
  const recipients = page.getByLabel('Получатели');
  await recipients.fill('Иван');
  await wait(page, 700);
  await recipients.press('Enter');
  await recipients.fill('bad.mailbox@sber.ru');
  await recipients.press('Enter');
  await page.locator('form').getByText('Почта', { exact: true }).click();
  await page.getByRole('combobox', { name: 'Категория' }).click();
  await wait(page, 300);
  await shot(page, '23-compose-category');
  await page.getByRole('option', { name: /Учётная запись/ }).click();
  await page.getByText('Дополнительно').click();
  await wait(page, 300);
  await scrollMain(page, 2000);
  await wait(page, 300);
  await shot(page, '24-compose-more');
  await page.getByRole('combobox', { name: 'Класс' }).click();
  await wait(page, 200);
  await shot(page, '25-compose-class-dropdown');
  await page.keyboard.press('Escape');
  await page.getByText('HTML', { exact: true }).click();
  await scrollMain(page, 0);
  await wait(page, 300);
  await shot(page, '26-compose-html-tab');
  await page.getByRole('button', { name: 'Отправить' }).click();
  await wait(page, 7000);
  await shot(page, '27-send-result');
  await page.context().close();
}

// ------------------------------------------------------------------ log
if (run('log')) {
  const page = await open('?view=log');
  await acknowledge(page);
  await quietOverlays(page);
  await wait(page, 500);
  await page.getByRole('combobox', { name: 'Канал' }).click();
  await wait(page, 200);
  await shot(page, '30-log-channel-dropdown');
  await page.keyboard.press('Escape');
  await page
    .locator('tbody tr')
    .filter({ hasText: 'Не доставлена' })
    .first()
    .click();
  await wait(page, 700);
  await shot(page, '31-log-dead');
  await page.context().close();
}

// ------------------------------------------------------------- announce
if (run('announce')) {
  const page = await open('?view=announce');
  await acknowledge(page);
  await quietOverlays(page);
  await shot(page, '40-announce-empty');
  await page.getByLabel('Тема').fill('Плановые работы сегодня');
  await page.getByRole('textbox', { name: 'Текст' }).click();
  await page.keyboard.type('С 22:00 до 23:00 сервис будет недоступен.');
  await page.getByRole('combobox', { name: 'Категория' }).click();
  await page.getByRole('option', { name: /Работы и сбои/ }).click();
  await wait(page, 1200);
  await shot(page, '41-announce-filled');
  await page.getByRole('button', { name: 'Опубликовать' }).click();
  await wait(page, 300);
  await scrollMain(page, 3000);
  await shot(page, '42-announce-confirm');
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: 'Опубликовать' })
    .click();
  await wait(page, 2500);
  // The publisher is in the audience: the incident shows up as a modal.
  await shot(page, '43a-announce-modal-for-publisher');
  await acknowledge(page);
  await shot(page, '43-announce-result');
  await page.getByRole('button', { name: 'Исправить текст' }).click();
  await wait(page, 1200);
  await shot(page, '44-announce-correction');
  await page.context().close();
}

// ---------------------------------------------------------- dark, narrow
if (run('dark')) {
  const page = await open('?theme=dark');
  await acknowledge(page);
  await wait(page, 500);
  await shot(page, '50-dark-list-deck');
  await page.context().close();
}
if (run('dark')) {
  const page = await open('?theme=dark&view=compose');
  await acknowledge(page);
  await quietOverlays(page);
  await page.getByLabel('Тема').fill('Новая версия');
  await page.getByRole('textbox', { name: 'Текст' }).click();
  await page.keyboard.type('Вышла версия 2.4: ');
  await page.getByRole('button', { name: 'Жирный' }).click();
  await page.keyboard.type('предзаказ данных');
  await wait(page, 1400);
  await shot(page, '51-dark-compose');
  await page.context().close();
}
if (run('narrow')) {
  const page = await open('?view=compose', { width: 420, height: 860 });
  await acknowledge(page);
  await quietOverlays(page);
  await shot(page, '60-narrow-compose');
  await page.context().close();
}
if (run('narrow')) {
  const page = await open('', { width: 420, height: 860 });
  await acknowledge(page);
  await wait(page, 500);
  await shot(page, '61-narrow-deck');
  await page.context().close();
}

await browser.close();
await server.close();
console.log(
  errors.length ? `console errors:\n${errors.join('\n')}` : 'no console errors'
);

// Renders the demo in Chromium and saves screenshots of the main states to
// ./shots. A visual check for the maintainer; not part of the test suite.
// `node scripts/screenshots.mjs [group]` - groups: center, deck, arrival,
// compose, announce, log, dark, narrow, queue (the host's defaults: inbox
// and sending off).
import { mkdirSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { createServer } from 'vite';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(ROOT, 'shots');
const only = process.argv[2];
if (!only) rmSync(OUT, { recursive: true, force: true });
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

/** Every part on (`flags=all`) unless the query says otherwise. */
async function open(query = '', viewport = { width: 1440, height: 900 }) {
  const context = await browser.newContext({ viewport, locale: 'ru-RU' });
  const page = await context.newPage();
  page.on('console', m => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', e => errors.push(String(e)));
  const params = new URLSearchParams(query.replace(/^\?/, ''));
  if (!params.has('flags')) params.set('flags', 'all');
  await page.goto(`${base}/?${params}`);
  await page.waitForSelector('[role="alertdialog"]');
  return page;
}

/** Answers the dialogs and closes the strips of the queue; the deck
 *  comes up after them. */
async function clearQueue(page) {
  for (let i = 0; i < 6; i += 1) {
    const dialog = page.getByRole('alertdialog');
    const strip = page.getByRole('status').getByRole('button', {
      name: 'Закрыть объявление',
    });
    if (await dialog.count()) {
      await dialog.getByRole('button', { name: 'Понятно' }).click();
    } else if (await strip.count()) {
      await strip.first().click();
    } else break;
    await wait(page, 1300);
  }
  await wait(page, 600);
}
const shot = (page, name) =>
  page.screenshot({ path: resolve(OUT, `${name}.png`) });
const wait = (page, ms) => page.waitForTimeout(ms);
const acknowledge = clearQueue;
const run = name => !only || name.startsWith(only);
const deckFront = page => page.locator('[data-layer="0"] button').first();

// ---------------------------------------------------------------- center
if (run('center')) {
  const page = await open();
  await wait(page, 700);
  await shot(page, '01-incident-modal');
  await page.getByRole('button', { name: 'Понятно' }).click();
  await wait(page, 1300);
  await acknowledge(page);
  await wait(page, 600);
  await shot(page, '02-center-deck');
  // The stack sits over the page's top-right controls, which is by design;
  // those clicks go straight to the element below.
  await page
    .locator('.main')
    .getByRole('button', { name: /Нужна информация по предзаказу/ })
    .first()
    .click();
  await wait(page, 1000);
  await shot(page, '03-center-reader-html');
  await page
    .getByRole('switch', { name: 'Только непрочитанные' })
    .dispatchEvent('click');
  await wait(page, 600);
  await shot(page, '04-center-unread-only');
  await page
    .getByRole('switch', { name: 'Только непрочитанные' })
    .dispatchEvent('click');
  await page.getByRole('tab', { name: /Объявления/ }).click();
  await wait(page, 300);
  await shot(page, '05-tab-switch-mid');
  await wait(page, 500);
  await page
    .locator('.main')
    .getByRole('button', { name: /Выгрузки стали быстрее/ })
    .click();
  await wait(page, 800);
  await shot(page, '06-announcement-reader');
  await page
    .locator('.main')
    .getByRole('button', { name: 'Закрыть', exact: true })
    .click();
  await wait(page, 120);
  await shot(page, '07-announcement-closing-mid');
  await wait(page, 800);
  await shot(page, '08-announcement-closed-history');
  await page.getByRole('tab', { name: /Входящие/ }).click();
  await wait(page, 400);
  await page
    .locator('.main')
    .getByRole('button', { name: 'Закрыть все' })
    .dispatchEvent('click');
  await wait(page, 300);
  await shot(page, '09-dismiss-all-confirm');
  await page.context().close();
}

// ------------------------------------------------------------------ deck
if (run('deck')) {
  const page = await open('?ai=open');
  await acknowledge(page);
  await wait(page, 500);
  await shot(page, '10-deck-collapsed-agent-open');
  await deckFront(page).click();
  await wait(page, 150);
  await shot(page, '11-deck-expanding-mid');
  await wait(page, 500);
  await shot(page, '12-deck-expanded');
  await page.getByRole('button', { name: 'Закрыть объявление' }).nth(1).click();
  await wait(page, 120);
  await shot(page, '13-deck-card-leaving');
  await wait(page, 700);
  await shot(page, '14-deck-after-close');
  await page
    .getByRole('region', { name: 'Объявления' })
    .getByRole('button', { name: /Появился предзаказ данных/ })
    .click();
  await wait(page, 600);
  await shot(page, '15-reader-dialog');
  await page.keyboard.press('Escape');
  await wait(page, 400);
  await page
    .getByRole('region', { name: 'Объявления' })
    .getByRole('button', { name: 'Свернуть' })
    .click();
  await wait(page, 600);
  await shot(page, '16-deck-collapsed-again');
  await page.context().close();
}

// --------------------------------------------------------------- arrival
if (run('arrival')) {
  const page = await open();
  await acknowledge(page);
  await wait(page, 5500);
  await page
    .getByRole('button', { name: '+ уведомление' })
    .dispatchEvent('click');
  await wait(page, 6500);
  await shot(page, '20-new-notification-card');
  await page
    .getByRole('button', { name: /Уведомления, (непрочитанных|новых)/ })
    .dispatchEvent('click');
  await wait(page, 600);
  await shot(page, '21-bell');
  await page.context().close();
}

// --------------------------------------------------------------- compose
if (run('compose')) {
  const page = await open('?view=compose');
  await acknowledge(page);
  await wait(page, 400);
  await shot(page, '30-compose-empty');
  const recipients = page.getByLabel('Получатели');
  await recipients.fill('Иван');
  await wait(page, 700);
  await recipients.press('Enter');
  await recipients.fill('petrova.a@sberbank.ru');
  await recipients.press('Enter');
  await page.locator('label').filter({ hasText: 'Почта' }).click();
  await page.locator('label').filter({ hasText: /^Чат$/ }).click();
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
  await wait(page, 300);
  await shot(page, '31-compose-filled');
  await page.getByRole('button', { name: 'Предпросмотр' }).click();
  await wait(page, 400);
  await shot(page, '32-preview-menu');
  await page.getByRole('menuitem', { name: /В кабинете/ }).click();
  await wait(page, 1200);
  await shot(page, '33-preview-in-app');
  await page
    .getByRole('button', { name: /Уведомления, (непрочитанных|новых)/ })
    .dispatchEvent('click');
  await wait(page, 600);
  await shot(page, '34-preview-in-bell');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Выйти из предпросмотра' }).click();
  await wait(page, 400);
  await page.getByRole('button', { name: 'Предпросмотр' }).click();
  await page.getByRole('menuitem', { name: /Письмо/ }).click();
  await wait(page, 1200);
  await shot(page, '35-preview-email');
  await page.getByRole('tab', { name: 'Чат' }).click();
  await wait(page, 1000);
  await shot(page, '36-preview-chat');
  await page.keyboard.press('Escape');
  await wait(page, 400);
  await page.getByRole('button', { name: /Дополнительно/ }).click();
  await wait(page, 500);
  await shot(page, '37-compose-more');
  await page.getByRole('button', { name: 'Отправить' }).click();
  await wait(page, 300);
  await shot(page, '38-compose-errors');
  await page.context().close();
}

// -------------------------------------------------------------- announce
if (run('announce')) {
  const page = await open('?view=announce');
  await acknowledge(page);
  await wait(page, 400);
  await shot(page, '40-announce-empty');
  await page.getByLabel('Тема').fill('Плановые работы 14.10');
  await page.getByRole('textbox', { name: 'Текст' }).click();
  await page.keyboard.type(
    'В ночь на 14 октября с 00:00 до 06:00 выгрузки будут недоступны.'
  );
  await page.locator('label').filter({ hasText: 'По роли' }).click();
  await page.getByRole('combobox', { name: 'Роль' }).click();
  await page.getByRole('option', { name: 'Модератор' }).click();
  await page.getByLabel('Категория').fill('platform-release');
  await page.keyboard.press('Escape');
  await wait(page, 300);
  await shot(page, '41-announce-filled');
  await page.getByRole('button', { name: 'Предпросмотр' }).click();
  await wait(page, 1200);
  await shot(page, '42-announce-preview-deck');
  await page.getByRole('button', { name: 'Выйти из предпросмотра' }).click();
  await page.getByLabel('Категория').fill('platform-incident');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Предпросмотр' }).click();
  await wait(page, 1200);
  await shot(page, '43-announce-preview-modal');
  await acknowledge(page);
  await page.getByRole('button', { name: 'Опубликовать' }).click();
  await wait(page, 500);
  await shot(page, '44-announce-confirm');
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: 'Опубликовать' })
    .click();
  await wait(page, 2500);
  await shot(page, '45-announce-published-modal');
  await acknowledge(page);
  await shot(page, '46-announce-result');
  await page.context().close();
}

// ------------------------------------------------------------------- log
if (run('log')) {
  const page = await open('?view=compose&mail=log');
  await acknowledge(page);
  await wait(page, 600);
  await shot(page, '50-log');
  await page.context().close();
}

// ---------------------------------------------------------- dark, narrow
if (run('dark')) {
  const page = await open('?theme=dark');
  await acknowledge(page);
  await page
    .locator('.main')
    .getByRole('button', { name: /Нужна информация по предзаказу/ })
    .first()
    .click();
  await wait(page, 900);
  await shot(page, '60-dark-center');
  await page.context().close();
}
if (run('dark')) {
  const page = await open('?theme=dark&view=compose');
  await acknowledge(page);
  await page.getByLabel('Тема').fill('Новая версия');
  await page.getByRole('textbox', { name: 'Текст' }).click();
  await page.keyboard.type('Вышла версия 2.4.');
  await page.getByRole('button', { name: 'Предпросмотр' }).click();
  await wait(page, 1200);
  await shot(page, '61-dark-compose-preview');
  await page.context().close();
}
if (run('narrow')) {
  const page = await open('', { width: 420, height: 860 });
  await acknowledge(page);
  await wait(page, 500);
  await shot(page, '70-narrow-center');
  await page
    .locator('.main')
    .getByRole('button', { name: /Нужна информация по предзаказу/ })
    .first()
    .click();
  await wait(page, 800);
  await shot(page, '71-narrow-reader');
  await page.context().close();
}

// ----------------------------------------------------------------- queue
// The host's defaults: announcements and the bell on, inbox and sending off.
if (run('queue')) {
  const page = await open('?flags=host');
  await wait(page, 700);
  await shot(page, '80-queue-modal-first');
  await page.getByRole('button', { name: 'Понятно' }).click();
  await wait(page, 120);
  await shot(page, '81-queue-modal-leaving');
  await wait(page, 1300);
  await shot(page, '82-queue-modal-second');
  await page.getByRole('button', { name: 'Понятно' }).click();
  await wait(page, 1500);
  await shot(page, '83-queue-strip-first');
  await page
    .getByRole('button', { name: 'Закрыть объявление' })
    .first()
    .click();
  await wait(page, 150);
  await shot(page, '84-queue-strip-leaving');
  await wait(page, 1400);
  await shot(page, '85-queue-strip-second');
  await page
    .getByRole('button', { name: 'Закрыть объявление' })
    .first()
    .click();
  await wait(page, 1600);
  await shot(page, '86-queue-deck');
  await page.getByRole('button', { name: /Уведомления, новых/ }).click();
  await wait(page, 600);
  await shot(page, '87-bell-announcements');
  await page.keyboard.press('Escape');
  await page
    .locator('.main')
    .getByRole('button', { name: /Плановые работы/ })
    .click();
  await wait(page, 700);
  await shot(page, '88-center-announcements-only');
  await page.context().close();
}
if (run('queue')) {
  const page = await open('?flags=host&theme=dark');
  await wait(page, 700);
  await shot(page, '89-queue-dark-modal');
  await page.getByRole('button', { name: 'Понятно' }).click();
  await wait(page, 1300);
  await page.getByRole('button', { name: 'Понятно' }).click();
  await wait(page, 1500);
  await shot(page, '90-queue-dark-strip');
  await page.context().close();
}

await browser.close();
await server.close();
console.log(
  errors.length ? `console errors:\n${errors.join('\n')}` : 'no console errors'
);

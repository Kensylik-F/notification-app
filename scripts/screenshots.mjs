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
const shot = (page, name, options = {}) =>
  page.screenshot({ path: resolve(OUT, `${name}.png`), ...options });
const acknowledge = async page => {
  await page.getByRole('button', { name: 'Понятно' }).click();
  await page.waitForTimeout(400);
};
const closeOverlays = async page => {
  for (const button of await page
    .locator('[class*="overlay"]')
    .getByRole('button', { name: 'Закрыть' })
    .all()) {
    await button.click().catch(() => {});
  }
  await page.waitForTimeout(300);
};

// ---------------------------------------------------------------- inbox
{
  const page = await open();
  await page.waitForTimeout(600);
  await shot(page, '01-modal-toast-corner');
  await acknowledge(page);
  await page.waitForTimeout(500);
  await shot(page, '02-list');
  await page
    .getByRole('button', { name: /Уведомления, непрочитанных/ })
    .click();
  await page.waitForTimeout(700);
  await shot(page, '03-bell-open');
  await page
    .getByRole('dialog')
    .getByRole('button', { name: /Нужна информация по предзаказу/ })
    .click();
  await page.waitForTimeout(500);
  await shot(page, '04-bell-row-expanded');
  await page.keyboard.press('Escape');
  await closeOverlays(page);
  await page
    .locator('.main')
    .getByRole('button', { name: /Выгрузка готова/ })
    .first()
    .click();
  await page.waitForTimeout(600);
  await shot(page, '05-list-row-expanded');
  await page.getByRole('tab', { name: /Непрочитанные/ }).click();
  await page.waitForTimeout(600);
  await shot(page, '06-unread-tab');
  await page.getByRole('tab', { name: 'Все' }).click();
  await page.getByRole('button', { name: 'Показать ещё' }).click();
  await page.waitForTimeout(700);
  await page.locator('.main').evaluate(el => el.scrollTo(0, el.scrollHeight));
  await page.waitForTimeout(200);
  await shot(page, '07-load-more-bottom');
  await page.context().close();
}
{
  const page = await open('?item=00000000-0000-4000-8000-000000000002');
  await acknowledge(page);
  await closeOverlays(page);
  await page.waitForTimeout(500);
  await shot(page, '08-item-page');
  await page.context().close();
}

// -------------------------------------------------------------- compose
{
  const page = await open('?view=compose');
  await acknowledge(page);
  await closeOverlays(page);
  await shot(page, '10-compose-empty');
  await page.getByRole('button', { name: 'Отправить' }).click();
  await page.waitForTimeout(200);
  await shot(page, '11-compose-errors');

  await page
    .getByLabel('Шаблон', { exact: false })
    .first()
    .selectOption('welcome');
  await page.getByRole('button', { name: 'Показать' }).click();
  await page.waitForTimeout(600);
  await shot(page, '12-compose-preview-missing-variable');

  await page.getByLabel('Продукт').fill('Sber Data');
  const recipients = page.getByLabel('Получатели');
  await recipients.fill('Иван');
  await page.waitForTimeout(700);
  await shot(page, '13-compose-recipient-search');
  await recipients.press('Enter');
  await recipients.fill('bad.mailbox@sber.ru');
  await recipients.press('Enter');
  await recipients.fill('u-2001');
  await recipients.press('Enter');
  const form = page.locator('form');
  await form.getByText('Почта', { exact: true }).click();
  await form.getByText('В приложении', { exact: true }).click();
  await page.getByLabel('Категория').fill('account');
  await page.waitForTimeout(1000);
  await shot(page, '14-compose-filled', { fullPage: false });
  await page.locator('.main').evaluate(el => el.scrollTo(0, el.scrollHeight));
  await page.waitForTimeout(200);
  await shot(page, '15-compose-filled-bottom');
  await page.getByRole('button', { name: 'Отправить' }).click();
  await page.waitForTimeout(7500);
  await shot(page, '16-send-result');
  await page
    .getByRole('button', { name: 'Открыть в истории доставок' })
    .click();
  await page.waitForTimeout(800);
  await shot(page, '17-log-by-request');
  await page.context().close();
}

// ------------------------------------------------------------------ log
{
  const page = await open('?view=log');
  await acknowledge(page);
  await closeOverlays(page);
  await page.waitForTimeout(500);
  await shot(page, '20-log');
  await page.getByText('Не доставлена', { exact: true }).last().click();
  await page.waitForTimeout(400);
  await page
    .locator('tbody tr')
    .filter({ hasText: 'Не доставлена' })
    .first()
    .click();
  await page.waitForTimeout(700);
  await shot(page, '21-log-dead-expanded');
  await page.getByRole('button', { name: 'Показать текст' }).click();
  await page.waitForTimeout(600);
  await shot(page, '22-log-content');
  await page.context().close();
}

// ------------------------------------------------------------- announce
{
  const page = await open('?view=announce');
  await acknowledge(page);
  await closeOverlays(page);
  await shot(page, '30-announce-empty');
  await page.getByLabel('Категория').selectOption('platform-incident');
  await page.getByLabel('Шаблон').selectOption('platform-release');
  await page.getByLabel('Продукт').fill('Sber Data');
  await page.getByLabel('Версия').fill('2.4');
  await page.getByRole('button', { name: 'Показать' }).click();
  await page.waitForTimeout(800);
  await shot(page, '31-announce-filled');
  await page.getByRole('button', { name: 'Опубликовать' }).click();
  await page.waitForTimeout(300);
  await page.locator('.main').evaluate(el => el.scrollTo(0, el.scrollHeight));
  await shot(page, '32-announce-confirm');
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: 'Опубликовать' })
    .click();
  await page.waitForTimeout(1500);
  // The publisher is in the audience: the incident shows up as a modal.
  await shot(page, '33a-announce-published-modal');
  await acknowledge(page);
  await page.waitForTimeout(1500);
  await page.locator('.main').evaluate(el => el.scrollTo(0, el.scrollHeight));
  await page.waitForTimeout(200);
  await shot(page, '33-announce-published-run');
  await page.getByRole('button', { name: 'Исправить текст' }).click();
  await page.waitForTimeout(400);
  await page.locator('.main').evaluate(el => el.scrollTo(0, el.scrollHeight));
  await shot(page, '34-announce-correction');
  await page.context().close();
}

// ---------------------------------------------------------- dark, narrow
{
  const page = await open('?theme=dark&view=compose');
  await acknowledge(page);
  await closeOverlays(page);
  await page.getByLabel('Шаблон').first().selectOption('platform-release');
  await page.getByRole('button', { name: 'Показать' }).click();
  await page.waitForTimeout(700);
  await shot(page, '40-dark-compose');
  await page
    .getByRole('button', { name: /Уведомления, непрочитанных/ })
    .click();
  await page.waitForTimeout(700);
  await shot(page, '41-dark-bell');
  await page.context().close();
}
{
  const page = await open('?theme=dark&view=log');
  await acknowledge(page);
  await closeOverlays(page);
  await page.locator('tbody tr').first().click();
  await page.waitForTimeout(700);
  await shot(page, '42-dark-log');
  await page.context().close();
}
{
  const page = await open('', { width: 420, height: 800 });
  await acknowledge(page);
  await page.waitForTimeout(500);
  await shot(page, '50-narrow-list');
  await page.context().close();
}
{
  const page = await open('?view=compose', { width: 420, height: 800 });
  await acknowledge(page);
  await closeOverlays(page);
  await shot(page, '51-narrow-compose');
  await page.context().close();
}

await browser.close();
await server.close();
console.log(
  errors.length ? `console errors:\n${errors.join('\n')}` : 'no console errors'
);

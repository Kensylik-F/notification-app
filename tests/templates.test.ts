import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { format, resolveConfig } from 'prettier';
import { describe, expect, it } from 'vitest';

import {
  buildCatalog,
  renderCatalog,
  scanVariables,
  // @ts-expect-error - plain ESM script without type declarations
} from '../scripts/generate-templates.mjs';

const ROOT = resolve(__dirname, '..');
const GENERATED = resolve(
  ROOT,
  'src/notifications-kit/core/generated/templates.ts'
);

describe('template catalogue', () => {
  it('matches the committed service templates', async () => {
    const content = renderCatalog(
      buildCatalog(resolve(ROOT, 'contract/templates'))
    );
    const config = await resolveConfig(GENERATED);
    const expected = await format(content, { ...config, filepath: GENERATED });
    expect(readFileSync(GENERATED, 'utf8')).toBe(expected);
  });

  it('tells required from optional variables', () => {
    const scan = scanVariables(`
      <#-- ${'${'}commented} is ignored -->
      Hello ${'${'}recipient.displayName}, ${'${'}productName} ${'${'}version}
      ${'${'}note!""}
      <#if link??><a href="${'${'}link}">go</a></#if>
      <#list items as item>${'${'}item.title}</#list>
    `);
    expect([...scan.required].sort()).toEqual([
      'items',
      'productName',
      'version',
    ]);
    expect([...scan.optional].sort()).toEqual(['link', 'note']);
    expect(scan.usesRecipient).toBe(true);
  });
});

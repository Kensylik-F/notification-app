import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { format, resolveConfig } from 'prettier';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

// @ts-expect-error - plain ESM script without type declarations
import { generate, servicePath } from '../scripts/generate-contract.mjs';
import { OPERATIONS } from '../src/notifications-kit/core';

const ROOT = resolve(__dirname, '..');
const CONTRACT = resolve(ROOT, 'contract/notification-service.openapi.yaml');
const GENERATED = resolve(ROOT, 'src/notifications-kit/core/generated');

describe('contract', () => {
  const source = readFileSync(CONTRACT, 'utf8');

  it('generated files match the committed OpenAPI document', async () => {
    const files = generate(source) as Record<string, string>;
    for (const [name, content] of Object.entries(files)) {
      const path = resolve(GENERATED, name);
      const config = await resolveConfig(path);
      const expected = await format(content, { ...config, filepath: path });
      expect(readFileSync(path, 'utf8'), name).toBe(expected);
    }
  });

  it('every operation of the document is in the table, and nothing else', () => {
    const doc = parse(source) as {
      paths: Record<string, Record<string, unknown>>;
    };
    const documented: string[] = [];
    for (const [path, item] of Object.entries(doc.paths)) {
      for (const method of ['get', 'post', 'put', 'patch', 'delete']) {
        if (item[method]) {
          documented.push(`${method.toUpperCase()} ${servicePath(path)}`);
        }
      }
    }
    expect(Object.keys(OPERATIONS).sort()).toEqual(documented.sort());
  });
});

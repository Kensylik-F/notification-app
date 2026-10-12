// Generates the wire schemas and the operation table of notifications-kit
// from the committed OpenAPI document. Nothing in core/generated is written
// by hand: to change it, change the contract and run `npm run generate`.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CONTRACT = resolve(ROOT, 'contract/notification-service.openapi.yaml');
const OUT_DIR = resolve(ROOT, 'src/notifications-kit/core/generated');

const METHODS = ['get', 'post', 'put', 'patch', 'delete'];
const ODATA_PARAMS = ['$filter', '$orderby', '$top', '$skip', '$count'];

const refName = ref => ref.replace('#/components/schemas/', '');
const schemaConst = name => `${name}Schema`;

/** Schemas reachable from a request body are "request" schemas: their
 *  constraints are enforced and absent members are omitted, not null. */
function collectRequestSchemas(doc) {
  const schemas = doc.components.schemas;
  const seen = new Set();
  const visit = node => {
    if (!node || typeof node !== 'object') return;
    if (node.$ref) {
      const name = refName(node.$ref);
      if (seen.has(name)) return;
      seen.add(name);
      visit(schemas[name]);
      return;
    }
    Object.values(node).forEach(visit);
  };
  for (const item of Object.values(doc.paths)) {
    for (const method of METHODS) {
      const body = item[method]?.requestBody;
      if (body) visit(body);
    }
  }
  return seen;
}

function directRefs(node, out = new Set()) {
  if (!node || typeof node !== 'object') return out;
  if (node.$ref) {
    out.add(refName(node.$ref));
    return out;
  }
  Object.values(node).forEach(child => directRefs(child, out));
  return out;
}

function topoSort(schemas) {
  const order = [];
  const state = new Map();
  const visit = name => {
    if (state.get(name) === 'done') return;
    if (state.get(name) === 'active') return; // self or mutual recursion
    state.set(name, 'active');
    for (const dep of directRefs(schemas[name])) {
      if (dep !== name) visit(dep);
    }
    state.set(name, 'done');
    order.push(name);
  };
  Object.keys(schemas).sort().forEach(visit);
  return order;
}

function zodFor(node, ctx) {
  if (node.$ref) return schemaConst(refName(node.$ref));

  if (node.enum) {
    return `z.enum([${node.enum.map(v => JSON.stringify(v)).join(', ')}])`;
  }

  switch (node.type) {
    case 'string': {
      if (node.format === 'uuid') return 'z.uuid()';
      if (node.format === 'date-time') {
        return 'z.iso.datetime({ offset: true })';
      }
      let out = 'z.string()';
      if (ctx.request) {
        if (node.minLength) out += `.min(${node.minLength})`;
        if (node.maxLength !== undefined) out += `.max(${node.maxLength})`;
        if (node.pattern) {
          // Bean Validation @Pattern matches the whole value.
          out += `.regex(/^(?:${node.pattern})$/)`;
        }
      }
      return out;
    }
    case 'integer':
      return 'z.number().int()';
    case 'number':
      return 'z.number()';
    case 'boolean':
      return 'z.boolean()';
    case 'array': {
      let out = `z.array(${zodFor(node.items, ctx)})`;
      if (ctx.request) {
        if (node.minItems) out += `.min(${node.minItems})`;
        if (node.maxItems !== undefined) out += `.max(${node.maxItems})`;
        if (node.uniqueItems) {
          out +=
            ".refine(items => new Set(items).size === items.length, { error: 'Items must be unique' })";
        }
      }
      return out;
    }
    case 'object': {
      if (node.additionalProperties && !node.properties) {
        return 'z.record(z.string(), z.unknown())';
      }
      throw new Error(
        'Inline object schemas are not expected in this contract'
      );
    }
    default:
      throw new Error(`Unsupported schema node: ${JSON.stringify(node)}`);
  }
}

function emitSchema(name, node, ctx) {
  if (node.type !== 'object' || !node.properties) {
    throw new Error(`Component ${name} is not an object schema`);
  }
  const required = new Set(node.required ?? []);
  const lines = [];
  for (const [prop, propNode] of Object.entries(node.properties)) {
    const selfRef = directRefs(propNode).has(name);
    let expr = zodFor(propNode, ctx);
    if (!required.has(prop)) {
      expr += ctx.request ? '.optional()' : '.nullish()';
    }
    const doc = propNode.description
      ? `  /** ${propNode.description.replace(/\*\//g, '*\\/')} */\n`
      : '';
    lines.push(
      selfRef
        ? `${doc}  get ${prop}() {\n    return ${expr};\n  },`
        : `${doc}  ${prop}: ${expr},`
    );
  }
  const header = node.description ? `/** ${node.description} */\n` : '';
  return (
    `${header}export const ${schemaConst(name)} = z.object({\n` +
    `${lines.join('\n')}\n});\n` +
    `export type ${name} = z.infer<typeof ${schemaConst(name)}>;\n`
  );
}

function responseOf(operation) {
  const ok = operation.responses?.['200'];
  const schema = ok?.content && Object.values(ok.content)[0]?.schema;
  if (!schema) return { expr: 'null', kind: 'void' };
  if (schema.$ref) {
    return { expr: schemaConst(refName(schema.$ref)), kind: 'object' };
  }
  if (schema.type === 'array' && schema.items?.$ref) {
    return {
      expr: `z.array(${schemaConst(refName(schema.items.$ref))})`,
      kind: 'array',
    };
  }
  throw new Error(`Unsupported response schema: ${JSON.stringify(schema)}`);
}

function requestOf(operation) {
  const body = operation.requestBody;
  if (!body) return null;
  const schema = body.content?.['application/json']?.schema;
  if (schema?.$ref) return schemaConst(refName(schema.$ref));
  // The receipts callback carries a raw provider payload.
  if (schema?.type === 'string') return 'z.string()';
  throw new Error(`Unsupported request schema: ${JSON.stringify(schema)}`);
}

function emitOperations(doc) {
  const entries = [];
  for (const [path, item] of Object.entries(doc.paths)) {
    for (const method of METHODS) {
      const operation = item[method];
      if (!operation) continue;
      const params = operation.parameters ?? [];
      const names = where =>
        params.filter(p => p.in === where).map(p => p.name);
      const queryAll = names('query');
      const odata = ODATA_PARAMS.every(p => queryAll.includes(p));
      // springdoc renders the ODataQueryOptions argument as a required
      // `options` query parameter next to the real $-options. It is an
      // artefact of the document, not something the service reads.
      const query = queryAll.filter(p => !(odata && p === 'options'));
      const requiredQuery = params
        .filter(p => p.in === 'query' && p.required && query.includes(p.name))
        .map(p => p.name);
      const response = responseOf(operation);
      const request = requestOf(operation);
      const list = values =>
        `[${values.map(v => JSON.stringify(v)).join(', ')}]`;
      entries.push(
        `  ${JSON.stringify(`${method.toUpperCase()} ${path}`)}: {\n` +
          `    method: ${JSON.stringify(method.toUpperCase())},\n` +
          `    path: ${JSON.stringify(path)},\n` +
          `    summary: ${JSON.stringify(operation.summary ?? '')},\n` +
          `    tag: ${JSON.stringify(operation.tags?.[0] ?? '')},\n` +
          `    pathParams: ${list(names('path'))},\n` +
          `    queryParams: ${list(query)},\n` +
          `    requiredQueryParams: ${list(requiredQuery)},\n` +
          `    headerParams: ${list(names('header'))},\n` +
          `    odata: ${odata},\n` +
          `    requestBodyRequired: ${Boolean(operation.requestBody?.required)},\n` +
          `    request: ${request ?? 'null'},\n` +
          `    response: ${response.expr},\n` +
          `  },`
      );
    }
  }
  return entries.join('\n');
}

export function generate(source) {
  const doc = parse(source);
  const schemas = doc.components.schemas;
  const requestSchemas = collectRequestSchemas(doc);
  const banner =
    '// GENERATED by scripts/generate-contract.mjs from\n' +
    '// contract/notification-service.openapi.yaml. Do not edit by hand.\n';

  const schemaFile =
    `${banner}import { z } from 'zod';\n\n` +
    topoSort(schemas)
      .map(name =>
        emitSchema(name, schemas[name], { request: requestSchemas.has(name) })
      )
      .join('\n');

  const used = new Set();
  const operationsBody = emitOperations(doc);
  for (const match of operationsBody.matchAll(/\b([A-Z][A-Za-z]+Schema)\b/g)) {
    used.add(match[1]);
  }
  const operationsFile =
    `${banner}import { z } from 'zod';\n\n` +
    `import {\n${[...used]
      .sort()
      .map(n => `  ${n},`)
      .join('\n')}\n} from './schemas';\n\n` +
    `export const CONTRACT_INFO = {\n` +
    `  title: ${JSON.stringify(doc.info.title)},\n` +
    `  version: ${JSON.stringify(doc.info.version)},\n` +
    `} as const;\n\n` +
    `export const OPERATIONS = {\n${operationsBody}\n} as const;\n\n` +
    `export type OperationKey = keyof typeof OPERATIONS;\n`;

  return { 'schemas.ts': schemaFile, 'operations.ts': operationsFile };
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  const { mkdirSync } = await import('node:fs');
  const { execFileSync } = await import('node:child_process');
  mkdirSync(OUT_DIR, { recursive: true });
  const files = generate(readFileSync(CONTRACT, 'utf8'));
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(resolve(OUT_DIR, name), content, 'utf8');
  }
  execFileSync(
    resolve(ROOT, 'node_modules/.bin/prettier'),
    ['--write', '--log-level', 'warn', OUT_DIR],
    { stdio: 'inherit' }
  );
  console.log(`generated ${Object.keys(files).join(', ')}`);
}

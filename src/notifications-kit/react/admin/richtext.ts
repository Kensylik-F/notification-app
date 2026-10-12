/**
 * HTML written in the editor is cleaned before it leaves the browser: the
 * free-form template prints `bodyHtml` unescaped, so the kit is what keeps
 * it to plain document markup. Runs in the browser (DOMParser).
 */

const BLOCKS = new Set([
  'p',
  'h2',
  'h3',
  'ul',
  'ol',
  'li',
  'blockquote',
  'pre',
  'hr',
  'br',
]);
const INLINE = new Set(['strong', 'em', 'u', 's', 'code', 'a']);
/** Tags whose content is kept but the tag itself is renamed. */
const RENAME: Record<string, string> = {
  b: 'strong',
  i: 'em',
  strike: 's',
  del: 's',
  h1: 'h2',
  h4: 'h3',
  h5: 'h3',
  h6: 'h3',
  div: 'p',
};
/** Removed together with everything inside. */
const DROP = new Set([
  'script',
  'style',
  'iframe',
  'object',
  'embed',
  'form',
  'input',
  'button',
  'select',
  'textarea',
  'svg',
  'math',
  'template',
  'noscript',
  'head',
  'title',
  'meta',
  'link',
  'img',
  'video',
  'audio',
]);

const SAFE_HREF = /^(https?:|mailto:)/i;

function cleanChildren(source: Node, target: Node, doc: Document) {
  source.childNodes.forEach(child => {
    if (child.nodeType === Node.TEXT_NODE) {
      target.appendChild(doc.createTextNode(child.textContent ?? ''));
      return;
    }
    if (child.nodeType !== Node.ELEMENT_NODE) return;
    const element = child as Element;
    let tag = element.tagName.toLowerCase();
    if (DROP.has(tag)) return;
    tag = RENAME[tag] ?? tag;
    if (!BLOCKS.has(tag) && !INLINE.has(tag)) {
      // Unknown wrapper (span, font, section…): keep its text, lose the tag.
      cleanChildren(element, target, doc);
      return;
    }
    const clean = doc.createElement(tag);
    if (tag === 'a') {
      const href = element.getAttribute('href')?.trim() ?? '';
      if (!SAFE_HREF.test(href)) {
        cleanChildren(element, target, doc);
        return;
      }
      clean.setAttribute('href', href);
      clean.setAttribute('target', '_blank');
      clean.setAttribute('rel', 'noopener noreferrer');
    }
    cleanChildren(element, clean, doc);
    target.appendChild(clean);
  });
}

/** Whitelisted tags only, no attributes except a safe `href`. */
export function sanitizeHtml(html: string): string {
  const source = new DOMParser().parseFromString(html, 'text/html');
  const doc = document.implementation.createHTMLDocument('');
  const root = doc.createElement('div');
  cleanChildren(source.body, root, doc);
  // Bare text at the top level becomes a paragraph, so the email template
  // gets block markup.
  const out = doc.createElement('div');
  let loose: HTMLElement | null = null;
  root.childNodes.forEach(node => {
    const isBlock =
      node.nodeType === Node.ELEMENT_NODE &&
      BLOCKS.has((node as Element).tagName.toLowerCase());
    if (isBlock) {
      loose = null;
      out.appendChild(node.cloneNode(true));
      return;
    }
    if (node.nodeType === Node.TEXT_NODE && !node.textContent?.trim()) {
      if (loose) loose.appendChild(node.cloneNode(true));
      return;
    }
    if (!loose) {
      loose = doc.createElement('p');
      out.appendChild(loose);
    }
    loose.appendChild(node.cloneNode(true));
  });
  // Empty paragraphs left by the editor.
  out.querySelectorAll('p').forEach(p => {
    if (!p.textContent?.trim() && !p.querySelector('br')) p.remove();
  });
  return out.innerHTML.trim();
}

/** The plain-text twin of the HTML body, for mail clients without HTML. */
export function htmlToText(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const lines: string[] = [];
  let current = '';
  const flush = () => {
    const line = current.replace(/[ \t]+/g, ' ').trim();
    if (line) lines.push(line);
    current = '';
  };
  const walk = (node: Node, listDepth: number, ordered: number[] | null) => {
    node.childNodes.forEach(child => {
      if (child.nodeType === Node.TEXT_NODE) {
        current += (child.textContent ?? '').replace(/\s+/g, ' ');
        return;
      }
      if (child.nodeType !== Node.ELEMENT_NODE) return;
      const el = child as Element;
      const tag = el.tagName.toLowerCase();
      if (tag === 'br') {
        flush();
        lines.push('');
        return;
      }
      if (tag === 'hr') {
        flush();
        lines.push('———');
        return;
      }
      if (tag === 'ul' || tag === 'ol') {
        flush();
        walk(el, listDepth + 1, tag === 'ol' ? [0] : null);
        flush();
        if (listDepth === 0) lines.push('');
        return;
      }
      if (tag === 'li') {
        flush();
        const indent = '  '.repeat(Math.max(0, listDepth - 1));
        if (ordered) ordered[0] = (ordered[0] ?? 0) + 1;
        current = `${indent}${ordered ? `${ordered[0]}.` : '•'} `;
        walk(el, listDepth, null);
        flush();
        return;
      }
      if (tag === 'a') {
        const before = current.length;
        walk(el, listDepth, ordered);
        const text = current.slice(before).trim();
        const href = el.getAttribute('href') ?? '';
        if (href && href !== text)
          current += ` (${href.replace(/^mailto:/, '')})`;
        return;
      }
      const block = /^(p|h2|h3|blockquote|pre|div)$/.test(tag);
      if (block) flush();
      walk(el, listDepth, ordered);
      if (block) {
        flush();
        lines.push('');
      }
    });
  };
  walk(doc.body, 0, null);
  flush();
  return lines
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

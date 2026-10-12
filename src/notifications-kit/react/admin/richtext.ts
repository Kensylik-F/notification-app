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

/** Blocks that cannot sit inside a paragraph. */
const NOT_IN_PARAGRAPH = new Set([
  'p',
  'div',
  'ul',
  'ol',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'blockquote',
  'pre',
  'hr',
  'table',
  'section',
  'article',
]);

const hasBlockChild = (element: Element) =>
  Array.from(element.children).some(child =>
    NOT_IN_PARAGRAPH.has(child.tagName.toLowerCase())
  );

function cleanChildren(source: Node, target: Node, doc: Document) {
  source.childNodes.forEach(child => {
    if (child.nodeType === Node.TEXT_NODE) {
      // Editors pad formatting edges with no-break spaces; mail wants plain.
      const text = (child.textContent ?? '').replace(/\u00a0/g, ' ');
      target.appendChild(doc.createTextNode(text));
      return;
    }
    if (child.nodeType !== Node.ELEMENT_NODE) return;
    const element = child as Element;
    let tag = element.tagName.toLowerCase();
    if (DROP.has(tag)) return;
    // A wrapper holding blocks (an editor's <div> around a list) is
    // dissolved: a list or heading inside a paragraph is invalid markup.
    if ((tag === 'div' || tag === 'p') && hasBlockChild(element)) {
      dissolve(element, target, doc);
      return;
    }
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

/** A wrapper's children at its own level: runs of text and inline markup
 *  become paragraphs, blocks stay blocks. */
function dissolve(element: Element, target: Node, doc: Document) {
  let run: HTMLElement | null = null;
  element.childNodes.forEach(child => {
    const isBlock =
      child.nodeType === Node.ELEMENT_NODE &&
      NOT_IN_PARAGRAPH.has((child as Element).tagName.toLowerCase());
    if (isBlock) {
      run = null;
      const holder = doc.createElement('div');
      holder.appendChild(child.cloneNode(true));
      cleanChildren(holder, target, doc);
      return;
    }
    if (!run) {
      run = doc.createElement('p');
      target.appendChild(run);
    }
    const holder = doc.createElement('div');
    holder.appendChild(child.cloneNode(true));
    cleanChildren(holder, run, doc);
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
  // Empty lines left by the editor (`<p><br></p>`): paragraphs already
  // have their own spacing, and an all-empty body must read as empty.
  out.querySelectorAll('p, h2, h3, li, blockquote').forEach(block => {
    if (!block.textContent?.trim()) block.remove();
  });
  out.querySelectorAll('ul, ol').forEach(list => {
    if (!list.querySelector('li')) list.remove();
  });
  // Only line breaks or rules left: nothing was written.
  if (!out.textContent?.trim()) return '';
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
        const target = (el.getAttribute('href') ?? '').replace(/^mailto:/i, '');
        if (target && target !== text) current += ` (${target})`;
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

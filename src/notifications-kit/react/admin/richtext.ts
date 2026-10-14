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
  'table',
  'thead',
  'tbody',
  'tr',
  'th',
  'td',
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
/** A path inside the cabinet: `/preorders/new`, not `//elsewhere`. */
const APP_PATH = /^\/(?!\/)/;

/**
 * The address a link keeps. A path inside the cabinet becomes a full
 * address on the cabinet's origin, so it also works in an email or a chat;
 * in the cabinet itself the kit opens it in place (see `navigate`).
 */
export function linkTarget(href: string, origin?: string): string | null {
  const value = href.trim();
  if (SAFE_HREF.test(value)) return value;
  if (APP_PATH.test(value)) {
    const base =
      origin ?? (typeof window === 'undefined' ? '' : window.location.origin);
    if (!base) return null;
    try {
      return new URL(value, base).href;
    } catch {
      return null;
    }
  }
  return null;
}

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
    // Inline markup around blocks (what a browser makes of a <b> left open
    // across paragraphs) is unwrapped: <strong><p> is invalid markup.
    if (INLINE.has(RENAME[tag] ?? tag) && hasBlockChild(element)) {
      cleanChildren(element, target, doc);
      return;
    }
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
      const href = linkTarget(element.getAttribute('href') ?? '');
      if (!href) {
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
  // A paragraph cannot hold blocks; where unwrapped markup left one inside
  // another, split it: runs of text become paragraphs, blocks stay blocks.
  Array.from(out.querySelectorAll('p'))
    .reverse()
    .forEach(paragraph => {
      if (!hasBlockChild(paragraph)) return;
      const parts: Node[] = [];
      let run: HTMLElement | null = null;
      Array.from(paragraph.childNodes).forEach(child => {
        const isBlock =
          child.nodeType === Node.ELEMENT_NODE &&
          NOT_IN_PARAGRAPH.has((child as Element).tagName.toLowerCase());
        if (isBlock) {
          run = null;
          parts.push(child);
          return;
        }
        if (!run) {
          run = doc.createElement('p');
          parts.push(run);
        }
        run.appendChild(child);
      });
      paragraph.replaceWith(...parts);
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
  // Indent of a nested list item, kept apart so trimming does not eat it.
  let indentNext = '';
  const flush = () => {
    const line = current.replace(/[ \t]+/g, ' ').trim();
    if (line) lines.push(`${indentNext}${line}`);
    current = '';
    indentNext = '';
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
        indentNext = indent;
        current = `${ordered ? `${ordered[0]}.` : '•'} `;
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
      if (tag === 'tr') {
        flush();
        const cells = Array.from(el.children).map(cell =>
          (cell.textContent ?? '').replace(/\s+/g, ' ').trim()
        );
        lines.push(cells.join(' | '));
        return;
      }
      if (tag === 'table') {
        flush();
        walk(el, listDepth, ordered);
        lines.push('');
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

/** Removed from HTML the service returns before it is shown. */
const DISPLAY_DROP = new Set([
  'script',
  'style',
  'iframe',
  'frame',
  'frameset',
  'object',
  'embed',
  'form',
  'input',
  'button',
  'select',
  'textarea',
  'link',
  'meta',
  'base',
  'template',
  'noscript',
]);
const UNSAFE_URL = /^\s*(javascript|vbscript|data):/i;

/**
 * HTML from the service, made safe and stable to show. Whatever wrote it
 * (the editor, another template, another service), this drops scripts,
 * styles, frames and forms, event attributes and script URLs; ordinary
 * markup, tables, images and inline styles stay. It is shown in a frame
 * without scripts as well - this keeps what it shows predictable.
 */
export function cleanForDisplay(html: string): string {
  if (typeof DOMParser === 'undefined') return html;
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.body.querySelectorAll('*').forEach(element => {
    // Inside something already removed.
    if (!doc.body.contains(element)) return;
    if (DISPLAY_DROP.has(element.tagName.toLowerCase())) {
      element.remove();
      return;
    }
    Array.from(element.attributes).forEach(attribute => {
      const name = attribute.name.toLowerCase();
      if (name.startsWith('on')) element.removeAttribute(attribute.name);
      else if (
        (name === 'href' || name === 'src' || name === 'action') &&
        UNSAFE_URL.test(attribute.value)
      ) {
        element.removeAttribute(attribute.name);
      }
    });
  });
  return doc.body.innerHTML;
}

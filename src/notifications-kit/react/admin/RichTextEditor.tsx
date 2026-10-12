/**
 * A small rich-text editor for message bodies: headings, bold/italic,
 * lists, quote, links, and an "HTML" tab for whoever wants the markup.
 * Output is cleaned by `sanitizeHtml` - the same whitelist the free-form
 * template relies on. No dependencies: contentEditable + execCommand, which
 * every browser the host supports still implements.
 */
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { ClipboardEvent, ReactNode } from 'react';

import { useNotificationsContext } from '../context';
import { Button, cx } from '../primitives';
import styles from './admin.module.css';
import { Segmented } from './forms';
import { sanitizeHtml } from './richtext';

type Command =
  | 'bold'
  | 'italic'
  | 'underline'
  | 'strikeThrough'
  | 'insertUnorderedList'
  | 'insertOrderedList';

const STATEFUL: Command[] = [
  'bold',
  'italic',
  'underline',
  'strikeThrough',
  'insertUnorderedList',
  'insertOrderedList',
];

interface RichTextEditorProps {
  /** Clean HTML. */
  value: string;
  onChange: (html: string) => void;
  id?: string;
  invalid?: boolean;
  describedBy?: string;
  placeholder?: string;
  /** Visible label for screen readers when `id` is not wired to a label. */
  ariaLabel?: string;
}

function ToolButton({
  label,
  active,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type='button'
      className={styles.toolButton}
      aria-label={label}
      title={label}
      aria-pressed={active}
      // Keep the selection in the editable area.
      onPointerDown={event => event.preventDefault()}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

export function RichTextEditor({
  value,
  onChange,
  id,
  invalid,
  describedBy,
  placeholder,
  ariaLabel,
}: RichTextEditorProps) {
  const { t } = useNotificationsContext();
  const areaRef = useRef<HTMLDivElement>(null);
  const emitted = useRef<string | null>(null);
  const savedRange = useRef<Range | null>(null);
  const [view, setView] = useState<'visual' | 'html'>('visual');
  const [source, setSource] = useState(value);
  const [states, setStates] = useState<
    Partial<Record<Command | 'h2' | 'blockquote', boolean>>
  >({});
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState('');
  const linkInputId = useId();

  // Outside changes (reset, the HTML tab) are written into the area; our own
  // edits are not, so the caret does not jump.
  useEffect(() => {
    const area = areaRef.current;
    if (!area || view !== 'visual') return;
    if (value === emitted.current) return;
    area.innerHTML = value;
    emitted.current = value;
  }, [value, view]);

  const emit = useCallback(() => {
    const area = areaRef.current;
    if (!area) return;
    const clean = sanitizeHtml(area.innerHTML);
    emitted.current = clean;
    onChange(clean);
  }, [onChange]);

  const refreshStates = useCallback(() => {
    const area = areaRef.current;
    const selection = document.getSelection();
    if (
      !area ||
      !selection?.anchorNode ||
      !area.contains(selection.anchorNode)
    ) {
      return;
    }
    const next: typeof states = {};
    for (const command of STATEFUL) {
      try {
        next[command] = document.queryCommandState(command);
      } catch {
        next[command] = false;
      }
    }
    const block = String(document.queryCommandValue('formatBlock') || '')
      .toLowerCase()
      .replace(/[<>]/g, '');
    next.h2 = block === 'h2';
    next.blockquote = block === 'blockquote';
    setStates(next);
  }, []);

  useEffect(() => {
    document.addEventListener('selectionchange', refreshStates);
    return () => document.removeEventListener('selectionchange', refreshStates);
  }, [refreshStates]);

  const run = (command: string, argument?: string) => {
    areaRef.current?.focus();
    document.execCommand(command, false, argument);
    emit();
    refreshStates();
  };

  const toggleBlock = (tag: 'h2' | 'blockquote') =>
    run('formatBlock', states[tag] ? '<p>' : `<${tag}>`);

  const openLink = () => {
    const selection = document.getSelection();
    if (selection && selection.rangeCount > 0) {
      savedRange.current = selection.getRangeAt(0).cloneRange();
    }
    const anchor = selection?.anchorNode?.parentElement?.closest('a');
    setLinkUrl(anchor?.getAttribute('href') ?? 'https://');
    setLinkOpen(true);
  };

  const restoreSelection = () => {
    const range = savedRange.current;
    if (!range) return;
    areaRef.current?.focus();
    const selection = document.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  };

  const applyLink = () => {
    const url = linkUrl.trim();
    restoreSelection();
    if (/^(https?:\/\/|mailto:)\S+/i.test(url)) {
      const selection = document.getSelection();
      if (selection && selection.isCollapsed) {
        run(
          'insertHTML',
          `<a href="${url.replace(/"/g, '&quot;')}">${url.replace(/</g, '&lt;')}</a>`
        );
      } else run('createLink', url);
    }
    setLinkOpen(false);
  };

  const onPaste = (event: ClipboardEvent<HTMLDivElement>) => {
    event.preventDefault();
    const html = event.clipboardData.getData('text/html');
    const text = event.clipboardData.getData('text/plain');
    if (html) run('insertHTML', sanitizeHtml(html));
    else run('insertText', text);
  };

  const switchView = (next: 'visual' | 'html') => {
    if (next === view) return;
    if (next === 'html') setSource(value);
    else {
      const clean = sanitizeHtml(source);
      emitted.current = null;
      onChange(clean);
    }
    setView(next);
    setLinkOpen(false);
  };

  return (
    <div className={styles.editor} data-invalid={invalid || undefined}>
      <div className={styles.editorBar}>
        {view === 'visual' ? (
          <div
            className={styles.toolbar}
            role='toolbar'
            aria-label={t('editor.toolbar')}
          >
            <ToolButton
              label={t('editor.heading')}
              active={states.h2}
              onClick={() => toggleBlock('h2')}
            >
              <span className={styles.toolGlyph}>H</span>
            </ToolButton>
            <span className={styles.toolSep} aria-hidden='true' />
            <ToolButton
              label={t('editor.bold')}
              active={states.bold}
              onClick={() => run('bold')}
            >
              <strong className={styles.toolGlyph}>B</strong>
            </ToolButton>
            <ToolButton
              label={t('editor.italic')}
              active={states.italic}
              onClick={() => run('italic')}
            >
              <em className={styles.toolGlyph}>I</em>
            </ToolButton>
            <ToolButton
              label={t('editor.underline')}
              active={states.underline}
              onClick={() => run('underline')}
            >
              <u className={styles.toolGlyph}>U</u>
            </ToolButton>
            <ToolButton
              label={t('editor.strike')}
              active={states.strikeThrough}
              onClick={() => run('strikeThrough')}
            >
              <s className={styles.toolGlyph}>S</s>
            </ToolButton>
            <span className={styles.toolSep} aria-hidden='true' />
            <ToolButton
              label={t('editor.bullets')}
              active={states.insertUnorderedList}
              onClick={() => run('insertUnorderedList')}
            >
              <svg
                viewBox='0 0 24 24'
                className={styles.toolIcon}
                aria-hidden='true'
              >
                <path d='M9 6h11M9 12h11M9 18h11' />
                <circle cx='4.5' cy='6' r='1.2' />
                <circle cx='4.5' cy='12' r='1.2' />
                <circle cx='4.5' cy='18' r='1.2' />
              </svg>
            </ToolButton>
            <ToolButton
              label={t('editor.numbers')}
              active={states.insertOrderedList}
              onClick={() => run('insertOrderedList')}
            >
              <svg
                viewBox='0 0 24 24'
                className={styles.toolIcon}
                aria-hidden='true'
              >
                <path d='M10 6h10M10 12h10M10 18h10' />
                <path d='M4 4.5h1.5V9M3.5 9h3M3.5 14.5c.4-.6 1-.9 1.6-.9.9 0 1.5.6 1.5 1.3 0 1.3-3.1 2.1-3.1 3.6h3.2' />
              </svg>
            </ToolButton>
            <ToolButton
              label={t('editor.quote')}
              active={states.blockquote}
              onClick={() => toggleBlock('blockquote')}
            >
              <svg
                viewBox='0 0 24 24'
                className={styles.toolIcon}
                aria-hidden='true'
              >
                <path d='M5 6v12M9 8h10M9 12h10M9 16h6' />
              </svg>
            </ToolButton>
            <ToolButton label={t('editor.link')} onClick={openLink}>
              <svg
                viewBox='0 0 24 24'
                className={styles.toolIcon}
                aria-hidden='true'
              >
                <path d='M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1' />
              </svg>
            </ToolButton>
            <span className={styles.toolSep} aria-hidden='true' />
            <ToolButton
              label={t('editor.clear')}
              onClick={() => run('removeFormat')}
            >
              <svg
                viewBox='0 0 24 24'
                className={styles.toolIcon}
                aria-hidden='true'
              >
                <path d='M6 5h12M12 5l-3 14M4 20l16-16' />
              </svg>
            </ToolButton>
          </div>
        ) : (
          <span className={styles.toolbarNote}>{t('editor.htmlNote')}</span>
        )}
        <Segmented
          name={`${linkInputId}-view`}
          value={view}
          options={[
            { value: 'visual', label: t('editor.visual') },
            { value: 'html', label: 'HTML' },
          ]}
          onChange={switchView}
        />
      </div>

      {linkOpen && view === 'visual' && (
        <div className={styles.linkBar}>
          <label className={styles.visuallyHidden} htmlFor={linkInputId}>
            {t('editor.linkUrl')}
          </label>
          <input
            id={linkInputId}
            className={styles.input}
            value={linkUrl}
            autoFocus
            spellCheck={false}
            onChange={event => setLinkUrl(event.target.value)}
            onKeyDown={event => {
              if (event.key === 'Enter') {
                event.preventDefault();
                applyLink();
              } else if (event.key === 'Escape') setLinkOpen(false);
            }}
          />
          <Button variant='primary' onClick={applyLink}>
            {t('editor.linkApply')}
          </Button>
          <Button
            variant='ghost'
            onClick={() => {
              restoreSelection();
              run('unlink');
              setLinkOpen(false);
            }}
          >
            {t('editor.unlink')}
          </Button>
        </div>
      )}

      {view === 'visual' ? (
        <div
          ref={areaRef}
          id={id}
          className={cx(styles.editorArea, styles.richContent)}
          contentEditable
          suppressContentEditableWarning
          role='textbox'
          aria-multiline='true'
          aria-label={ariaLabel}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          data-placeholder={placeholder}
          data-empty={!value || undefined}
          onInput={emit}
          onBlur={emit}
          onPaste={onPaste}
        />
      ) : (
        <textarea
          id={id}
          className={cx(styles.editorArea, styles.editorSource)}
          value={source}
          spellCheck={false}
          aria-label={ariaLabel}
          aria-describedby={describedBy}
          onChange={event => {
            // The form and the preview follow the markup as it is typed;
            // the textarea keeps exactly what was typed.
            setSource(event.target.value);
            emitted.current = null;
            onChange(sanitizeHtml(event.target.value));
          }}
        />
      )}
    </div>
  );
}

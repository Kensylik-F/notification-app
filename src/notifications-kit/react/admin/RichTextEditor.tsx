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
import { Button, Icon, cx } from '../primitives';
import styles from './admin.module.css';
import { linkTarget, sanitizeHtml } from './richtext';

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
  const [blockMenu, setBlockMenu] = useState(false);
  const blockRef = useRef<HTMLDivElement>(null);
  const linkInputId = useId();

  useEffect(() => {
    if (!blockMenu) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!blockRef.current?.contains(event.target as Node)) {
        setBlockMenu(false);
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setBlockMenu(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [blockMenu]);

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

  const setBlock = (tag: 'p' | 'h2' | 'blockquote') => {
    setBlockMenu(false);
    run('formatBlock', `<${tag}>`);
  };
  const block: 'p' | 'h2' | 'blockquote' = states.h2
    ? 'h2'
    : states.blockquote
      ? 'blockquote'
      : 'p';
  const blockLabel = {
    p: t('editor.paragraph'),
    h2: t('editor.heading'),
    blockquote: t('editor.quote'),
  };

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
    // A full address, mail, or a path inside the cabinet (`/preorders/new`).
    const href = /\s/.test(url) ? null : linkTarget(url);
    if (href) {
      const selection = document.getSelection();
      if (selection && selection.isCollapsed) {
        run(
          'insertHTML',
          `<a href="${href.replace(/"/g, '&quot;')}">${url.replace(/</g, '&lt;')}</a>`
        );
      } else run('createLink', href);
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
            <div ref={blockRef} className={styles.blockPicker}>
              <button
                type='button'
                className={cx(styles.toolButton, styles.toolWide)}
                aria-haspopup='menu'
                aria-expanded={blockMenu}
                onPointerDown={event => event.preventDefault()}
                onClick={() => setBlockMenu(v => !v)}
              >
                {blockLabel[block]}
                <Icon name='chevron' size={12} weight={2.4} />
              </button>
              {blockMenu && (
                <div className={styles.blockMenu} role='menu'>
                  {(['p', 'h2', 'blockquote'] as const).map(tag => (
                    <button
                      key={tag}
                      type='button'
                      role='menuitemradio'
                      aria-checked={block === tag}
                      className={styles.blockOption}
                      data-tag={tag}
                      onPointerDown={event => event.preventDefault()}
                      onClick={() => setBlock(tag)}
                    >
                      {blockLabel[tag]}
                    </button>
                  ))}
                </div>
              )}
            </div>
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
              <em className={cx(styles.toolGlyph, styles.toolSerif)}>I</em>
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
                <circle cx='4' cy='6' r='1' />
                <circle cx='4' cy='12' r='1' />
                <circle cx='4' cy='18' r='1' />
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
                <path d='M10 6h10M10 12h10M10 18h10M4 5h1v4M4 15h2l-2 3h2' />
              </svg>
            </ToolButton>
            <ToolButton label={t('editor.link')} onClick={openLink}>
              <svg
                viewBox='0 0 24 24'
                className={styles.toolIcon}
                aria-hidden='true'
              >
                <path d='M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1' />
              </svg>
            </ToolButton>
            <ToolButton
              label={t('editor.clear')}
              onClick={() => run('removeFormat')}
            >
              <svg
                viewBox='0 0 24 24'
                className={styles.toolIcon}
                aria-hidden='true'
              >
                <path d='M4 7V5h12v2M10 5l-3 14M5 19h6M15 15l5 5M20 15l-5 5' />
              </svg>
            </ToolButton>
          </div>
        ) : (
          <span className={styles.toolbarNote}>{t('editor.htmlNote')}</span>
        )}
        <button
          type='button'
          className={styles.htmlToggle}
          aria-pressed={view === 'html'}
          title={view === 'html' ? t('editor.visual') : t('editor.html')}
          onClick={() => switchView(view === 'html' ? 'visual' : 'html')}
        >
          <span aria-hidden='true'>&lt;/&gt;</span> HTML
        </button>
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

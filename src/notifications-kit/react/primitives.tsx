import {
  forwardRef,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import type {
  ButtonHTMLAttributes,
  KeyboardEvent as ReactKeyboardEvent,
  ReactNode,
  RefObject,
} from 'react';
import { createPortal } from 'react-dom';

import { LEAVE_MS, prefersReducedMotion, useIndicator } from './motion';
import styles from './styles.module.css';

export const cx = (...names: Array<string | false | null | undefined>) =>
  names.filter(Boolean).join(' ');

const ICON_PATHS = {
  bell: 'M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9 M10.3 21a1.94 1.94 0 0 0 3.4 0',
  close: 'M18 6L6 18 M6 6l12 12',
  checkAll: 'M2 12l5 5L18 6 M12 15l2 2L22 8',
  check: 'M5 12l5 5L20 7',
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z M12 11v5.5 M12 7.6h.01',
  chevron: 'M6 9l6 6 6-6',
  chevronUp: 'M18 15l-6-6-6 6',
  back: 'M19 12H5 M11 18l-6-6 6-6',
  send: 'M22 2L11 13 M22 2l-7 20-4-9-9-4 20-7z',
  refresh:
    'M20 11a8 8 0 0 0-14.5-4L4 9 M4 4v5h5 M4 13a8 8 0 0 0 14.5 4L20 15 M20 20v-5h-5',
  plus: 'M12 5v14 M5 12h14',
  eye: 'M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
  mail: 'M5 5h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z M3 7l9 6 9-6',
  chat: 'M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z',
  link: 'M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1 M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1',
  external:
    'M14 4h6v6 M20 4l-9 9 M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5',
  alert:
    'M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z M12 9v4 M12 17h.01',
  megaphone:
    'M3 10.5v3a1 1 0 0 0 1 1h2.5L13 19V5L6.5 9.5H4a1 1 0 0 0-1 1z M16.5 9a4 4 0 0 1 0 6 M19 6.5a7.5 7.5 0 0 1 0 11',
} as const;

export type IconName = keyof typeof ICON_PATHS;

export function Icon({
  name,
  small,
  size,
  weight,
}: {
  name: IconName;
  small?: boolean;
  /** px; overrides `small`. */
  size?: number;
  /** Stroke width. */
  weight?: number;
}) {
  return (
    <svg
      className={cx(styles.icon, small && styles.iconSmall)}
      style={
        size || weight
          ? { width: size, height: size, strokeWidth: weight }
          : undefined
      }
      viewBox='0 0 24 24'
      aria-hidden='true'
      focusable='false'
    >
      <path d={ICON_PATHS[name]} />
    </svg>
  );
}

// ---------------------------------------------------------------- buttons

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /**
   * - `primary` - filled accent;
   * - `outline` - white with a border (the everyday button);
   * - `ghost`   - accent text, no frame (links in a bar).
   */
  variant?: 'primary' | 'outline' | 'ghost';
  /** 32, 36 or 40 px tall. Default: `'md'`. */
  size?: 'sm' | 'md' | 'lg';
  icon?: IconName;
  /** An icon after the label (e.g. a chevron of a menu button). */
  iconEnd?: IconName;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    {
      variant = 'outline',
      size = 'md',
      icon,
      iconEnd,
      className,
      children,
      type = 'button',
      ...rest
    },
    ref
  ) {
    return (
      <button
        ref={ref}
        type={type}
        className={cx(
          styles.button,
          variant === 'primary' && styles.buttonPrimary,
          variant === 'outline' && styles.buttonOutline,
          variant === 'ghost' && styles.buttonGhost,
          size === 'sm' && styles.buttonSm,
          size === 'lg' && styles.buttonLg,
          className
        )}
        {...rest}
      >
        {icon && <Icon name={icon} size={16} weight={2} />}
        {children}
        {iconEnd && <Icon name={iconEnd} size={12} weight={2.4} />}
      </button>
    );
  }
);

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: IconName;
  /** An icon-only button has no text, so the label is mandatory. */
  label: string;
  small?: boolean;
  children?: ReactNode;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  function IconButton(
    { icon, label, small, className, children, type = 'button', ...rest },
    ref
  ) {
    return (
      <button
        ref={ref}
        type={type}
        className={cx(styles.iconButton, className)}
        aria-label={label}
        title={label}
        {...rest}
      >
        <Icon name={icon} small={small} />
        {children}
      </button>
    );
  }
);

/** The round close button of cards and dialogs: 28 px, filled, a 12 px
 *  cross - big enough to hit, quiet enough not to compete with the text. */
export const CloseButton = forwardRef<
  HTMLButtonElement,
  Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & {
    label: string;
    large?: boolean;
  }
>(function CloseButton(
  { label, large, className, type = 'button', ...rest },
  ref
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cx(styles.close, large && styles.closeLarge, className)}
      aria-label={label}
      title={label}
      {...rest}
    >
      <Icon name='close' size={large ? 14 : 12} weight={large ? 2.4 : 2.6} />
    </button>
  );
});

export function Spinner({ label }: { label?: string }) {
  return <span className={styles.spinner} role='status' aria-label={label} />;
}

export function StateBlock({
  title,
  note,
  action,
  icon,
}: {
  title: ReactNode;
  note?: ReactNode;
  action?: ReactNode;
  icon?: IconName;
}) {
  return (
    <div className={styles.state}>
      {icon && (
        <span className={styles.stateIcon}>
          <Icon name={icon} size={22} />
        </span>
      )}
      <span className={styles.stateTitle}>{title}</span>
      {note && <span className={styles.stateNote}>{note}</span>}
      {action}
    </div>
  );
}

/** A small pill: "Important", "Shown until …", "PREVIEW". */
export function Chip({
  tone = 'neutral',
  children,
}: {
  tone?: 'neutral' | 'danger' | 'preview' | 'accent';
  children: ReactNode;
}) {
  return (
    <span className={styles.chip} data-tone={tone}>
      {children}
    </span>
  );
}

// ----------------------------------------------------------------- switch

export function Switch({
  checked,
  onChange,
  label,
  className,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: ReactNode;
  className?: string;
}) {
  return (
    <button
      type='button'
      role='switch'
      aria-checked={checked}
      className={cx(styles.switch, className)}
      onClick={() => onChange(!checked)}
    >
      <span className={styles.switchTrack} aria-hidden='true'>
        <span className={styles.switchKnob} />
      </span>
      {label}
    </button>
  );
}

// ------------------------------------------------------------------- tabs

export interface TabItem<T extends string> {
  value: T;
  label: ReactNode;
  /** A number after the label; hidden when `undefined` or 0. */
  count?: number;
}

/**
 * A row of tabs with an underline that slides to the selected one. Use it
 * for the page's own sections too, so every tab row on the page matches.
 */
export function Tabs<T extends string>({
  value,
  items,
  onChange,
  label,
  after,
  className,
}: {
  value: T;
  items: readonly TabItem<T>[];
  onChange: (value: T) => void;
  /** Accessible name of the tab list. */
  label?: string;
  /** Rendered at the end of the row (filters, switches). */
  after?: ReactNode;
  className?: string;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const box = useIndicator(listRef, '[aria-selected="true"]', [
    value,
    items.length,
  ]);
  const onKeyDown = (event: ReactKeyboardEvent) => {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
    const index = items.findIndex(item => item.value === value);
    const step = event.key === 'ArrowRight' ? 1 : -1;
    const next = items[(index + step + items.length) % items.length];
    if (!next) return;
    event.preventDefault();
    onChange(next.value);
    requestAnimationFrame(() =>
      listRef.current
        ?.querySelector<HTMLElement>('[aria-selected="true"]')
        ?.focus()
    );
  };

  return (
    <div className={cx(styles.root, styles.tabRow, className)}>
      <div
        ref={listRef}
        className={styles.tabList}
        role='tablist'
        aria-label={label}
        onKeyDown={onKeyDown}
      >
        {items.map(item => (
          <button
            key={item.value}
            type='button'
            role='tab'
            className={styles.tab}
            aria-selected={item.value === value}
            tabIndex={item.value === value ? 0 : -1}
            onClick={() => onChange(item.value)}
          >
            {item.label}
            {item.count !== undefined && item.count > 0 && (
              <span className={styles.tabCount}>{item.count}</span>
            )}
          </button>
        ))}
        {box && (
          <span
            className={styles.tabIndicator}
            aria-hidden='true'
            style={{
              width: box.width,
              transform: `translateX(${box.left}px)`,
            }}
          />
        )}
      </div>
      {after && <div className={styles.tabAfter}>{after}</div>}
    </div>
  );
}

// ----------------------------------------------------------------- dialog

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), iframe, [tabindex]:not([tabindex="-1"])';

/** Keeps a component mounted for the length of its exit animation. */
export function usePresence(open: boolean): {
  mounted: boolean;
  closing: boolean;
} {
  const [mounted, setMounted] = useState(open);
  const [closing, setClosing] = useState(false);

  useEffect(() => {
    if (open) {
      setMounted(true);
      setClosing(false);
      return;
    }
    if (!mounted) return;
    if (prefersReducedMotion()) {
      setMounted(false);
      return;
    }
    setClosing(true);
    const timer = window.setTimeout(() => {
      setMounted(false);
      setClosing(false);
    }, LEAVE_MS);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return { mounted: open || mounted, closing: !open && closing };
}

export interface DialogProps {
  open: boolean;
  /** Escape and a click on the backdrop call it. Leave it out for a dialog
   *  that has to be answered with one of its own buttons. */
  onClose?: () => void;
  /** Id of the element that names the dialog. */
  labelledBy?: string;
  label?: string;
  role?: 'dialog' | 'alertdialog';
  /** px. Default: 520. */
  width?: number;
  /** Focused on open; else the first focusable element. */
  initialFocus?: RefObject<HTMLElement | null>;
  /** `'blur'` blurs the page behind as well as dimming it. Default: `'dim'`. */
  backdrop?: 'dim' | 'blur';
  className?: string;
  children: ReactNode;
}

/**
 * A modal over the whole page: the backdrop fades, the panel rises, both
 * play back on close. Focus moves in, stays in, and returns to where it was.
 */
export function Dialog({
  open,
  onClose,
  labelledBy,
  label,
  role = 'dialog',
  width = 520,
  initialFocus,
  backdrop = 'dim',
  className,
  children,
}: DialogProps) {
  const { mounted, closing } = usePresence(open);
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useLayoutEffect(() => {
    if (!mounted || closing) return;
    const previous = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    const target =
      initialFocus?.current ??
      panel?.querySelector<HTMLElement>(FOCUSABLE) ??
      panel;
    target?.focus({ preventScroll: true });
    return () => previous?.focus?.({ preventScroll: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mounted, closing]);

  const onKeyDown = useCallback((event: ReactKeyboardEvent) => {
    if (event.key === 'Escape' && closeRef.current) {
      event.stopPropagation();
      closeRef.current();
      return;
    }
    if (event.key !== 'Tab') return;
    const panel = panelRef.current;
    if (!panel) return;
    const items = Array.from(
      panel.querySelectorAll<HTMLElement>(FOCUSABLE)
    ).filter(el => el.offsetParent !== null || el === document.activeElement);
    if (items.length === 0) {
      event.preventDefault();
      return;
    }
    const first = items[0]!;
    const last = items[items.length - 1]!;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }, []);

  if (!mounted || typeof document === 'undefined') return null;

  return createPortal(
    <div
      className={cx(styles.root, styles.scrim)}
      data-backdrop={backdrop}
      data-closing={closing || undefined}
      onPointerDown={event => {
        if (event.target === event.currentTarget) closeRef.current?.();
      }}
    >
      <div
        ref={panelRef}
        className={cx(styles.dialog, className)}
        style={{ width: `min(${width}px, 100%)` }}
        role={role}
        aria-modal='true'
        aria-labelledby={labelledBy}
        aria-label={labelledBy ? undefined : label}
        tabIndex={-1}
        data-closing={closing || undefined}
        onKeyDown={onKeyDown}
      >
        {children}
      </div>
    </div>,
    document.body
  );
}

/** `useId` that is stable and safe as a DOM id prefix. */
export function useDomId(prefix: string): string {
  return `${prefix}-${useId().replace(/:/g, '')}`;
}

// ------------------------------------------------------------- html frame

const MIN_FRAME = 40;
const MAX_FRAME = 4000;

function frameDocument(html: string, host: HTMLElement | null): string {
  const style = host ? getComputedStyle(host) : null;
  const color = style?.color || '#1b2321';
  const font = style?.fontFamily || 'system-ui, sans-serif';
  const size = style?.fontSize || '14px';
  const link = style?.getPropertyValue('--nk-color-accent-text').trim() ?? '';
  // The frame stays transparent only when its colour scheme matches the
  // page's; otherwise the browser paints an opaque backdrop behind it.
  const scheme = style?.colorScheme || 'normal';
  return (
    '<!doctype html><html><head><meta charset="utf-8"><base target="_blank">' +
    `<style>:root{color-scheme:${scheme}}html,body{margin:0;padding:0;background:transparent;color:${color};` +
    `font-family:${font};font-size:${size};line-height:1.6;overflow-wrap:anywhere}` +
    'body>*:first-child{margin-top:0}body>*:last-child{margin-bottom:0}' +
    'p{margin:0 0 12px}ul,ol{margin:0 0 12px;padding-left:20px}li{margin-bottom:4px}' +
    'h1,h2,h3{margin:16px 0 8px;line-height:1.3}' +
    `a{color:${link || 'inherit'}}img{max-width:100%;height:auto}` +
    'table{max-width:100%}</style></head><body>' +
    html +
    '</body></html>'
  );
}

/**
 * Server-rendered HTML, isolated: no scripts run (the sandbox has no
 * `allow-scripts`), page styles do not leak in and the message's do not leak
 * out. Text colour and font follow the surrounding page; the height follows
 * the content. Links open in a new tab.
 */
export function HtmlFrame({
  html,
  title,
  className,
}: {
  html: string;
  title: string;
  className?: string;
}) {
  const ref = useRef<HTMLIFrameElement>(null);
  const observer = useRef<ResizeObserver | null>(null);

  const fit = useCallback(() => {
    const frame = ref.current;
    const body = frame?.contentDocument?.body;
    if (!frame || !body) return;
    // The body, not the root: the root is at least as tall as the frame
    // itself, so it could only ever grow.
    const height = Math.ceil(body.getBoundingClientRect().height);
    frame.style.height = `${Math.min(MAX_FRAME, Math.max(MIN_FRAME, height))}px`;
  }, []);

  // Late layout changes - fonts, images, a narrower column - resize it too.
  const onLoad = useCallback(() => {
    observer.current?.disconnect();
    const body = ref.current?.contentDocument?.body;
    if (body && typeof ResizeObserver !== 'undefined') {
      observer.current = new ResizeObserver(fit);
      observer.current.observe(body);
    }
    fit();
  }, [fit]);

  useEffect(() => () => observer.current?.disconnect(), []);

  // Written again when the page's theme changes (a class or attribute on
  // <html>/<body>, or the system scheme), so the text keeps the page colour.
  useEffect(() => {
    const frame = ref.current;
    if (!frame) return;
    let current = '';
    const write = () => {
      const next = frameDocument(html, frame.parentElement);
      if (next !== current) {
        current = next;
        frame.srcdoc = next;
      }
    };
    write();
    const watcher = new MutationObserver(write);
    watcher.observe(document.documentElement, { attributes: true });
    watcher.observe(document.body, { attributes: true });
    const scheme = window.matchMedia?.('(prefers-color-scheme: dark)');
    scheme?.addEventListener?.('change', write);
    return () => {
      watcher.disconnect();
      scheme?.removeEventListener?.('change', write);
    };
  }, [html]);

  return (
    <iframe
      ref={ref}
      className={cx(styles.htmlFrame, className)}
      title={title}
      sandbox='allow-same-origin allow-popups allow-popups-to-escape-sandbox'
      onLoad={onLoad}
    />
  );
}

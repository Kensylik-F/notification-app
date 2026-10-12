import { forwardRef, useCallback, useEffect, useRef } from 'react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';

import styles from './styles.module.css';

export const cx = (...names: Array<string | false | null | undefined>) =>
  names.filter(Boolean).join(' ');

const ICON_PATHS = {
  bell: 'M6 16v-5a6 6 0 1 1 12 0v5l1.5 2h-15L6 16z M10 20.5a2 2 0 0 0 4 0',
  close: 'M6 6l12 12 M18 6L6 18',
  checkAll: 'M3 12.5l4 4 8-9 M12 16.5l1 1 8-9',
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z M12 11v5.5 M12 7.6h.01',
  chevron: 'M6 9.5l6 6 6-6',
  send: 'M20.5 3.5L10 14 M20.5 3.5l-6.5 17-4-7.5-7.5-4 18-5.5z',
  refresh:
    'M20 11a8 8 0 0 0-14.5-4L4 9 M4 4v5h5 M4 13a8 8 0 0 0 14.5 4L20 15 M20 20v-5h-5',
  plus: 'M12 5v14 M5 12h14',
} as const;

export type IconName = keyof typeof ICON_PATHS;

export function Icon({ name, small }: { name: IconName; small?: boolean }) {
  return (
    <svg
      className={cx(styles.icon, small && styles.iconSmall)}
      viewBox='0 0 24 24'
      aria-hidden='true'
      focusable='false'
    >
      <path d={ICON_PATHS[name]} />
    </svg>
  );
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'outline' | 'ghost';
  icon?: IconName;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    {
      variant = 'outline',
      icon,
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
          className
        )}
        {...rest}
      >
        {icon && <Icon name={icon} small />}
        {children}
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

export function Spinner({ label }: { label?: string }) {
  return <span className={styles.spinner} role='status' aria-label={label} />;
}

export function StateBlock({
  title,
  note,
  action,
}: {
  title: ReactNode;
  note?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className={styles.state}>
      <span className={styles.stateTitle}>{title}</span>
      {note && <span className={styles.stateNote}>{note}</span>}
      {action}
    </div>
  );
}

// ------------------------------------------------------------- html frame

const MIN_FRAME = 40;
const MAX_FRAME = 640;

function frameDocument(html: string, host: HTMLElement | null): string {
  const style = host ? getComputedStyle(host) : null;
  const color = style?.color || '#1b2524';
  const font = style?.fontFamily || 'system-ui, sans-serif';
  const size = style?.fontSize || '14px';
  const link = style?.getPropertyValue('--nk-color-accent-text').trim() ?? '';
  // The frame stays transparent only when its colour scheme matches the
  // page's; otherwise the browser paints an opaque backdrop behind it.
  const scheme = style?.colorScheme || 'normal';
  return (
    '<!doctype html><html><head><meta charset="utf-8"><base target="_blank">' +
    `<style>:root{color-scheme:${scheme}}html,body{margin:0;padding:0;background:transparent;color:${color};` +
    `font-family:${font};font-size:${size};line-height:1.5;overflow-wrap:anywhere}` +
    'body>*:first-child{margin-top:0}body>*:last-child{margin-bottom:0}' +
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
export function HtmlFrame({ html, title }: { html: string; title: string }) {
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
      className={styles.htmlFrame}
      title={title}
      sandbox='allow-same-origin allow-popups allow-popups-to-escape-sandbox'
      onLoad={onLoad}
    />
  );
}

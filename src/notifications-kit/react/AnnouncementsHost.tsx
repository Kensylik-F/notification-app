import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { CSSProperties, KeyboardEvent, ReactNode } from 'react';
import { createPortal } from 'react-dom';

import type { AnnouncementEntry } from '../core';
import { useNotificationsContext } from './context';
import { useAnnouncements, useDismissAnnouncement } from './hooks';
import { planAnnouncements } from './presentation';
import { htmlToText } from './admin/richtext';
import { Button, HtmlFrame, Icon, IconButton, cx } from './primitives';
import styles from './styles.module.css';

export interface AnnouncementsHostProps {
  /** How long a toast stays. Default: 8000. */
  toastDurationMs?: number;
  /**
   * What the end of that time means. `'hide-for-session'` only takes the
   * toast off the screen until the browser tab is closed: the service still
   * counts it outstanding. `'dismiss'` tells the service the caller has
   * dealt with it. Default: `'hide-for-session'`.
   */
  toastOnTimeout?: 'hide-for-session' | 'dismiss';
  /** Corner cards in the stack. Default: 5. */
  maxCorner?: number;
  /** Toasts on screen at once. Default: 2. */
  maxToasts?: number;
  /** Where corner cards sit. Default: `'top-end'`. */
  cornerPosition?: 'top-end' | 'bottom-end';
  /** Where the overlays are mounted. Default: `document.body`. */
  container?: Element | null;
}

const SESSION_KEY = 'notifications-kit:hidden-toasts';

function readHidden(): string[] {
  try {
    const raw = window.sessionStorage.getItem(SESSION_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed)
      ? parsed.filter((id): id is string => typeof id === 'string')
      : [];
  } catch {
    return [];
  }
}

function writeHidden(ids: readonly string[]) {
  try {
    window.sessionStorage.setItem(SESSION_KEY, JSON.stringify(ids));
  } catch {
    // Storage may be unavailable; the toast then reappears on reload.
  }
}

/** Short body for a card: the text twin, else the HTML reduced to text. */
function cardText(entry: AnnouncementEntry): string | null {
  if (entry.bodyText) return entry.bodyText;
  if (!entry.bodyHtml || typeof DOMParser === 'undefined') return null;
  return htmlToText(entry.bodyHtml);
}

/** Full body for the dialog: the host's renderer, the isolated frame, or text. */
function useDialogBody(entry: AnnouncementEntry): ReactNode {
  const { renderHtml, t } = useNotificationsContext();
  if (entry.bodyHtml) {
    return renderHtml ? (
      renderHtml(entry.bodyHtml, entry)
    ) : (
      <HtmlFrame
        html={entry.bodyHtml}
        title={entry.subject ?? t('announcement.untitled')}
      />
    );
  }
  return entry.bodyText ? (
    <p className={styles.bodyText}>{entry.bodyText}</p>
  ) : null;
}

interface CardProps {
  entry: AnnouncementEntry;
  toast?: boolean;
  onClose: () => void;
  className?: string;
  style?: CSSProperties;
  inert?: boolean;
  /** A line under the text (e.g. "2 more" on a folded stack). */
  footer?: ReactNode;
}

function AnnouncementCard({
  entry,
  toast,
  onClose,
  className,
  style,
  inert,
  footer,
}: CardProps) {
  const { t } = useNotificationsContext();
  const body = cardText(entry);
  return (
    <div
      className={cx(styles.card, toast && styles.toast, className)}
      style={style}
      role={toast ? 'status' : 'group'}
      aria-label={toast ? undefined : (entry.subject ?? undefined)}
      aria-hidden={inert || undefined}
    >
      <span className={styles.cardIcon}>
        <Icon name='info' />
      </span>
      <div className={styles.cardText}>
        <span className={styles.cardTitle}>
          {entry.subject ?? t('announcement.untitled')}
        </span>
        {body && <div className={styles.cardBody}>{body}</div>}
        {footer && <span className={styles.cardFooter}>{footer}</span>}
      </div>
      <IconButton
        icon='close'
        small
        label={t('announcement.dismiss')}
        className={styles.cardClose}
        tabIndex={inert ? -1 : undefined}
        onClick={event => {
          event.stopPropagation();
          onClose();
        }}
      />
    </div>
  );
}

/**
 * Corner announcements as a stack, the way a phone groups notifications:
 * the newest card in front, up to two peeking out behind it. A click on the
 * stack fans it out into a list; "Show less" or Escape folds it back.
 */
function CornerDeck({
  entries,
  onDismiss,
  position,
}: {
  entries: AnnouncementEntry[];
  onDismiss: (id: string) => void;
  position: 'top-end' | 'bottom-end';
}) {
  const { t } = useNotificationsContext();
  const [expanded, setExpanded] = useState(false);
  const many = entries.length > 1;
  const open = expanded && many;

  useEffect(() => {
    if (!many) setExpanded(false);
  }, [many]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') setExpanded(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <div
      className={cx(
        styles.root,
        styles.overlay,
        styles.overlayCorner,
        position === 'bottom-end' && styles.overlayCornerBottom
      )}
      role='region'
      aria-label={t('announcement.region')}
    >
      {open && (
        <div className={styles.deckBar}>
          <Button variant='ghost' onClick={() => setExpanded(false)}>
            {t('announcement.collapse')}
          </Button>
          <Button
            variant='ghost'
            onClick={() => entries.forEach(entry => onDismiss(entry.id))}
          >
            {t('announcement.dismissAll')}
          </Button>
        </div>
      )}
      <div
        className={styles.deck}
        data-expanded={open || undefined}
        data-stacked={(!open && many) || undefined}
        onClick={many && !open ? () => setExpanded(true) : undefined}
        role={many && !open ? 'button' : undefined}
        tabIndex={many && !open ? 0 : undefined}
        aria-expanded={many ? open : undefined}
        aria-label={
          many && !open
            ? t('announcement.expand', { count: entries.length })
            : undefined
        }
        onKeyDown={event => {
          if (many && !open && (event.key === 'Enter' || event.key === ' ')) {
            event.preventDefault();
            setExpanded(true);
          }
        }}
      >
        {entries.map((entry, index) => (
          <AnnouncementCard
            key={entry.id}
            entry={entry}
            className={styles.deckCard}
            style={{ '--nk-deck-i': index } as CSSProperties}
            inert={!open && index > 0}
            footer={
              many && !open && index === 0
                ? t('announcement.more', { count: entries.length - 1 })
                : undefined
            }
            onClose={() => onDismiss(entry.id)}
          />
        ))}
      </div>
    </div>
  );
}

function Toast({
  entry,
  durationMs,
  onTimeout,
  onClose,
}: {
  entry: AnnouncementEntry;
  durationMs: number;
  onTimeout: () => void;
  onClose: () => void;
}) {
  const timeoutRef = useRef(onTimeout);
  timeoutRef.current = onTimeout;

  useEffect(() => {
    const timer = window.setTimeout(() => timeoutRef.current(), durationMs);
    return () => window.clearTimeout(timer);
  }, [durationMs, entry.id]);

  return <AnnouncementCard entry={entry} toast onClose={onClose} />;
}

function AnnouncementDialog({
  entry,
  onAcknowledge,
}: {
  entry: AnnouncementEntry;
  onAcknowledge: () => void;
}) {
  const { t } = useNotificationsContext();
  const body = useDialogBody(entry);
  const titleId = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    buttonRef.current?.focus();
    return () => previous?.focus?.();
  }, [entry.id]);

  // The only way out is the acknowledgement, so focus stays on it.
  const keepFocus = (event: KeyboardEvent) => {
    if (event.key === 'Tab') {
      event.preventDefault();
      buttonRef.current?.focus();
    }
  };

  return (
    <div className={cx(styles.root, styles.scrim)}>
      <div
        className={styles.dialog}
        role='alertdialog'
        aria-modal='true'
        aria-labelledby={titleId}
        onKeyDown={keepFocus}
      >
        <h2 id={titleId} className={styles.dialogTitle}>
          {entry.subject ?? t('announcement.untitled')}
        </h2>
        {body && <div className={styles.dialogBody}>{body}</div>}
        <div className={styles.dialogActions}>
          <Button ref={buttonRef} variant='primary' onClick={onAcknowledge}>
            {t('announcement.acknowledge')}
          </Button>
        </div>
      </div>
    </div>
  );
}

/**
 * Shows the caller's outstanding announcements as a blocking dialog, corner
 * cards or toasts - whichever the provider's `resolvePresentation` picks for
 * each. Mount it once, anywhere under the provider.
 */
export function AnnouncementsHost({
  toastDurationMs = 8000,
  toastOnTimeout = 'hide-for-session',
  maxCorner = 5,
  maxToasts = 2,
  cornerPosition = 'top-end',
  container,
}: AnnouncementsHostProps) {
  const { resolvePresentation } = useNotificationsContext();
  const { data } = useAnnouncements();
  const dismiss = useDismissAnnouncement();
  const [hidden, setHidden] = useState<ReadonlySet<string>>(
    () => new Set(typeof window === 'undefined' ? [] : readHidden())
  );

  const hide = useCallback((id: string) => {
    setHidden(previous => {
      if (previous.has(id)) return previous;
      const next = new Set(previous).add(id);
      writeHidden([...next]);
      return next;
    });
  }, []);

  const mutateDismiss = dismiss.mutate;
  const dismissNow = useCallback(
    (id: string) => mutateDismiss(id),
    [mutateDismiss]
  );

  const entries = data?.items;
  const plan = useMemo(
    () =>
      planAnnouncements(entries ?? [], {
        resolve: resolvePresentation,
        hidden,
        maxCorner,
        maxToasts,
        now: Date.now(),
      }),
    [entries, resolvePresentation, hidden, maxCorner, maxToasts]
  );

  if (typeof document === 'undefined') return null;
  const target = container ?? document.body;
  const nothing =
    plan.modal === null && plan.corner.length === 0 && plan.toasts.length === 0;
  if (nothing) return null;

  return createPortal(
    <>
      {plan.toasts.length > 0 && (
        <div
          className={cx(styles.root, styles.overlay, styles.overlayToast)}
          aria-live='polite'
        >
          {plan.toasts.map(entry => (
            <Toast
              key={entry.id}
              entry={entry}
              durationMs={toastDurationMs}
              onTimeout={() =>
                toastOnTimeout === 'dismiss'
                  ? dismissNow(entry.id)
                  : hide(entry.id)
              }
              onClose={() => dismissNow(entry.id)}
            />
          ))}
        </div>
      )}
      {plan.corner.length > 0 && (
        <CornerDeck
          entries={plan.corner}
          onDismiss={dismissNow}
          position={cornerPosition}
        />
      )}
      {plan.modal && (
        <AnnouncementDialog
          key={plan.modal.id}
          entry={plan.modal}
          onAcknowledge={() => dismissNow((plan.modal as AnnouncementEntry).id)}
        />
      )}
    </>,
    target
  );
}

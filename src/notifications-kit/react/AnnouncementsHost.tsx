import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import { createPortal } from 'react-dom';

import type { AnnouncementEntry } from '../core';
import { useNotificationsContext } from './context';
import { useAnnouncements, useDismissAnnouncement } from './hooks';
import { planAnnouncements } from './presentation';
import { Button, Icon, IconButton, cx } from './primitives';
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
  /** Corner cards on screen at once. Default: 3. */
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

function useBody(entry: AnnouncementEntry): ReactNode {
  const { renderHtml } = useNotificationsContext();
  if (entry.bodyHtml && renderHtml) return renderHtml(entry.bodyHtml, entry);
  return entry.bodyText;
}

interface CardProps {
  entry: AnnouncementEntry;
  toast?: boolean;
  onClose: () => void;
}

function AnnouncementCard({ entry, toast, onClose }: CardProps) {
  const { t } = useNotificationsContext();
  const body = useBody(entry);
  return (
    <div
      className={cx(styles.card, toast && styles.toast)}
      role={toast ? 'status' : 'group'}
      aria-label={toast ? undefined : (entry.subject ?? undefined)}
    >
      <span className={styles.cardIcon}>
        <Icon name='info' />
      </span>
      <div className={styles.cardText}>
        <span className={styles.cardTitle}>
          {entry.subject ?? t('announcement.untitled')}
        </span>
        {body && <div className={styles.cardBody}>{body}</div>}
      </div>
      <IconButton
        icon='close'
        small
        label={t('announcement.dismiss')}
        className={styles.cardClose}
        onClick={onClose}
      />
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
  const body = useBody(entry);
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
        {body && (
          <div className={cx(styles.dialogBody, styles.bodyText)}>{body}</div>
        )}
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
  maxCorner = 3,
  maxToasts = 2,
  cornerPosition = 'top-end',
  container,
}: AnnouncementsHostProps) {
  const { t, resolvePresentation } = useNotificationsContext();
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
        <div
          className={cx(
            styles.root,
            styles.overlay,
            styles.overlayCorner,
            cornerPosition === 'bottom-end' && styles.overlayCornerBottom
          )}
          role='region'
          aria-label={t('announcement.region')}
        >
          {plan.corner.map(entry => (
            <AnnouncementCard
              key={entry.id}
              entry={entry}
              onClose={() => dismissNow(entry.id)}
            />
          ))}
        </div>
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

import type { ReactNode } from 'react';

import { isNotificationsError } from '../core';
import type { InboxEntry } from '../core';
import { useNotificationsContext } from './context';
import { formatRelative } from './format';
import { Button, Icon, Spinner } from './primitives';
import styles from './styles.module.css';

interface InboxRowProps {
  entry: InboxEntry;
  /** The same item fetched by id: subject and body, once they arrive. */
  full: InboxEntry | undefined;
  /** The by-id request failed (shown only when the row is expanded). */
  fullError?: unknown;
  now: number;
  expanded: boolean;
  onToggle: (entry: InboxEntry) => void;
  onDismiss?: (entry: InboxEntry) => void;
  /** Offered inside the expanded row, for a dedicated page. */
  onOpenSeparately?: (entry: InboxEntry) => void;
  /** Rendered after the built-in actions of an expanded row. */
  actions?: (entry: InboxEntry) => ReactNode;
}

/**
 * One notification. The title is the subject when it is known; a list row
 * arrives without one, so until then it is the host's label for the
 * category, and never the raw category code. Expanding shows the body in
 * place - a separate page for one line of text is not worth the trip.
 */
export function InboxRow({
  entry,
  full,
  fullError,
  now,
  expanded,
  onToggle,
  onDismiss,
  onOpenSeparately,
  actions,
}: InboxRowProps) {
  const { t, locale, describeItem, renderHtml } = useNotificationsContext();

  const description = describeItem(entry);
  const subject = full?.subject ?? entry.subject;
  const title = subject ?? description?.title ?? t('inbox.untitled');
  // With the subject as the title the category label moves under it.
  const label = subject ? description?.title : description?.hint;
  const relative = formatRelative(entry.createdAt, now, locale);
  const time = relative === 'now' ? t('time.justNow') : relative;
  const unread = !entry.read;
  const bodyId = `nk-row-body-${entry.id}`;

  const bodyHtml = full?.bodyHtml ?? null;
  const bodyText = full?.bodyText ?? null;

  let body: ReactNode;
  if (full) {
    body =
      bodyHtml && renderHtml ? (
        renderHtml(bodyHtml, full)
      ) : bodyText ? (
        <p className={styles.bodyText}>{bodyText}</p>
      ) : (
        <p className={styles.stateNote}>{t('item.noBody')}</p>
      );
  } else if (fullError) {
    const notFound =
      isNotificationsError(fullError) && fullError.status === 404;
    body = (
      <p className={styles.stateNote}>
        {notFound ? t('item.notFound') : t('item.error')}
      </p>
    );
  } else {
    body = (
      <span className={styles.rowLoading}>
        <Spinner label={t('item.loading')} />
      </span>
    );
  }

  return (
    <li className={styles.row} data-expanded={expanded}>
      <button
        type='button'
        className={styles.rowMain}
        aria-expanded={expanded}
        aria-controls={bodyId}
        onClick={() => onToggle(entry)}
      >
        <span
          className={styles.unreadMark}
          data-unread={unread}
          role={unread ? 'img' : undefined}
          aria-label={unread ? t('inbox.unreadMark') : undefined}
        />
        <span className={styles.rowText}>
          <span className={styles.rowTitle} data-unread={unread}>
            {title}
          </span>
          <span className={styles.rowMeta}>
            {entry.priority === 'HIGH' && (
              <span className={styles.tag}>{t('priority.HIGH')}</span>
            )}
            {label && <span>{label}</span>}
            {label && time && <span aria-hidden='true'>·</span>}
            {time && <span>{time}</span>}
          </span>
        </span>
        <span className={styles.rowChevron} aria-hidden='true'>
          <Icon name='chevron' small />
        </span>
      </button>
      {expanded && (
        <div id={bodyId} className={styles.rowBody}>
          {body}
          {(onDismiss || onOpenSeparately || actions) && (
            <div className={styles.rowActions}>
              {actions?.(entry)}
              {onOpenSeparately && (
                <Button variant='ghost' onClick={() => onOpenSeparately(entry)}>
                  {t('item.openSeparately')}
                </Button>
              )}
              {onDismiss && (
                <Button onClick={() => onDismiss(entry)}>
                  {t('item.dismiss')}
                </Button>
              )}
            </div>
          )}
        </div>
      )}
    </li>
  );
}

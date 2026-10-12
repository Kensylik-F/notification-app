import type { InboxEntry } from '../core';
import { useNotificationsContext } from './context';
import { formatRelative } from './format';
import { IconButton } from './primitives';
import styles from './styles.module.css';

interface InboxRowProps {
  entry: InboxEntry;
  /** The same item fetched by id, when its subject has arrived. */
  full: InboxEntry | undefined;
  now: number;
  onOpen?: (entry: InboxEntry) => void;
  onDismiss?: (entry: InboxEntry) => void;
}

export function InboxRow({
  entry,
  full,
  now,
  onOpen,
  onDismiss,
}: InboxRowProps) {
  const { t, locale, describeItem } = useNotificationsContext();

  const description = describeItem(entry);
  const subject = full?.subject ?? entry.subject;
  const title =
    subject ?? description?.title ?? entry.category ?? t('inbox.untitled');
  // With the subject as the title, the category label moves to the hint.
  const hint =
    description?.hint ??
    (subject ? (description?.title ?? entry.category) : null);
  const relative = formatRelative(entry.createdAt, now, locale);
  const time = relative === 'now' ? t('time.justNow') : relative;
  const unread = !entry.read;

  return (
    <li className={styles.row}>
      <button
        type='button'
        className={styles.rowMain}
        onClick={onOpen ? () => onOpen(entry) : undefined}
        disabled={!onOpen}
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
          {(hint || entry.priority === 'HIGH') && (
            <span className={styles.rowHint}>
              {entry.priority === 'HIGH' && (
                <span className={styles.tag}>{t('priority.HIGH')}</span>
              )}
              {entry.priority === 'HIGH' && hint ? ' ' : null}
              {hint}
            </span>
          )}
        </span>
        {time && <span className={styles.rowTime}>{time}</span>}
      </button>
      {onDismiss && (
        <IconButton
          icon='close'
          small
          label={t('item.dismiss')}
          className={styles.rowAction}
          onClick={() => onDismiss(entry)}
        />
      )}
    </li>
  );
}

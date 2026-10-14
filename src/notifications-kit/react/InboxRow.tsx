import type { ReactNode } from 'react';

import type { AnnouncementEntry, InboxEntry } from '../core';
import { plainText } from './content';
import { useNotificationsContext } from './context';
import { formatDay, formatListTime } from './format';
import { isImportant } from './presentation';
import { Chip } from './primitives';
import styles from './styles.module.css';

export interface ListRowProps {
  /** Key for layout animation and `aria-controls`. */
  id: string;
  title: ReactNode;
  time: string | null;
  /** The line under the title; `null` shows a placeholder bar. */
  preview: ReactNode | null;
  /** `unread` - accent dot and bold title; `read` - no dot; `closed` - a
   *  hollow ring and a muted title. */
  mark: 'unread' | 'read' | 'closed';
  /** Red mark: something the person must not miss. */
  important?: boolean;
  selected?: boolean;
  leaving?: boolean;
  chip?: ReactNode;
  onClick: () => void;
}

/** One line of a list: dot, title with the time at the end, a preview line. */
export function ListRow({
  id,
  title,
  time,
  preview,
  mark,
  important,
  selected,
  leaving,
  chip,
  onClick,
}: ListRowProps) {
  const { t } = useNotificationsContext();
  return (
    <li
      className={styles.row}
      data-flip={id}
      data-mark={mark}
      data-tone={important ? 'important' : undefined}
      data-selected={selected || undefined}
      data-leaving={leaving || undefined}
    >
      <button
        type='button'
        className={styles.rowMain}
        aria-current={selected ? 'true' : undefined}
        onClick={onClick}
      >
        <span
          className={styles.dot}
          data-mark={mark}
          data-tone={important ? 'important' : undefined}
          role={mark === 'unread' ? 'img' : undefined}
          aria-label={mark === 'unread' ? t('inbox.unreadMark') : undefined}
        />
        <span className={styles.rowText}>
          <span className={styles.rowTop}>
            <span className={styles.rowTitle}>{title}</span>
            {chip}
            {time && <span className={styles.rowTime}>{time}</span>}
          </span>
          {preview === null ? (
            <span className={styles.rowSkeleton} aria-hidden='true' />
          ) : (
            <span className={styles.rowPreview}>{preview}</span>
          )}
        </span>
      </button>
    </li>
  );
}

/**
 * A notification in a list. A list row arrives without its subject and
 * text; they come with the item fetched by id (`full`). Until then the title
 * is the host's label for the category - never the raw category code.
 */
export function InboxRow({
  entry,
  full,
  now,
  selected,
  leaving,
  preview,
  onSelect,
}: {
  entry: InboxEntry;
  full: InboxEntry | undefined;
  now: number;
  selected?: boolean;
  leaving?: boolean;
  /** The simulated item of the composer's preview. */
  preview?: boolean;
  onSelect: (entry: InboxEntry) => void;
}) {
  const { t, locale, describeItem, subjects } = useNotificationsContext();
  const description = describeItem(entry);
  const subject = full?.subject ?? entry.subject;
  const title = subject ?? description?.title ?? t('inbox.untitled');
  const text = full ? plainText(full) : plainText(entry);
  const fallback = subject ? description?.title : description?.hint;
  const waiting = !full && subjects === 'fetch' && !text;
  const time = formatListTime(entry.createdAt, now, locale);

  return (
    <ListRow
      id={entry.id}
      title={title}
      time={time}
      preview={waiting ? null : (text ?? fallback ?? '')}
      mark={entry.read ? 'read' : 'unread'}
      selected={selected}
      leaving={leaving}
      chip={preview ? <Chip tone='preview'>{t('preview.chip')}</Chip> : null}
      onClick={() => onSelect(entry)}
    />
  );
}

/**
 * An announcement in a list (the bell, the page): a red mark and
 * "Important" for TRANSACTIONAL. `closedAt` - closed in this browser.
 */
export function AnnouncementRow({
  entry,
  now,
  closedAt,
  selected,
  leaving,
  onClick,
}: {
  entry: AnnouncementEntry;
  now: number;
  closedAt?: string;
  selected?: boolean;
  leaving?: boolean;
  onClick: () => void;
}) {
  const { t, locale } = useNotificationsContext();
  const important = isImportant(entry);
  return (
    <ListRow
      id={entry.id}
      title={entry.subject ?? t('announcement.untitled')}
      time={formatListTime(entry.publishedAt, now, locale)}
      preview={
        closedAt !== undefined
          ? t('feed.closedOn', {
              date: formatDay(closedAt, now, locale) ?? '—',
            })
          : (plainText(entry) ?? '')
      }
      mark={closedAt !== undefined ? 'closed' : 'unread'}
      important={important}
      selected={selected}
      leaving={leaving}
      chip={
        important ? (
          <Chip tone='danger'>{t('announcement.important')}</Chip>
        ) : null
      }
      onClick={onClick}
    />
  );
}

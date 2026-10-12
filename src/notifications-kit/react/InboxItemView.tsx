import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';

import { isNotificationsError } from '../core';
import type { InboxEntry } from '../core';
import { useNotificationsContext } from './context';
import { formatDateTime } from './format';
import { useInboxCommands, useInboxItem } from './hooks';
import { Button, Spinner, StateBlock, cx } from './primitives';
import styles from './styles.module.css';

export interface InboxItemViewProps {
  id: string;
  /** Mark the item read once it has been shown. Default: `true`. */
  autoMarkRead?: boolean;
  /** Called after the item has been dismissed (e.g. to go back). */
  onDismissed?: (entry: InboxEntry) => void;
  /** Extra controls next to "Dismiss". */
  actions?: ReactNode;
  /** Render the subject as the heading. Turn off when the host page already
   *  shows it in its own header (see `useInboxItemTitle`). Default: `true`. */
  showSubject?: boolean;
}

/** One notification with its rendered subject and body. */
export function InboxItemView({
  id,
  autoMarkRead = true,
  onDismissed,
  actions,
  showSubject = true,
}: InboxItemViewProps) {
  const { t, locale, renderHtml, describeItem } = useNotificationsContext();
  const item = useInboxItem(id);
  const { markRead, dismiss } = useInboxCommands();

  const entry = item.data;
  const markedFor = useRef<string | null>(null);
  const mutateRead = markRead.mutate;

  // Opening is what "read" means in the contract; the command is idempotent
  // and is sent once per shown item.
  useEffect(() => {
    if (!autoMarkRead || !entry || entry.read) return;
    if (markedFor.current === entry.id) return;
    markedFor.current = entry.id;
    mutateRead(entry.id);
  }, [autoMarkRead, entry, mutateRead]);

  if (item.isPending) {
    return (
      <div className={cx(styles.root, styles.state)}>
        <Spinner label={t('bell.title')} />
      </div>
    );
  }

  if (item.isError || !entry) {
    // A foreign item and a missing one are deliberately the same 404.
    const notFound =
      isNotificationsError(item.error) && item.error.status === 404;
    return (
      <div className={styles.root}>
        <StateBlock
          title={notFound ? t('item.notFound') : t('item.error')}
          note={
            notFound
              ? t('item.notFoundHint')
              : isNotificationsError(item.error) && item.error.traceId
                ? t('error.traceId', { traceId: item.error.traceId })
                : undefined
          }
          action={
            notFound ? undefined : (
              <Button onClick={() => void item.refetch()}>
                {t('inbox.retry')}
              </Button>
            )
          }
        />
      </div>
    );
  }

  const description = describeItem(entry);
  // Never the raw category code: the host's label or a neutral word.
  const subject = entry.subject ?? description?.title ?? t('inbox.untitled');
  const categoryLabel = entry.subject ? description?.title : description?.hint;
  const received = formatDateTime(entry.createdAt, locale);
  const html = entry.bodyHtml && renderHtml ? entry.bodyHtml : null;

  return (
    <article className={cx(styles.root, styles.item)}>
      <header className={styles.itemHeading}>
        {showSubject && <h2 className={styles.itemSubject}>{subject}</h2>}
        <div className={styles.itemMeta}>
          {entry.priority === 'HIGH' && (
            <span className={styles.tag}>{t('priority.HIGH')}</span>
          )}
          {categoryLabel && <span>{categoryLabel}</span>}
          {received && <span>{t('item.received', { date: received })}</span>}
        </div>
      </header>
      {html !== null && renderHtml ? (
        <div className={styles.itemBody}>{renderHtml(html, entry)}</div>
      ) : entry.bodyText ? (
        <p className={cx(styles.bodyText, styles.itemBody)}>{entry.bodyText}</p>
      ) : (
        <p className={styles.stateNote}>{t('item.noBody')}</p>
      )}
      {(actions || !entry.dismissed) && (
        <footer className={styles.itemActions}>
          {actions}
          {!entry.dismissed && (
            <Button
              disabled={dismiss.isPending}
              onClick={() =>
                dismiss.mutate(entry.id, {
                  onSuccess: answer => onDismissed?.(answer),
                })
              }
            >
              {t('item.dismiss')}
            </Button>
          )}
        </footer>
      )}
    </article>
  );
}

/** The heading `InboxItemView` would show - for a host page header. */
export function useInboxItemTitle(id: string | undefined): string | undefined {
  const { t, describeItem } = useNotificationsContext();
  const { data } = useInboxItem(id);
  if (!data) return undefined;
  return data.subject ?? describeItem(data)?.title ?? t('inbox.untitled');
}

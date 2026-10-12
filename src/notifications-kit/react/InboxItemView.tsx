import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';

import { isNotificationsError } from '../core';
import type { InboxEntry } from '../core';
import { MessageBody } from './content';
import { useNotificationsContext } from './context';
import { formatDateTime } from './format';
import { useInboxCommands, useInboxItem } from './hooks';
import {
  Button,
  Chip,
  IconButton,
  Spinner,
  StateBlock,
  cx,
} from './primitives';
import styles from './styles.module.css';

export interface InboxItemViewProps {
  id: string;
  /** Mark the item read once it has been shown. Default: `true`. */
  autoMarkRead?: boolean;
  /** Called after the item has been dismissed (e.g. to go back). */
  onDismissed?: (entry: InboxEntry) => void;
  /** Takes over "Dismiss": the caller sends the command (to animate the
   *  list first, say). */
  onDismiss?: (entry: InboxEntry) => void;
  /** Shows "Open on a separate page" next to "Dismiss". */
  onOpenSeparately?: (entry: InboxEntry) => void;
  /** Extra controls next to "Dismiss". */
  actions?: ReactNode;
  /** Render the subject as the heading. Turn off when the host page already
   *  shows it in its own header (see `useInboxItemTitle`). Default: `true`. */
  showSubject?: boolean;
  className?: string;
}

/** One notification: subject, date, "Important", the body; "Dismiss". */
export function InboxItemView({
  id,
  autoMarkRead = true,
  onDismissed,
  onDismiss,
  onOpenSeparately,
  actions,
  showSubject = true,
  className,
}: InboxItemViewProps) {
  const { t, locale, describeItem } = useNotificationsContext();
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
      <div className={cx(styles.root, styles.state, className)}>
        <Spinner label={t('item.loading')} />
      </div>
    );
  }

  if (item.isError || !entry) {
    // A foreign item and a missing one are deliberately the same 404.
    const notFound =
      isNotificationsError(item.error) && item.error.status === 404;
    return (
      <div className={cx(styles.root, className)}>
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

  const runDismiss = () => {
    if (onDismiss) {
      onDismiss(entry);
      return;
    }
    dismiss.mutate(entry.id, { onSuccess: answer => onDismissed?.(answer) });
  };

  return (
    <article className={cx(styles.root, styles.reader, className)}>
      <header className={styles.readerHead}>
        <div className={styles.readerHeading}>
          {showSubject && <h2 className={styles.readerTitle}>{subject}</h2>}
          <div className={styles.readerMeta}>
            {received && <span>{received}</span>}
            {entry.priority === 'HIGH' && (
              <Chip tone='danger'>{t('priority.HIGH')}</Chip>
            )}
            {categoryLabel && <Chip>{categoryLabel}</Chip>}
          </div>
        </div>
        <div className={styles.readerActions}>
          {actions}
          {onOpenSeparately && (
            <IconButton
              icon='external'
              label={t('item.openSeparately')}
              onClick={() => onOpenSeparately(entry)}
            />
          )}
          {!entry.dismissed && (
            <Button
              icon='close'
              disabled={dismiss.isPending}
              onClick={runDismiss}
            >
              {t('item.dismiss')}
            </Button>
          )}
        </div>
      </header>
      <MessageBody
        key={entry.id}
        source={entry}
        title={subject}
        className={styles.readerBody}
      />
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

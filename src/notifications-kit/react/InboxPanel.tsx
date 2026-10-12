import { useEffect, useRef, useState } from 'react';

import { isNotificationsError } from '../core';
import type { InboxEntry } from '../core';
import { useNotificationsContext } from './context';
import {
  useDismissAll,
  useInboxCommands,
  useInboxDetails,
  useInboxList,
  useUnreadCount,
} from './hooks';
import { InboxRow } from './InboxRow';
import { useFlip } from './motion';
import { Button, Spinner, StateBlock, cx } from './primitives';
import styles from './styles.module.css';
import { useMarkSeenOnShow } from './useMarkSeen';

// ----------------------------------------------------------------- actions

/** "Mark all read". */
export function MarkAllReadButton({
  variant = 'outline',
}: {
  variant?: 'outline' | 'ghost';
}) {
  const { t } = useNotificationsContext();
  const { data: unread } = useUnreadCount();
  const { markAllRead } = useInboxCommands();
  return (
    <Button
      variant={variant}
      size={variant === 'ghost' ? 'sm' : 'md'}
      icon={variant === 'ghost' ? undefined : 'checkAll'}
      className={styles.root}
      disabled={!unread || markAllRead.isPending}
      onClick={() => markAllRead.mutate()}
    >
      {t('inbox.markAllRead')}
    </Button>
  );
}

/**
 * "Dismiss all", with a confirmation and progress. The service has no bulk
 * dismiss: the kit dismisses item by item (see `useDismissAll`).
 */
export function DismissAllButton() {
  const { t } = useNotificationsContext();
  const list = useInboxList({});
  const { progress, start, stop, reset } = useDismissAll();
  const [confirming, setConfirming] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const running = progress?.running ?? false;

  useEffect(() => {
    if (!confirming) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node))
        setConfirming(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setConfirming(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [confirming]);

  // The finished result stays for a moment, then the button comes back.
  useEffect(() => {
    if (!progress || progress.running) return;
    const timer = setTimeout(reset, 4000);
    return () => clearTimeout(timer);
  }, [progress, reset]);

  if (progress) {
    const of =
      progress.total !== null
        ? t('inbox.dismissAll.progress', {
            done: progress.done,
            total: progress.total,
          })
        : t('inbox.dismissAll.progressNoTotal', { done: progress.done });
    const ratio =
      progress.total && progress.total > 0
        ? Math.min(1, progress.done / progress.total)
        : null;
    return (
      <div className={cx(styles.root, styles.dismissAll)} role='status'>
        {running && <Spinner label={of} />}
        <span className={styles.dismissAllText}>
          {running ? of : t('inbox.dismissAll.done', { done: progress.done })}
          {progress.failed > 0 &&
            ` · ${t('inbox.dismissAll.failed', { failed: progress.failed })}`}
        </span>
        {running && ratio !== null && (
          <span className={styles.miniProgress} aria-hidden='true'>
            <span style={{ transform: `scaleX(${ratio})` }} />
          </span>
        )}
        {running && (
          <Button variant='ghost' size='sm' onClick={stop}>
            {t('inbox.dismissAll.stop')}
          </Button>
        )}
      </div>
    );
  }

  const nothing = list.entries.length === 0;
  return (
    <div ref={rootRef} className={cx(styles.root, styles.confirmAnchor)}>
      <Button
        icon='close'
        disabled={nothing}
        aria-expanded={confirming}
        onClick={() => setConfirming(v => !v)}
      >
        {t('inbox.dismissAll')}
      </Button>
      {confirming && (
        <div className={styles.confirmPop} role='dialog'>
          <strong>
            {list.total !== null
              ? t('inbox.dismissAll.confirmCount', { count: list.total })
              : t('inbox.dismissAll.confirm')}
          </strong>
          <span className={styles.stateNote}>
            {t('inbox.dismissAll.confirmNote')}
          </span>
          <div className={styles.confirmActions}>
            <Button size='sm' onClick={() => setConfirming(false)}>
              {t('inbox.dismissAll.cancel')}
            </Button>
            <Button
              size='sm'
              variant='primary'
              onClick={() => {
                setConfirming(false);
                void start();
              }}
            >
              {t('inbox.dismissAll.ok')}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

/** "Mark all read" and "Dismiss all" side by side - for a page header. */
export function InboxActions() {
  return (
    <div className={cx(styles.root, styles.actions)}>
      <MarkAllReadButton />
      <DismissAllButton />
    </div>
  );
}

// -------------------------------------------------------------------- list

export interface InboxListProps {
  unreadOnly?: boolean;
  pageSize?: number;
  /** Show at most this many rows and no "more" control (bell dropdown). */
  limit?: number;
  /** The highlighted row. */
  selectedId?: string | null;
  /** A row was clicked. The row is marked read first (that is what opening
   *  means in the contract) unless `markReadOnSelect` is `false`. */
  onSelect?: (entry: InboxEntry) => void;
  markReadOnSelect?: boolean;
  /** Report shown rows as seen. Default: `true`. */
  markSeen?: boolean;
  /** Rows playing their exit animation. */
  leaving?: ReadonlySet<string>;
  /** A simulated row shown first (the composer's preview). */
  previewEntry?: InboxEntry | null;
  onSelectPreview?: () => void;
}

function errorNote(
  error: unknown,
  t: (key: 'error.traceId', vars: { traceId: string }) => string
) {
  if (!isNotificationsError(error)) return undefined;
  if (error.traceId) return t('error.traceId', { traceId: error.traceId });
  return undefined;
}

/** The rows, with their loading, empty and error states. */
export function InboxList({
  unreadOnly = false,
  pageSize,
  limit,
  selectedId,
  onSelect,
  markReadOnSelect = true,
  markSeen = true,
  leaving,
  previewEntry,
  onSelectPreview,
}: InboxListProps) {
  const { t, enabled } = useNotificationsContext();
  const list = useInboxList({ unreadOnly, pageSize: limit ?? pageSize });
  const { markRead } = useInboxCommands();
  const listRef = useRef<HTMLUListElement>(null);
  const flip = useFlip(listRef, { relative: true });

  const entries =
    limit !== undefined ? list.entries.slice(0, limit) : list.entries;
  const details = useInboxDetails(entries, selectedId ? [selectedId] : []);
  useMarkSeenOnShow(entries, markSeen && enabled);

  // Every commit remembers where the rows were, so a row that leaves (or
  // arrives) moves the others smoothly instead of making them jump.
  useEffect(() => {
    flip.capture();
  });

  const select = (entry: InboxEntry) => {
    if (markReadOnSelect && !entry.read) markRead.mutate(entry.id);
    onSelect?.(entry);
  };

  // One reading of the clock per render keeps every row's time consistent.
  const now = Date.now();

  if (list.isPending && enabled) {
    return (
      <div className={styles.state}>
        <Spinner label={t('bell.title')} />
      </div>
    );
  }

  if (list.isError && entries.length === 0) {
    return (
      <StateBlock
        title={t('inbox.error')}
        note={errorNote(list.error, t)}
        action={
          <Button onClick={() => void list.refetch()}>
            {t('inbox.retry')}
          </Button>
        }
      />
    );
  }

  if (entries.length === 0 && !previewEntry) {
    return (
      <StateBlock
        icon='bell'
        title={unreadOnly ? t('inbox.emptyUnread') : t('inbox.empty')}
      />
    );
  }

  return (
    <>
      <ul ref={listRef} className={styles.list}>
        {previewEntry && (
          <InboxRow
            key={previewEntry.id}
            entry={previewEntry}
            full={previewEntry}
            now={now}
            preview
            onSelect={() => onSelectPreview?.()}
          />
        )}
        {entries.map(entry => (
          <InboxRow
            key={entry.id}
            entry={entry}
            full={details.items.get(entry.id)}
            now={now}
            selected={selectedId === entry.id}
            leaving={leaving?.has(entry.id)}
            onSelect={select}
          />
        ))}
      </ul>
      {limit === undefined && list.hasNextPage && (
        <div className={styles.listFooter}>
          <Button
            disabled={list.isFetchingNextPage}
            onClick={() => void list.fetchNextPage()}
          >
            {list.isFetchingNextPage ? t('item.loading') : t('inbox.loadMore')}
          </Button>
        </div>
      )}
    </>
  );
}

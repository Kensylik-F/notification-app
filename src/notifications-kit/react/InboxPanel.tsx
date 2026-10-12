import { useState } from 'react';
import type { ReactNode } from 'react';

import { isNotificationsError } from '../core';
import type { InboxEntry } from '../core';
import { useNotificationsContext } from './context';
import {
  useInboxCommands,
  useInboxDetails,
  useInboxList,
  useUnreadCount,
} from './hooks';
import { InboxRow } from './InboxRow';
import { Button, Spinner, StateBlock, cx } from './primitives';
import styles from './styles.module.css';
import { useMarkSeenOnShow } from './useMarkSeen';

// ------------------------------------------------------------ pieces

interface InboxTabsProps {
  unreadOnly: boolean;
  onChange: (unreadOnly: boolean) => void;
}

/** "All / Unread". Exported so a host can put it in its own page header. */
export function InboxTabs({ unreadOnly, onChange }: InboxTabsProps) {
  const { t } = useNotificationsContext();
  const { data: unread } = useUnreadCount();
  return (
    <div className={cx(styles.root, styles.tabs)} role='tablist'>
      <button
        type='button'
        role='tab'
        className={styles.tab}
        aria-selected={!unreadOnly}
        onClick={() => onChange(false)}
      >
        {t('inbox.tab.all')}
      </button>
      <button
        type='button'
        role='tab'
        className={styles.tab}
        aria-selected={unreadOnly}
        onClick={() => onChange(true)}
      >
        {t('inbox.tab.unread')}
        {unread !== undefined && unread > 0 && (
          <span className={styles.tabCount}>{unread}</span>
        )}
      </button>
    </div>
  );
}

/** Exported for the same reason as `InboxTabs`. */
export function MarkAllReadButton() {
  const { t } = useNotificationsContext();
  const { data: unread } = useUnreadCount();
  const { markAllRead } = useInboxCommands();
  return (
    <Button
      variant='ghost'
      icon='checkAll'
      className={styles.root}
      disabled={!unread || markAllRead.isPending}
      onClick={() => markAllRead.mutate()}
    >
      {t('inbox.markAllRead')}
    </Button>
  );
}

// -------------------------------------------------------------- list

export interface InboxListProps {
  unreadOnly?: boolean;
  pageSize?: number;
  /** Show at most this many rows and no "more" control (bell dropdown). */
  limit?: number;
  /**
   * A row opens in place: a click expands it, shows the text and marks it
   * read. With this prop an expanded row also offers "Open separately" -
   * for a host that keeps a page per notification.
   */
  onOpenItem?: (entry: InboxEntry) => void;
  /** Extra controls inside an expanded row. */
  rowActions?: (entry: InboxEntry) => ReactNode;
  /** Mark a row read when it is expanded. Default: `true`. */
  markReadOnExpand?: boolean;
  /** Report shown rows as seen. Default: `true`. */
  markSeen?: boolean;
  /** Offer "dismiss" in an expanded row. Default: `true`. */
  dismissible?: boolean;
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
  onOpenItem,
  rowActions,
  markReadOnExpand = true,
  markSeen = true,
  dismissible = true,
}: InboxListProps) {
  const { t, enabled } = useNotificationsContext();
  const list = useInboxList({ unreadOnly, pageSize: limit ?? pageSize });
  const { dismiss, markRead } = useInboxCommands();
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const entries =
    limit !== undefined ? list.entries.slice(0, limit) : list.entries;
  const details = useInboxDetails(
    entries,
    expandedId === null ? [] : [expandedId]
  );
  useMarkSeenOnShow(entries, markSeen && enabled);

  const toggle = (entry: InboxEntry) => {
    if (expandedId === entry.id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(entry.id);
    // Reading the text in place is what "read" means in the contract.
    if (markReadOnExpand && !entry.read) markRead.mutate(entry.id);
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

  if (entries.length === 0) {
    return (
      <StateBlock
        title={unreadOnly ? t('inbox.emptyUnread') : t('inbox.empty')}
      />
    );
  }

  return (
    <>
      <ul className={styles.list}>
        {entries.map(entry => (
          <InboxRow
            key={entry.id}
            entry={entry}
            full={details.items.get(entry.id)}
            fullError={details.errors.get(entry.id)}
            now={now}
            expanded={expandedId === entry.id}
            onToggle={toggle}
            onOpenSeparately={onOpenItem}
            actions={rowActions}
            onDismiss={
              dismissible
                ? target => {
                    setExpandedId(null);
                    dismiss.mutate(target.id);
                  }
                : undefined
            }
          />
        ))}
      </ul>
      {limit === undefined && (
        <div className={styles.panelFooter}>
          <span>
            {list.total !== null
              ? t('inbox.total', { count: list.total })
              : null}
          </span>
          {list.hasNextPage && (
            <Button
              disabled={list.isFetchingNextPage}
              onClick={() => void list.fetchNextPage()}
            >
              {t('inbox.loadMore')}
            </Button>
          )}
        </div>
      )}
    </>
  );
}

// ------------------------------------------------------------- panel

export interface InboxPanelProps
  extends Omit<InboxListProps, 'unreadOnly' | 'limit'> {
  /** Controlled filter. Leave both out to let the panel own it. */
  unreadOnly?: boolean;
  onUnreadOnlyChange?: (unreadOnly: boolean) => void;
  /** Hide the built-in bar when the host renders `InboxTabs` and
   *  `MarkAllReadButton` in its own page header. Default: `true`. */
  showBar?: boolean;
}

/** The whole inbox: filter, "mark all read", rows, paging. */
export function InboxPanel({
  unreadOnly,
  onUnreadOnlyChange,
  showBar = true,
  ...listProps
}: InboxPanelProps) {
  const [ownUnreadOnly, setOwnUnreadOnly] = useState(false);
  const controlled = unreadOnly !== undefined;
  const value = controlled ? unreadOnly : ownUnreadOnly;
  const change = (next: boolean) => {
    if (!controlled) setOwnUnreadOnly(next);
    onUnreadOnlyChange?.(next);
  };

  return (
    <div className={cx(styles.root, styles.panel)}>
      {showBar && (
        <div className={styles.panelBar}>
          <InboxTabs unreadOnly={value} onChange={change} />
          <MarkAllReadButton />
        </div>
      )}
      <InboxList unreadOnly={value} {...listProps} />
    </div>
  );
}

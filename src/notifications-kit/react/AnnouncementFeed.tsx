import { useState } from 'react';
import type { ReactNode } from 'react';

import { isNotificationsError } from '../core';
import type { AnnouncementEntry } from '../core';
import { useNotificationsContext } from './context';
import { formatDateTime, formatRelative } from './format';
import {
  useAnnouncement,
  useAnnouncements,
  useDismissAnnouncement,
  useDismissedAnnouncements,
} from './hooks';
import { Button, HtmlFrame, Icon, Spinner, StateBlock, cx } from './primitives';
import styles from './styles.module.css';

export interface AnnouncementFeedProps {
  /** Controlled tab. Leave both out to let the feed own it. */
  view?: 'active' | 'dismissed';
  onViewChange?: (view: 'active' | 'dismissed') => void;
  /** Hide the built-in tabs when the host renders its own. */
  showTabs?: boolean;
}

/**
 * Announcements as a list: the ones that are showing now, and the ones
 * dismissed in this browser. The service lists only outstanding
 * announcements, so "dismissed" is the kit's own record (see
 * announcementHistory.ts); once an announcement's window ends the service
 * deletes it and only that record remains.
 */
export function AnnouncementFeed({
  view,
  onViewChange,
  showTabs = true,
}: AnnouncementFeedProps) {
  const { t } = useNotificationsContext();
  const [own, setOwn] = useState<'active' | 'dismissed'>('active');
  const current = view ?? own;
  const change = (next: 'active' | 'dismissed') => {
    if (view === undefined) setOwn(next);
    onViewChange?.(next);
  };
  const dismissed = useDismissedAnnouncements();
  const active = useAnnouncements({ pageSize: 50 });
  const activeCount = active.data?.items.length ?? 0;

  return (
    <div className={cx(styles.root, styles.panel)}>
      {showTabs && (
        <div className={styles.panelBar}>
          <div className={styles.tabs} role='tablist'>
            <button
              type='button'
              role='tab'
              className={styles.tab}
              aria-selected={current === 'active'}
              onClick={() => change('active')}
            >
              {t('feed.active')}
              {activeCount > 0 && (
                <span className={styles.tabCount}>{activeCount}</span>
              )}
            </button>
            <button
              type='button'
              role='tab'
              className={styles.tab}
              aria-selected={current === 'dismissed'}
              onClick={() => change('dismissed')}
            >
              {t('feed.dismissed')}
            </button>
          </div>
        </div>
      )}
      {current === 'active' ? (
        <ActiveList query={active} />
      ) : (
        <DismissedList items={dismissed} />
      )}
    </div>
  );
}

function ActiveList({ query }: { query: ReturnType<typeof useAnnouncements> }) {
  const { t } = useNotificationsContext();
  const dismiss = useDismissAnnouncement();
  const [openId, setOpenId] = useState<string | null>(null);

  if (query.isPending) {
    return (
      <div className={styles.state}>
        <Spinner label={t('item.loading')} />
      </div>
    );
  }
  if (query.isError) {
    return (
      <StateBlock
        title={t('feed.error')}
        action={
          <Button onClick={() => void query.refetch()}>
            {t('inbox.retry')}
          </Button>
        }
      />
    );
  }
  const items = query.data.items;
  if (items.length === 0) return <StateBlock title={t('feed.emptyActive')} />;

  return (
    <ul className={styles.list}>
      {items.map(entry => (
        <AnnouncementRow
          key={entry.id}
          entry={entry}
          expanded={openId === entry.id}
          onToggle={() => setOpenId(openId === entry.id ? null : entry.id)}
          actions={
            <Button onClick={() => dismiss.mutate(entry.id)}>
              {t('announcement.dismiss')}
            </Button>
          }
        />
      ))}
    </ul>
  );
}

function DismissedList({
  items,
}: {
  items: ReturnType<typeof useDismissedAnnouncements>;
}) {
  const { t, locale } = useNotificationsContext();
  const [openId, setOpenId] = useState<string | null>(null);

  if (items.length === 0) {
    return (
      <StateBlock
        title={t('feed.emptyDismissed')}
        note={t('feed.dismissedHint')}
      />
    );
  }
  return (
    <>
      <ul className={styles.list}>
        {items.map(({ entry, dismissedAt }) => (
          <DismissedRow
            key={entry.id}
            stored={entry}
            dismissedAt={formatDateTime(dismissedAt, locale)}
            expanded={openId === entry.id}
            onToggle={() => setOpenId(openId === entry.id ? null : entry.id)}
          />
        ))}
      </ul>
      <p className={cx(styles.stateNote, styles.feedNote)}>
        {t('feed.dismissedHint')}
      </p>
    </>
  );
}

/** Refreshes from the service while it still has the announcement; after
 *  the window ends (404) the stored copy is what is shown. */
function DismissedRow({
  stored,
  dismissedAt,
  expanded,
  onToggle,
}: {
  stored: AnnouncementEntry;
  dismissedAt: string | null;
  expanded: boolean;
  onToggle: () => void;
}) {
  const { t } = useNotificationsContext();
  const live = useAnnouncement(expanded ? stored.id : undefined);
  const gone = isNotificationsError(live.error) && live.error.status === 404;
  return (
    <AnnouncementRow
      entry={live.data ?? stored}
      expanded={expanded}
      onToggle={onToggle}
      extraMeta={
        dismissedAt ? t('feed.dismissedAt', { date: dismissedAt }) : undefined
      }
      note={gone ? t('feed.expired') : undefined}
      muted
    />
  );
}

function AnnouncementRow({
  entry,
  expanded,
  onToggle,
  actions,
  extraMeta,
  note,
  muted,
}: {
  entry: AnnouncementEntry;
  expanded: boolean;
  onToggle: () => void;
  actions?: ReactNode;
  extraMeta?: string;
  note?: string;
  muted?: boolean;
}) {
  const { t, locale, renderHtml, admin } = useNotificationsContext();
  const title = entry.subject ?? t('announcement.untitled');
  const label = entry.category
    ? admin.categories.find(c => c.code === entry.category)?.label
    : undefined;
  const published = formatRelative(entry.publishedAt, Date.now(), locale);
  const until = formatDateTime(entry.visibleUntil, locale);
  const bodyId = `nk-ann-${entry.id}`;

  return (
    <li className={styles.row} data-expanded={expanded}>
      <button
        type='button'
        className={styles.rowMain}
        aria-expanded={expanded}
        aria-controls={bodyId}
        onClick={onToggle}
      >
        <span className={styles.feedIcon} data-muted={muted || undefined}>
          <Icon name='info' small />
        </span>
        <span className={styles.rowText}>
          <span className={styles.rowTitle} data-unread={!muted}>
            {title}
          </span>
          <span className={styles.rowMeta}>
            {[
              label,
              published === 'now' ? t('time.justNow') : published,
              extraMeta,
            ]
              .filter(Boolean)
              .join(' · ')}
          </span>
        </span>
        <span className={styles.rowChevron} aria-hidden='true'>
          <Icon name='chevron' small />
        </span>
      </button>
      {expanded && (
        <div id={bodyId} className={styles.rowBody}>
          {entry.bodyHtml ? (
            renderHtml ? (
              renderHtml(entry.bodyHtml, entry)
            ) : (
              <HtmlFrame html={entry.bodyHtml} title={title} />
            )
          ) : entry.bodyText ? (
            <p className={styles.bodyText}>{entry.bodyText}</p>
          ) : (
            <p className={styles.stateNote}>{t('item.noBody')}</p>
          )}
          <span className={styles.stateNote}>
            {note ?? (until ? t('feed.until', { date: until }) : null)}
          </span>
          {actions && <div className={styles.rowActions}>{actions}</div>}
        </div>
      )}
    </li>
  );
}

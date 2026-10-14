import { useEffect, useRef, useState } from 'react';
import type { ReactNode, RefObject } from 'react';

import { isNotificationsError } from '../core';
import type { AnnouncementEntry, InboxEntry } from '../core';
import type { DismissedAnnouncement } from './announcementHistory';
import { MessageBody } from './content';
import { useNotificationsContext } from './context';
import { formatCardTime, formatDay } from './format';
import {
  useAnnouncement,
  useAnnouncements,
  useDismissAnnouncement,
  useDismissedAnnouncements,
  useInboxCommands,
  useInboxList,
  useUnreadCount,
} from './hooks';
import { InboxItemView } from './InboxItemView';
import { InboxActions, InboxList } from './InboxPanel';
import { AnnouncementRow } from './InboxRow';
import { useFlip, useLeaving } from './motion';
import { byPriority, isImportant } from './presentation';
import {
  Button,
  Chip,
  Spinner,
  StateBlock,
  Switch,
  Tabs,
  cx,
} from './primitives';
import styles from './styles.module.css';

export type NotificationCenterTab = 'inbox' | 'announcements';

export interface NotificationCenterProps {
  /** Controlled tab - e.g. kept in the address (`?tab=`). */
  tab?: NotificationCenterTab;
  onTabChange?: (tab: NotificationCenterTab) => void;
  /** Controlled selection - e.g. kept in the address (`?item=`). */
  selectedId?: string | null;
  onSelectedChange?: (id: string | null) => void;
  /** Controlled "Unread only". */
  unreadOnly?: boolean;
  onUnreadOnlyChange?: (value: boolean) => void;
  /** Adds "Open on a separate page" to an opened notification. */
  onOpenItem?: (entry: InboxEntry) => void;
  /**
   * A heading row with "Mark all read" and "Dismiss all" on its right. Leave
   * it out when the page header is the host's: put `<InboxActions />` there.
   */
  title?: ReactNode;
  pageSize?: number;
  className?: string;
}

/** Below this width the list and the text take turns instead of sitting
 *  side by side. */
const COMPACT_BELOW = 720;

function useCompact(ref: RefObject<HTMLElement | null>) {
  const [compact, setCompact] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setCompact(entry.contentRect.width < COMPACT_BELOW);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
  return compact;
}

/** State that the host may control, or leave to the component. */
function useMaybeControlled<T>(
  value: T | undefined,
  onChange: ((value: T) => void) | undefined,
  initial: T
): [T, (value: T) => void] {
  const [own, setOwn] = useState(initial);
  const current = value === undefined ? own : value;
  const set = (next: T) => {
    if (value === undefined) setOwn(next);
    onChange?.(next);
  };
  return [current, set];
}

/**
 * The notifications page: "Inbox" and "Announcements" in one row of tabs;
 * on the left the list, on the right the opened item with its full text.
 * Announcements show what is on now and what was closed in this browser.
 */
export function NotificationCenter({
  tab: tabProp,
  onTabChange,
  selectedId: selectedProp,
  onSelectedChange,
  unreadOnly: unreadProp,
  onUnreadOnlyChange,
  onOpenItem,
  title,
  pageSize,
  className,
}: NotificationCenterProps) {
  const { t, features } = useNotificationsContext();
  const rootRef = useRef<HTMLDivElement>(null);
  const compact = useCompact(rootRef);
  const [chosenTab, setTab] = useMaybeControlled<NotificationCenterTab>(
    tabProp,
    onTabChange,
    features.inbox ? 'inbox' : 'announcements'
  );
  // A part that is switched off has no tab; the other one is all there is.
  const tabs = (['inbox', 'announcements'] as const).filter(
    part => features[part]
  );
  const tab: NotificationCenterTab = tabs.includes(chosenTab)
    ? chosenTab
    : (tabs[0] ?? 'inbox');
  const [selected, setSelected] = useMaybeControlled<string | null>(
    selectedProp,
    onSelectedChange,
    null
  );
  const [unreadOnly, setUnreadOnly] = useMaybeControlled<boolean>(
    unreadProp,
    onUnreadOnlyChange,
    false
  );
  const { data: unread } = useUnreadCount();
  const active = useAnnouncements();
  const activeCount = active.data?.items.length ?? 0;

  const showList = !compact || !selected;
  const showReader = !compact || Boolean(selected);

  return (
    <div
      ref={rootRef}
      className={cx(styles.root, styles.center, className)}
      data-compact={compact || undefined}
    >
      {title !== undefined && (
        <div className={styles.centerHead}>
          <h1 className={styles.centerTitle}>{title}</h1>
          {tab === 'inbox' && <InboxActions />}
        </div>
      )}
      {tabs.length > 1 && (
        <Tabs
          label={t('bell.title')}
          value={tab}
          onChange={next => {
            setTab(next);
            setSelected(null);
          }}
          items={[
            { value: 'inbox', label: t('center.tab.inbox'), count: unread },
            {
              value: 'announcements',
              label: t('center.tab.announcements'),
              count: activeCount,
            },
          ]}
          after={
            tab === 'inbox' ? (
              <Switch
                checked={unreadOnly}
                onChange={value => {
                  setUnreadOnly(value);
                  setSelected(null);
                }}
                label={t('center.unreadOnly')}
              />
            ) : undefined
          }
        />
      )}
      {tabs.length === 0 ? null : (
        <div className={styles.split} key={tab}>
          {tab === 'inbox' ? (
            <InboxSide
              unreadOnly={unreadOnly}
              pageSize={pageSize}
              selected={selected}
              onSelect={setSelected}
              onOpenItem={onOpenItem}
              showList={showList}
              showReader={showReader}
              compact={compact}
            />
          ) : (
            <AnnouncementSide
              selected={selected}
              onSelect={setSelected}
              showList={showList}
              showReader={showReader}
              compact={compact}
            />
          )}
        </div>
      )}
    </div>
  );
}

function BackButton({ onClick }: { onClick: () => void }) {
  const { t } = useNotificationsContext();
  return (
    <Button
      variant='ghost'
      size='sm'
      icon='back'
      className={styles.back}
      onClick={onClick}
    >
      {t('center.back')}
    </Button>
  );
}

// -------------------------------------------------------------------- inbox

function InboxSide({
  unreadOnly,
  pageSize,
  selected,
  onSelect,
  onOpenItem,
  showList,
  showReader,
  compact,
}: {
  unreadOnly: boolean;
  pageSize?: number;
  selected: string | null;
  onSelect: (id: string | null) => void;
  onOpenItem?: (entry: InboxEntry) => void;
  showList: boolean;
  showReader: boolean;
  compact: boolean;
}) {
  const { t } = useNotificationsContext();
  const list = useInboxList({ unreadOnly, pageSize });
  const { dismiss } = useInboxCommands();
  const { leaving, leave } = useLeaving();

  /** Dismiss from the reader: the row leaves, the next one opens. */
  const dismissOpened = (entry: InboxEntry) => {
    const ids = list.entries.map(e => e.id);
    const index = ids.indexOf(entry.id);
    const next = ids[index + 1] ?? ids[index - 1] ?? null;
    leave(entry.id, () => {
      dismiss.mutate(entry.id);
      onSelect(compact ? null : next);
    });
  };

  return (
    <>
      {showList && (
        <div className={styles.listPane}>
          <InboxList
            unreadOnly={unreadOnly}
            pageSize={pageSize}
            selectedId={selected}
            leaving={leaving}
            onSelect={entry => onSelect(entry.id)}
          />
        </div>
      )}
      {showReader && (
        <div className={styles.readerPane}>
          {compact && <BackButton onClick={() => onSelect(null)} />}
          {selected ? (
            <div key={selected} className={styles.readerEnter}>
              <InboxItemView
                id={selected}
                onDismiss={dismissOpened}
                onOpenSeparately={onOpenItem}
              />
            </div>
          ) : (
            <StateBlock
              icon='bell'
              title={t('center.pick')}
              note={t('center.pickNote')}
            />
          )}
        </div>
      )}
    </>
  );
}

// ------------------------------------------------------------ announcements

type Picked =
  | { kind: 'active'; entry: AnnouncementEntry }
  | { kind: 'closed'; record: DismissedAnnouncement };

function AnnouncementSide({
  selected,
  onSelect,
  showList,
  showReader,
  compact,
}: {
  selected: string | null;
  onSelect: (id: string | null) => void;
  showList: boolean;
  showReader: boolean;
  compact: boolean;
}) {
  const { t } = useNotificationsContext();
  const active = useAnnouncements();
  const closed = useDismissedAnnouncements();
  const dismiss = useDismissAnnouncement();
  const { leaving, leave } = useLeaving();
  const listRef = useRef<HTMLDivElement>(null);
  const flip = useFlip(listRef, { relative: true });
  useEffect(() => {
    flip.capture();
  });

  const items = byPriority(active.data?.items ?? []);
  const activeIds = new Set(items.map(e => e.id));
  // The service still lists an announcement until the dismissal lands.
  const history = closed.filter(record => !activeIds.has(record.entry.id));
  const now = Date.now();

  const picked: Picked | null = (() => {
    if (!selected) return null;
    const live = items.find(e => e.id === selected);
    if (live) return { kind: 'active', entry: live };
    const record = history.find(r => r.entry.id === selected);
    return record ? { kind: 'closed', record } : null;
  })();

  const close = (entry: AnnouncementEntry) =>
    leave(entry.id, () => {
      dismiss.mutate(entry.id);
      // It stays open, now from the "closed" side.
    });

  return (
    <>
      {showList && (
        <div className={styles.listPane} ref={listRef}>
          {active.isPending ? (
            <div className={styles.state}>
              <Spinner label={t('item.loading')} />
            </div>
          ) : active.isError ? (
            <StateBlock
              title={t('feed.error')}
              action={
                <Button onClick={() => void active.refetch()}>
                  {t('inbox.retry')}
                </Button>
              }
            />
          ) : (
            <>
              <div className={styles.listLabel}>{t('feed.active')}</div>
              {items.length === 0 ? (
                <p className={styles.listNote}>{t('feed.emptyActive')}</p>
              ) : (
                <ul className={styles.list}>
                  {items.map(entry => (
                    <AnnouncementRow
                      key={entry.id}
                      entry={entry}
                      now={now}
                      selected={selected === entry.id}
                      leaving={leaving.has(entry.id)}
                      onClick={() => onSelect(entry.id)}
                    />
                  ))}
                </ul>
              )}
            </>
          )}
          <div className={styles.listLabel}>{t('feed.dismissedEarlier')}</div>
          {history.length === 0 ? (
            <p className={styles.listNote}>{t('feed.emptyDismissed')}</p>
          ) : (
            <ul className={styles.list}>
              {history.map(({ entry, dismissedAt }) => (
                <AnnouncementRow
                  key={entry.id}
                  entry={entry}
                  now={now}
                  closedAt={dismissedAt}
                  selected={selected === entry.id}
                  onClick={() => onSelect(entry.id)}
                />
              ))}
            </ul>
          )}
        </div>
      )}
      {showReader && (
        <div className={styles.readerPane}>
          {compact && <BackButton onClick={() => onSelect(null)} />}
          {picked ? (
            <div
              key={`${picked.kind}:${selected}`}
              className={styles.readerEnter}
            >
              {picked.kind === 'active' ? (
                <AnnouncementReader
                  entry={picked.entry}
                  onClose={() => close(picked.entry)}
                />
              ) : (
                <ClosedReader record={picked.record} />
              )}
            </div>
          ) : (
            <StateBlock
              icon='info'
              title={t('center.pickAnnouncement')}
              note={t('center.pickNote')}
            />
          )}
        </div>
      )}
    </>
  );
}

function AnnouncementReader({
  entry,
  closedAt,
  note,
  onClose,
}: {
  entry: AnnouncementEntry;
  closedAt?: string | null;
  note?: string;
  onClose?: () => void;
}) {
  const { t, locale, admin } = useNotificationsContext();
  const now = Date.now();
  const title = entry.subject ?? t('announcement.untitled');
  const until = formatDay(entry.visibleUntil, now, locale);
  const label = entry.category
    ? admin.categories.find(c => c.code === entry.category)?.label
    : undefined;
  return (
    <article className={cx(styles.root, styles.reader)}>
      <header className={styles.readerHead}>
        <div className={styles.readerHeading}>
          <h2 className={styles.readerTitle}>{title}</h2>
          <div className={styles.readerMeta}>
            <span>{formatCardTime(entry.publishedAt, now, locale)}</span>
            {until && (
              <Chip>
                {closedAt !== undefined
                  ? t('feed.untilPast', { date: until })
                  : t('feed.until', { date: until })}
              </Chip>
            )}
            {isImportant(entry) && (
              <Chip tone='danger'>{t('announcement.important')}</Chip>
            )}
            {label && <Chip>{label}</Chip>}
          </div>
        </div>
        {onClose && (
          <div className={styles.readerActions}>
            <Button icon='close' onClick={onClose}>
              {t('announcement.dismiss')}
            </Button>
          </div>
        )}
      </header>
      {note && <p className={styles.readerNote}>{note}</p>}
      <MessageBody source={entry} title={title} className={styles.readerBody} />
    </article>
  );
}

/** Refreshes from the service while it still has the announcement; after
 *  the window ends (404) the copy kept in the browser is shown. */
function ClosedReader({ record }: { record: DismissedAnnouncement }) {
  const { t } = useNotificationsContext();
  const live = useAnnouncement(record.entry.id);
  const gone = isNotificationsError(live.error) && live.error.status === 404;
  return (
    <AnnouncementReader
      entry={live.data ?? record.entry}
      closedAt={record.dismissedAt}
      note={gone ? t('feed.expired') : undefined}
    />
  );
}

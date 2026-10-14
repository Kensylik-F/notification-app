import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { createPortal } from 'react-dom';

import { notificationKeys, odata } from '../core';
import type { AnnouncementEntry, InboxEntry } from '../core';
import { MessageBody, hasMore, plainText } from './content';
import { useNotificationsContext } from './context';
import { formatCardTime, formatDay } from './format';
import {
  useAnnouncements,
  useDismissAnnouncement,
  useInboxCommands,
  useUnreadCount,
} from './hooks';
import { useFlip, useLeaving } from './motion';
import { isImportant, queueAnnouncements } from './presentation';
import { PREVIEW_ID, useKitPreview } from './preview';
import {
  Button,
  Chip,
  CloseButton,
  Dialog,
  Icon,
  IconButton,
  cx,
  useDomId,
} from './primitives';
import styles from './styles.module.css';

export interface AnnouncementsHostProps {
  /** How long a new-notification card stays. Default: 8000. */
  toastDurationMs?: number;
  /**
   * How long a strip stays before it hides until the browser tab is closed
   * (the service still counts it outstanding). `0` - until it is closed.
   * Default: 0.
   */
  stripDurationMs?: number;
  /** Pause after the page loads before the first announcement. Default:
   *  1500. */
  firstDelayMs?: number;
  /** Pause between one announcement closing and the next. Default: 800. */
  gapMs?: number;
  /** Cards in the deck. Default: no limit. */
  maxCorner?: number;
  /** "2 of 3" on a dialog and a strip while their queue holds more than
   *  one. Default: `false`. */
  showPosition?: boolean;
  /** Show a card when a new notification arrives. Default: `true`. */
  inboxToasts?: boolean;
  /** "Open" on a new-notification card. Without it the card opens the
   *  notification in a dialog. */
  onOpenItem?: (entry: InboxEntry) => void;
  /** "Read more" on an announcement. Without it the announcement opens in
   *  a dialog. */
  onOpenAnnouncement?: (entry: AnnouncementEntry) => void;
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
    // Storage may be unavailable; the strip then reappears on reload.
  }
}

/** Runs `onTimeout` after `ms`, paused while `paused`. */
function useTimeout(ms: number, onTimeout: () => void, paused: boolean) {
  const callback = useRef(onTimeout);
  callback.current = onTimeout;
  const left = useRef(ms);
  useEffect(() => {
    if (paused || ms <= 0) return;
    const started = Date.now();
    const timer = window.setTimeout(() => callback.current(), left.current);
    return () => {
      window.clearTimeout(timer);
      left.current = Math.max(800, left.current - (Date.now() - started));
    };
  }, [paused, ms]);
}

// ------------------------------------------------------------------ cards

interface CardProps {
  entry: AnnouncementEntry;
  layer: number;
  leaving: boolean;
  stacked: boolean;
  /** "ещё N" on the front card of a folded stack. */
  more?: number;
  preview?: boolean;
  onMain: () => void;
  onReadMore?: () => void;
  onClose: () => void;
}

function DeckCard({
  entry,
  layer,
  leaving,
  stacked,
  more,
  preview,
  onMain,
  onReadMore,
  onClose,
}: CardProps) {
  const { t, locale } = useNotificationsContext();
  const hidden = stacked && layer > 0;
  const time = formatCardTime(entry.publishedAt, Date.now(), locale);
  const text = plainText(entry);
  return (
    <div
      className={styles.deckCard}
      data-flip={entry.id}
      data-layer={Math.min(layer, 3)}
      data-leaving={leaving || undefined}
      data-preview={preview || undefined}
      aria-hidden={hidden || undefined}
      role='group'
      aria-label={entry.subject ?? t('announcement.untitled')}
    >
      <div className={styles.cardInner}>
        <button
          type='button'
          className={styles.cardMain}
          tabIndex={hidden ? -1 : undefined}
          aria-expanded={more ? false : undefined}
          onClick={onMain}
        >
          <span className={styles.cardMeta}>
            <span className={styles.cardMetaText}>
              {time}
              {more ? (
                <>
                  {time && ' · '}
                  <span className={styles.cardMore}>
                    {t('announcement.more', { count: more })}
                  </span>
                </>
              ) : null}
            </span>
            {preview && <Chip tone='preview'>{t('preview.chip')}</Chip>}
          </span>
          <span className={styles.cardTitle}>
            {entry.subject ?? t('announcement.untitled')}
          </span>
          {text && <span className={styles.cardBody}>{text}</span>}
        </button>
        {onReadMore && !hidden && !more && (
          <button
            type='button'
            className={styles.cardLink}
            onClick={onReadMore}
          >
            {t('announcement.readMore')}
          </button>
        )}
      </div>
      <CloseButton
        label={
          preview ? t('preview.closePreview') : t('announcement.dismissLabel')
        }
        tabIndex={hidden ? -1 : undefined}
        onClick={event => {
          event.stopPropagation();
          onClose();
        }}
      />
    </div>
  );
}

/**
 * Corner announcements as a deck, the way a phone groups notifications: the
 * newest card in front, two more peeking out above it. A click fans the
 * deck out into a list with "Close all" and "Collapse"; the cards glide
 * between the two layouts.
 */
function CornerDeck({
  entries,
  previewId,
  onDismiss,
  onOpen,
  onClosePreview,
}: {
  entries: AnnouncementEntry[];
  previewId: string | null;
  onDismiss: (id: string) => void;
  onOpen: (entry: AnnouncementEntry) => void;
  onClosePreview: () => void;
}) {
  const { t } = useNotificationsContext();
  const [expanded, setExpanded] = useState(false);

  const deckRef = useRef<HTMLDivElement>(null);
  const flip = useFlip(deckRef);
  const { leaving, leave } = useLeaving();
  const many = entries.length > 1;
  const open = expanded && many;

  useEffect(() => {
    if (!many) setExpanded(false);
  }, [many]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      flip.capture();
      setExpanded(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, flip]);

  const toggle = (next: boolean) => {
    flip.capture();
    setExpanded(next);
  };

  const close = (id: string, delay = 0) =>
    leave(
      id,
      () => {
        flip.capture();
        if (id === previewId) onClosePreview();
        else onDismiss(id);
      },
      delay
    );

  return (
    <div className={styles.deckWrap}>
      {open && (
        <div className={styles.deckBar}>
          <span className={styles.deckBarTitle}>
            {t('announcement.header', { count: entries.length })}
          </span>
          <Button
            size='sm'
            onClick={() =>
              entries.forEach((entry, index) => close(entry.id, index * 45))
            }
          >
            {t('announcement.dismissAll')}
          </Button>
          <IconButton
            icon='chevron'
            label={t('announcement.collapse')}
            onClick={() => toggle(false)}
          />
        </div>
      )}
      <div
        ref={deckRef}
        className={styles.deck}
        data-stacked={(!open && many) || undefined}
        data-expanded={open || undefined}
      >
        {entries.map((entry, index) => {
          const isPreview = entry.id === previewId;
          const front = !open && index === 0;
          return (
            <DeckCard
              key={entry.id}
              entry={entry}
              layer={open ? 0 : index}
              stacked={!open && many}
              leaving={leaving.has(entry.id)}
              more={front && many ? entries.length - 1 : undefined}
              preview={isPreview}
              onMain={() => (front && many ? toggle(true) : onOpen(entry))}
              onReadMore={hasMore(entry) ? () => onOpen(entry) : undefined}
              onClose={() => close(entry.id)}
            />
          );
        })}
      </div>
    </div>
  );
}

export const STRIP_LEAVE_MS = 300;

interface Position {
  index: number;
  total: number;
}

/** "2 of 3" while a queue holds more than one. */
function positionOf(closed: number, waiting: number): Position | null {
  const total = closed + waiting;
  return total > 1 ? { index: closed + 1, total } : null;
}

/**
 * An announcement shown as a strip at the top centre. It stays until it is
 * closed; the host plays its exit (`leaving`) so the band behind it can
 * leave together with it.
 */
function Strip({
  entry,
  preview,
  position,
  leaving,
  durationMs,
  onTimeout,
  onClose,
  onOpen,
}: {
  entry: AnnouncementEntry;
  preview: boolean;
  position: Position | null;
  leaving: boolean;
  durationMs: number;
  onTimeout: () => void;
  onClose: () => void;
  onOpen: () => void;
}) {
  const { t } = useNotificationsContext();
  const [hover, setHover] = useState(false);
  useTimeout(preview ? 0 : durationMs, onTimeout, hover || leaving);
  const text = plainText(entry);
  const important = isImportant(entry);

  return (
    <div
      className={styles.strip}
      role='status'
      data-tone={important ? 'important' : undefined}
      data-leaving={leaving || undefined}
      data-preview={preview || undefined}
      onPointerEnter={() => setHover(true)}
      onPointerLeave={() => setHover(false)}
    >
      <span className={styles.stripIcon} aria-hidden='true'>
        <Icon name={important ? 'alert' : 'megaphone'} size={18} weight={1.9} />
      </span>
      <div className={styles.stripText}>
        <span className={styles.stripHead}>
          <strong className={styles.stripTitle}>
            {entry.subject ?? t('announcement.untitled')}
          </strong>
          {position && (
            <span className={styles.position}>
              {t('announcement.position', {
                index: position.index,
                total: position.total,
              })}
            </span>
          )}
          {preview && <Chip tone='preview'>{t('preview.chip')}</Chip>}
        </span>
        {text && <span className={styles.stripBody}>{text}</span>}
      </div>
      {hasMore(entry) && (
        <button type='button' className={styles.cardLink} onClick={onOpen}>
          {t('announcement.readMore')}
        </button>
      )}
      <CloseButton
        label={
          preview ? t('preview.closePreview') : t('announcement.dismissLabel')
        }
        onClick={onClose}
      />
    </div>
  );
}

/** A notification that has just arrived (or the in-app preview of one). */
function InboxToast({
  entry,
  preview,
  durationMs,
  onOpen,
  onClose,
}: {
  entry: InboxEntry;
  preview: boolean;
  durationMs: number;
  onOpen: () => void;
  onClose: () => void;
}) {
  const { t, describeItem } = useNotificationsContext();
  const [hover, setHover] = useState(false);
  const { leaving, leave } = useLeaving();
  const out = () => leave(entry.id, onClose);
  useTimeout(preview ? 0 : durationMs, out, hover);
  const title =
    entry.subject ?? describeItem(entry)?.title ?? t('inbox.untitled');
  const text = plainText(entry);

  return (
    <div
      className={styles.inboxToast}
      role='status'
      data-leaving={leaving.has(entry.id) || undefined}
      data-preview={preview || undefined}
      onPointerEnter={() => setHover(true)}
      onPointerLeave={() => setHover(false)}
    >
      <span className={styles.toastIcon} aria-hidden='true'>
        <Icon name='bell' size={18} weight={1.8} />
      </span>
      <div className={styles.cardInner}>
        <span className={styles.cardMeta}>
          <span className={styles.cardMetaText}>
            {t('toast.newNotification')}
            {!preview && ` · ${t('time.justNow')}`}
          </span>
          {entry.priority === 'HIGH' && (
            <Chip tone='danger'>{t('priority.HIGH')}</Chip>
          )}
          {preview && <Chip tone='preview'>{t('preview.chip')}</Chip>}
        </span>
        <span className={styles.cardTitle}>{title}</span>
        {text && <span className={styles.cardBody}>{text}</span>}
        <button type='button' className={styles.cardLink} onClick={onOpen}>
          {t('toast.open')}
        </button>
      </div>
      <CloseButton
        label={preview ? t('preview.closePreview') : t('toast.close')}
        onClick={out}
      />
    </div>
  );
}

// ---------------------------------------------------------------- dialogs

/**
 * A blocking announcement in the middle of the window, over a slightly
 * blurred page: the only way out is the acknowledgement.
 */
function AnnouncementModal({
  entry,
  preview,
  position,
  onAcknowledge,
}: {
  entry: AnnouncementEntry;
  preview: boolean;
  position: Position | null;
  onAcknowledge: () => void;
}) {
  const { t, locale } = useNotificationsContext();
  const titleId = useDomId('nk-modal');
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(true);
  const title = entry.subject ?? t('announcement.untitled');
  const now = Date.now();
  const time = formatCardTime(entry.publishedAt, now, locale);
  const until = formatDay(entry.visibleUntil, now, locale);

  return (
    <Dialog
      open={open}
      role='alertdialog'
      labelledBy={titleId}
      width={520}
      backdrop='blur'
      initialFocus={buttonRef}
      className={styles.notice}
    >
      {(preview || position) && (
        <div className={styles.noticeTop}>
          {preview && <Chip tone='preview'>{t('preview.chip')}</Chip>}
          {position && (
            <span className={styles.position}>
              {t('announcement.position', {
                index: position.index,
                total: position.total,
              })}
            </span>
          )}
        </div>
      )}
      <h2 id={titleId} className={styles.noticeTitle}>
        {title}
      </h2>
      <MessageBody
        source={entry}
        title={title}
        className={styles.noticeBody}
        onFollow={() => {
          // Following a link in it counts as reading it.
          setOpen(false);
          window.setTimeout(onAcknowledge, 200);
        }}
      />
      <div className={styles.noticeFoot}>
        <span className={styles.noticeMeta}>
          {[time, until && t('feed.until', { date: until })]
            .filter(Boolean)
            .join(' · ')}
        </span>
        <Button
          ref={buttonRef}
          variant='primary'
          size='lg'
          onClick={() => {
            setOpen(false);
            window.setTimeout(onAcknowledge, 200);
          }}
        >
          {t('announcement.acknowledge')}
        </Button>
      </div>
    </Dialog>
  );
}

/** The full text of a card: "Read more", or "Open" on a notification. */
function ReaderDialog({
  open,
  title,
  meta,
  source,
  preview,
  onClose,
  extraAction,
}: {
  open: boolean;
  title: string;
  meta: string | null;
  source: InboxEntry | AnnouncementEntry | null;
  preview: boolean;
  onClose: () => void;
  extraAction?: { label: string; run: () => void };
}) {
  const { t } = useNotificationsContext();
  const titleId = useDomId('nk-reader');
  return (
    <Dialog open={open} onClose={onClose} labelledBy={titleId} width={600}>
      <div className={styles.dialogHead}>
        <div className={styles.dialogHeadRow}>
          <span className={styles.cardMeta}>
            <span className={styles.cardMetaText}>{meta}</span>
            {preview && <Chip tone='preview'>{t('preview.chip')}</Chip>}
          </span>
          <CloseButton large label={t('reader.close')} onClick={onClose} />
        </div>
        <h2 id={titleId} className={styles.dialogTitle}>
          {title}
        </h2>
      </div>
      {source && (
        <MessageBody
          source={source}
          title={title}
          className={styles.dialogBody}
          onFollow={onClose}
        />
      )}
      <div className={styles.dialogActions}>
        {extraAction && (
          <Button onClick={extraAction.run}>{extraAction.label}</Button>
        )}
        <Button variant='primary' onClick={onClose}>
          {t('reader.close')}
        </Button>
      </div>
    </Dialog>
  );
}

// ------------------------------------------------------------ new in inbox

/**
 * Cards for notifications that arrive while the page is open. The service
 * has no push channel: a rise of the polled unread counter is the signal,
 * then the newest unread rows are read once.
 */
function useArrivals(enabled: boolean) {
  const { api, onError, enabled: kitEnabled } = useNotificationsContext();
  const client = useQueryClient();
  const { data: unread } = useUnreadCount();
  const previous = useRef<number | undefined>(undefined);
  const since = useRef(Date.now());
  const shown = useRef(new Set<string>());
  const [arrivals, setArrivals] = useState<InboxEntry[]>([]);

  useEffect(() => {
    const before = previous.current;
    previous.current = unread;
    if (!enabled || !kitEnabled) return;
    if (unread === undefined || before === undefined || unread <= before) {
      return;
    }
    // The lists on the page are stale now too.
    void client.invalidateQueries({ queryKey: notificationKeys.inboxLists() });
    let cancelled = false;
    void (async () => {
      const page = await api.inbox.list({
        filter: odata.isNull('readAt'),
        top: 3,
      });
      const fresh = page.items.filter(entry => {
        if (shown.current.has(entry.id)) return false;
        const created = entry.createdAt ? Date.parse(entry.createdAt) : NaN;
        return !Number.isNaN(created) && created >= since.current - 60_000;
      });
      fresh.forEach(entry => shown.current.add(entry.id));
      const newest = fresh[0];
      if (!newest || cancelled) return;
      const full = await client.fetchQuery({
        queryKey: notificationKeys.inboxItem(newest.id),
        queryFn: ({ signal }) => api.inbox.get(newest.id, { signal }),
        staleTime: Infinity,
      });
      if (!cancelled) {
        setArrivals(current =>
          [full, ...current.filter(e => e.id !== full.id)].slice(0, 2)
        );
      }
    })().catch(onError);
    return () => {
      cancelled = true;
    };
  }, [unread, enabled, kitEnabled, api, client, onError]);

  const remove = useCallback(
    (id: string) => setArrivals(current => current.filter(e => e.id !== id)),
    []
  );
  return { arrivals, remove };
}

// -------------------------------------------------------------------- host

type Reading =
  | { kind: 'announcement'; entry: AnnouncementEntry; preview: boolean }
  | { kind: 'inbox'; entry: InboxEntry; preview: boolean };

/** Runs `then` once, `ms` after `when` turns true. */
function useAfter(when: boolean, ms: number, then: () => void) {
  const callback = useRef(then);
  callback.current = then;
  useEffect(() => {
    if (!when) return;
    const timer = window.setTimeout(() => callback.current(), ms);
    return () => window.clearTimeout(timer);
  }, [when, ms]);
}

/**
 * Shows the caller's outstanding announcements over the page, one after
 * another, the most important first: dialogs in the middle (TRANSACTIONAL
 * by default), then strips at the top centre (PLATFORM), then the deck in
 * the top-right corner (MARKETING). Also a card for each notification that
 * arrives, and whatever the administration forms are previewing. Mount it
 * once, anywhere under the provider.
 */
export function AnnouncementsHost({
  toastDurationMs = 8000,
  stripDurationMs = 0,
  firstDelayMs = 1500,
  gapMs = 800,
  maxCorner = Infinity,
  showPosition = false,
  inboxToasts = true,
  onOpenItem,
  onOpenAnnouncement,
}: AnnouncementsHostProps) {
  const { resolvePresentation, t, locale, features } =
    useNotificationsContext();
  const { data } = useAnnouncements();
  const dismiss = useDismissAnnouncement();
  const { markRead } = useInboxCommands();
  const [preview, setPreview] = useKitPreview();
  const stripsRef = useRef<HTMLDivElement>(null);
  const cornerRef = useRef<HTMLDivElement>(null);
  const [stripsOffset, setStripsOffset] = useState(0);
  const offsetRef = useRef(0);
  const [bandHeight, setBandHeight] = useState(0);
  const stripMotion = useLeaving();

  // Strips at the top centre and cards at the top right share the top
  // edge; where they would overlap (a narrower window) the cards go under.
  // The blurred band behind a strip reaches just past its bottom edge.
  useEffect(() => {
    const strips = stripsRef.current;
    if (!strips || typeof ResizeObserver === 'undefined') {
      offsetRef.current = 0;
      setStripsOffset(0);
      setBandHeight(0);
      return;
    }
    const measure = () => {
      const a = strips.getBoundingClientRect();
      const b = cornerRef.current?.getBoundingClientRect();
      setBandHeight(a.height > 0 ? Math.round(a.bottom + 20) : 0);
      // Where the corner would sit without the offset.
      const cornerTop = b ? b.top - offsetRef.current : 0;
      const next =
        b && a.height > 0 && a.right > b.left && a.bottom + 8 > cornerTop
          ? Math.round(a.bottom + 8 - cornerTop)
          : 0;
      offsetRef.current = next;
      setStripsOffset(next);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(strips);
    window.addEventListener('resize', measure);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
    };
  });
  const { arrivals, remove } = useArrivals(inboxToasts && features.inbox);
  const [reading, setReading] = useState<Reading | null>(null);
  const [readerOpen, setReaderOpen] = useState(false);
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

  // ---- the queue
  // The first announcement waits for the page to settle; after one closes
  // the next waits a moment, so they read as one after another.
  const loaded = data !== undefined;
  const [ready, setReady] = useState(false);
  useAfter(loaded && !ready, firstDelayMs, () => setReady(true));
  const [resting, setResting] = useState(false);
  useAfter(resting, gapMs, () => setResting(false));
  const free = ready && !resting;

  const entries = data?.items;
  const queue = useMemo(
    () =>
      queueAnnouncements(features.banners ? (entries ?? []) : [], {
        resolve: resolvePresentation,
        hidden,
        now: Date.now(),
      }),
    [entries, features.banners, resolvePresentation, hidden]
  );

  // Closed in this run, for "2 of 3"; a run ends when its queue empties.
  const [closedModals, setClosedModals] = useState(0);
  const [closedStrips, setClosedStrips] = useState(0);
  useEffect(() => {
    if (queue.modal.length === 0) setClosedModals(0);
    if (queue.toast.length === 0) setClosedStrips(0);
  }, [queue.modal.length, queue.toast.length]);

  // What is on screen stays on screen; the queue decides what comes next.
  const [stripId, setStripId] = useState<string | null>(null);
  const [deckOn, setDeckOn] = useState(false);

  const modal = free ? (queue.modal[0] ?? null) : null;
  const shownStrip = stripId
    ? (queue.toast.find(entry => entry.id === stripId) ?? null)
    : null;
  const strip =
    shownStrip ??
    (free && queue.modal.length === 0 ? (queue.toast[0] ?? null) : null);
  const deckVisible =
    queue.corner.length > 0 &&
    (deckOn || (free && queue.modal.length === 0 && queue.toast.length === 0));

  useEffect(() => {
    setStripId(strip?.id ?? null);
  }, [strip?.id]);
  useEffect(() => {
    if (deckVisible) setDeckOn(true);
    else if (queue.corner.length === 0) setDeckOn(false);
  }, [deckVisible, queue.corner.length]);

  // ---- the preview of the administration forms skips the queue
  const announcementPreview = preview?.kind === 'announcement' ? preview : null;
  const previewAt = announcementPreview?.presentation ?? null;
  const shownModal =
    previewAt === 'modal' ? (announcementPreview?.entry ?? null) : modal;
  const shownStripEntry =
    previewAt === 'toast' ? (announcementPreview?.entry ?? null) : strip;
  const corner = [
    ...(previewAt === 'corner' && announcementPreview
      ? [announcementPreview.entry]
      : []),
    ...(deckVisible ? queue.corner : []),
  ].slice(0, maxCorner);

  const openReader = (next: Reading) => {
    setReading(next);
    setReaderOpen(true);
  };

  const openAnnouncement = (entry: AnnouncementEntry) => {
    const isPreview = entry.id === PREVIEW_ID;
    if (onOpenAnnouncement && !isPreview) onOpenAnnouncement(entry);
    else openReader({ kind: 'announcement', entry, preview: isPreview });
  };

  const closeStrip = (entry: AnnouncementEntry, how: 'close' | 'timeout') =>
    stripMotion.leave(
      entry.id,
      () => {
        if (entry.id === PREVIEW_ID) {
          setPreview(null);
          return;
        }
        setResting(true);
        if (how === 'timeout') {
          hide(entry.id);
          return;
        }
        setClosedStrips(count => count + 1);
        dismissNow(entry.id);
      },
      0,
      STRIP_LEAVE_MS
    );

  const inboxPreview = preview?.kind === 'inbox' ? preview.entry : null;
  const toasts: Array<{ entry: InboxEntry; preview: boolean }> = [
    ...(inboxPreview ? [{ entry: inboxPreview, preview: true }] : []),
    ...arrivals.map(entry => ({ entry, preview: false })),
  ];

  if (typeof document === 'undefined') return null;

  const frameStyle = {
    '--nk-strips-offset': `${stripsOffset}px`,
    '--nk-band-height': `${bandHeight}px`,
  } as CSSProperties;
  const readingTitle = reading
    ? (reading.entry.subject ??
      t(reading.kind === 'inbox' ? 'inbox.untitled' : 'announcement.untitled'))
    : '';
  const readingMeta = reading
    ? reading.kind === 'inbox'
      ? formatCardTime(reading.entry.createdAt, Date.now(), locale)
      : formatDay(reading.entry.visibleUntil, Date.now(), locale)
        ? t('feed.until', {
            date: formatDay(
              reading.entry.visibleUntil,
              Date.now(),
              locale
            ) as string,
          })
        : formatCardTime(reading.entry.publishedAt, Date.now(), locale)
    : null;

  const closeReader = () => setReaderOpen(false);
  const stripLeaving = shownStripEntry
    ? stripMotion.leaving.has(shownStripEntry.id)
    : false;

  return createPortal(
    <>
      <div className={cx(styles.root, styles.dock)} style={frameStyle}>
        {shownStripEntry && (
          <div
            key={`band-${shownStripEntry.id}`}
            className={styles.band}
            data-leaving={stripLeaving || undefined}
            aria-hidden='true'
          />
        )}
        {shownStripEntry && (
          <div ref={stripsRef} className={styles.dockTop} aria-live='polite'>
            <Strip
              key={shownStripEntry.id}
              entry={shownStripEntry}
              preview={shownStripEntry.id === PREVIEW_ID}
              position={
                shownStripEntry.id === PREVIEW_ID || !showPosition
                  ? null
                  : positionOf(closedStrips, queue.toast.length)
              }
              leaving={stripLeaving}
              durationMs={stripDurationMs}
              onTimeout={() => closeStrip(shownStripEntry, 'timeout')}
              onClose={() => closeStrip(shownStripEntry, 'close')}
              onOpen={() => openAnnouncement(shownStripEntry)}
            />
          </div>
        )}
        {(toasts.length > 0 || corner.length > 0) && (
          <div
            ref={cornerRef}
            className={styles.dockCorner}
            role='region'
            aria-label={t('announcement.region')}
          >
            {toasts.map(({ entry, preview: isPreview }) => (
              <InboxToast
                key={entry.id}
                entry={entry}
                preview={isPreview}
                durationMs={toastDurationMs}
                onClose={() =>
                  isPreview ? setPreview(null) : remove(entry.id)
                }
                onOpen={() => {
                  if (!isPreview && onOpenItem) {
                    remove(entry.id);
                    onOpenItem(entry);
                    return;
                  }
                  if (!isPreview && !entry.read) markRead.mutate(entry.id);
                  openReader({ kind: 'inbox', entry, preview: isPreview });
                }}
              />
            ))}
            {corner.length > 0 && (
              <CornerDeck
                entries={corner}
                previewId={previewAt === 'corner' ? PREVIEW_ID : null}
                onDismiss={dismissNow}
                onOpen={openAnnouncement}
                onClosePreview={() => setPreview(null)}
              />
            )}
          </div>
        )}
      </div>
      {shownModal && (
        <AnnouncementModal
          key={shownModal.id}
          entry={shownModal}
          preview={shownModal.id === PREVIEW_ID}
          position={
            shownModal.id === PREVIEW_ID || !showPosition
              ? null
              : positionOf(closedModals, queue.modal.length)
          }
          onAcknowledge={() => {
            const id = shownModal.id;
            if (id === PREVIEW_ID) {
              setPreview(null);
              return;
            }
            setResting(true);
            setClosedModals(count => count + 1);
            dismissNow(id);
          }}
        />
      )}
      <ReaderDialog
        open={readerOpen}
        title={readingTitle}
        meta={readingMeta}
        source={reading?.entry ?? null}
        preview={reading?.preview ?? false}
        onClose={closeReader}
        extraAction={
          reading?.kind === 'announcement' && !reading.preview
            ? {
                label: t('announcement.dismissForever'),
                run: () => {
                  closeReader();
                  dismissNow(reading.entry.id);
                },
              }
            : undefined
        }
      />
    </>,
    document.body
  );
}

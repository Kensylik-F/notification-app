import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, RefObject } from 'react';
import { createPortal } from 'react-dom';

import { notificationKeys, odata } from '../core';
import type { AnnouncementEntry, InboxEntry } from '../core';
import { MessageBody, hasMore, plainText } from './content';
import { useNotificationsContext } from './context';
import { DEFAULT_ANCHOR_SELECTOR, useDock } from './dock';
import { formatCardTime, formatDay } from './format';
import {
  useAnnouncements,
  useDismissAnnouncement,
  useInboxCommands,
  useUnreadCount,
} from './hooks';
import { useFlip, useLeaving } from './motion';
import { planAnnouncements } from './presentation';
import type { AnnouncementPresentation } from './presentation';
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
  /**
   * The page's work area - the overlays dock to its corners instead of the
   * window's, so they never cover the header or a side panel. Without it
   * the element with `data-notifications-anchor` is used, and without that
   * the window.
   */
  anchorRef?: RefObject<Element | null>;
  /** Where to look for the anchor. Default: `[data-notifications-anchor]`. */
  anchorSelector?: string;
  /** How long a strip at the top and a new-notification card stay.
   *  Default: 8000. */
  toastDurationMs?: number;
  /**
   * What the end of that time means for an announcement strip.
   * `'hide-for-session'` only takes it off the screen until the browser tab
   * is closed: the service still counts it outstanding. `'dismiss'` tells
   * the service the caller has dealt with it. Default: `'hide-for-session'`.
   */
  toastOnTimeout?: 'hide-for-session' | 'dismiss';
  /** Cards in the stack. Default: 5. */
  maxCorner?: number;
  /** Strips on screen at once. Default: 2. */
  maxToasts?: number;
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

/** An announcement shown as a strip under the top edge of the work area. */
function Strip({
  entry,
  preview,
  durationMs,
  onTimeout,
  onClose,
  onOpen,
}: {
  entry: AnnouncementEntry;
  preview: boolean;
  durationMs: number;
  onTimeout: () => void;
  onClose: () => void;
  onOpen: () => void;
}) {
  const { t } = useNotificationsContext();
  const [hover, setHover] = useState(false);
  const { leaving, leave } = useLeaving();
  const out = (done: () => void) => leave(entry.id, done);
  useTimeout(preview ? 0 : durationMs, () => out(onTimeout), hover);
  const text = plainText(entry);

  return (
    <div
      className={styles.strip}
      role='status'
      data-leaving={leaving.has(entry.id) || undefined}
      data-preview={preview || undefined}
      onPointerEnter={() => setHover(true)}
      onPointerLeave={() => setHover(false)}
    >
      <span className={styles.stripDot} aria-hidden='true' />
      <span className={styles.stripText}>
        <strong>{entry.subject ?? t('announcement.untitled')}</strong>
        {text && <span> {text}</span>}
      </span>
      {preview && <Chip tone='preview'>{t('preview.chip')}</Chip>}
      {hasMore(entry) && (
        <button type='button' className={styles.cardLink} onClick={onOpen}>
          {t('announcement.readMore')}
        </button>
      )}
      <CloseButton
        label={
          preview ? t('preview.closePreview') : t('announcement.dismissLabel')
        }
        onClick={() => out(onClose)}
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

/** A blocking announcement: the only way out is the acknowledgement. */
function AnnouncementModal({
  entry,
  preview,
  onAcknowledge,
}: {
  entry: AnnouncementEntry;
  preview: boolean;
  onAcknowledge: () => void;
}) {
  const { t, locale } = useNotificationsContext();
  const titleId = useDomId('nk-modal');
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(true);
  const title = entry.subject ?? t('announcement.untitled');
  const time = formatCardTime(entry.publishedAt, Date.now(), locale);

  return (
    <Dialog
      open={open}
      role='alertdialog'
      labelledBy={titleId}
      width={460}
      initialFocus={buttonRef}
    >
      <div className={styles.dialogHead}>
        <span className={styles.cardMeta}>
          <span className={styles.cardMetaText}>{time}</span>
          {preview && <Chip tone='preview'>{t('preview.chip')}</Chip>}
        </span>
        <h2 id={titleId} className={styles.dialogTitle}>
          {title}
        </h2>
      </div>
      <MessageBody source={entry} title={title} className={styles.dialogBody} />
      <div className={styles.dialogActions}>
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

/**
 * Shows the caller's outstanding announcements - a blocking dialog, a deck
 * of cards in the corner of the work area, or strips at its top, whichever
 * the provider's `resolvePresentation` picks for each - plus a card for each
 * notification that arrives, and whatever the administration forms are
 * previewing. Mount it once, anywhere under the provider.
 */
export function AnnouncementsHost({
  anchorRef,
  anchorSelector = DEFAULT_ANCHOR_SELECTOR,
  toastDurationMs = 8000,
  toastOnTimeout = 'hide-for-session',
  maxCorner = 5,
  maxToasts = 2,
  inboxToasts = true,
  onOpenItem,
  onOpenAnnouncement,
}: AnnouncementsHostProps) {
  const { resolvePresentation, t, locale } = useNotificationsContext();
  const { data } = useAnnouncements();
  const dismiss = useDismissAnnouncement();
  const { markRead } = useInboxCommands();
  const [preview, setPreview] = useKitPreview();
  const dock = useDock(anchorRef, anchorSelector);
  const { arrivals, remove } = useArrivals(inboxToasts);
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

  const announcementPreview = preview?.kind === 'announcement' ? preview : null;
  const entries = data?.items;
  const plan = useMemo(() => {
    const base = planAnnouncements(entries ?? [], {
      resolve: resolvePresentation,
      hidden,
      maxCorner,
      maxToasts,
      now: Date.now(),
    });
    if (!announcementPreview) return base;
    // The previewed announcement takes the place a real one would.
    const entry = announcementPreview.entry;
    const where: AnnouncementPresentation = announcementPreview.presentation;
    return {
      modal: where === 'modal' ? entry : base.modal,
      corner:
        where === 'corner'
          ? [entry, ...base.corner].slice(0, maxCorner)
          : base.corner,
      toasts:
        where === 'toast'
          ? [entry, ...base.toasts].slice(0, maxToasts)
          : base.toasts,
    };
  }, [
    entries,
    resolvePresentation,
    hidden,
    maxCorner,
    maxToasts,
    announcementPreview,
  ]);

  const openReader = (next: Reading) => {
    setReading(next);
    setReaderOpen(true);
  };

  const openAnnouncement = (entry: AnnouncementEntry) => {
    const isPreview = entry.id === PREVIEW_ID;
    if (onOpenAnnouncement && !isPreview) onOpenAnnouncement(entry);
    else openReader({ kind: 'announcement', entry, preview: isPreview });
  };

  const inboxPreview = preview?.kind === 'inbox' ? preview.entry : null;
  const toasts: Array<{ entry: InboxEntry; preview: boolean }> = [
    ...(inboxPreview ? [{ entry: inboxPreview, preview: true }] : []),
    ...arrivals.map(entry => ({ entry, preview: false })),
  ];

  if (typeof document === 'undefined' || !dock) return null;

  const narrow = dock.width < 440;
  const dockStyle = {
    top: dock.top,
    left: dock.left,
    width: dock.width,
    height: dock.height,
    '--nk-dock-height': `${dock.height - dock.bottomInset}px`,
    '--nk-dock-inset': `${dock.bottomInset}px`,
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

  return createPortal(
    <>
      <div
        className={cx(styles.root, styles.dock)}
        style={dockStyle}
        data-narrow={narrow || undefined}
      >
        {plan.toasts.length > 0 && (
          <div className={styles.dockTop} aria-live='polite'>
            {plan.toasts.map(entry => {
              const isPreview = entry.id === PREVIEW_ID;
              return (
                <Strip
                  key={entry.id}
                  entry={entry}
                  preview={isPreview}
                  durationMs={toastDurationMs}
                  onTimeout={() =>
                    toastOnTimeout === 'dismiss'
                      ? dismissNow(entry.id)
                      : hide(entry.id)
                  }
                  onClose={() =>
                    isPreview ? setPreview(null) : dismissNow(entry.id)
                  }
                  onOpen={() => openAnnouncement(entry)}
                />
              );
            })}
          </div>
        )}
        {(toasts.length > 0 || plan.corner.length > 0) && (
          <div
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
            {plan.corner.length > 0 && (
              <CornerDeck
                entries={plan.corner}
                previewId={announcementPreview ? PREVIEW_ID : null}
                onDismiss={dismissNow}
                onOpen={openAnnouncement}
                onClosePreview={() => setPreview(null)}
              />
            )}
          </div>
        )}
      </div>
      {plan.modal && (
        <AnnouncementModal
          key={plan.modal.id}
          entry={plan.modal}
          preview={plan.modal.id === PREVIEW_ID}
          onAcknowledge={() => {
            const id = (plan.modal as AnnouncementEntry).id;
            if (id === PREVIEW_ID) setPreview(null);
            else dismissNow(id);
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

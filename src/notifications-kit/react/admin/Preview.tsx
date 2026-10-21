/**
 * "Preview" of the administration forms. The service renders the message
 * (`POST /notifications/preview`, the renderer a send uses) and the kit
 * plays the result out: a notification pops up on this page and lands in
 * the bell, an announcement takes its place among the overlays, an email
 * and a chat message open in a window. Nothing is sent.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';

import { TEMPLATE_KEY_PATTERN, contentToTemplate } from '../../core';
import type {
  AnnouncementEntry,
  Channel,
  InboxEntry,
  MessageContent,
  RecipientDraft,
  RenderPreviewRequest,
  RenderPreviewResponse,
} from '../../core';
import { useNotificationsContext } from '../context';
import { PREVIEW_ID, useKitPreview } from '../preview';
import {
  Button,
  CloseButton,
  Dialog,
  HtmlFrame,
  Icon,
  Spinner,
  Tabs,
  cx,
  useDomId,
} from '../primitives';
import type { IconName } from '../primitives';
import styles from './admin.module.css';
import { ErrorNotice } from './errors';
import { Segmented } from './forms';

/** Channels that have something to show. A webhook's payload is the
 *  receiver's business and has no picture. */
export type PreviewChannel = 'IN_APP' | 'EMAIL' | 'CHAT';
export const PREVIEW_CHANNELS: readonly PreviewChannel[] = [
  'IN_APP',
  'EMAIL',
  'CHAT',
];

export const CHANNEL_ICON: Record<Channel, IconName> = {
  IN_APP: 'bell',
  EMAIL: 'mail',
  CHAT: 'chat',
  WEBHOOK: 'link',
};

const previewKey = (request: RenderPreviewRequest) =>
  ['notifications-kit', 'preview', JSON.stringify(request)] as const;

/** The request the service renders for `channel`, or `null` when the form
 *  has nothing renderable yet. */
export function usePreviewRequest(
  content: MessageContent,
  previewLocale?: string
) {
  const { admin, locale } = useNotificationsContext();
  return (channel: Channel): RenderPreviewRequest | null => {
    const { templateKey, variables } = contentToTemplate(
      content,
      admin.freeformTemplateKey
    );
    if (!TEMPLATE_KEY_PATTERN.test(templateKey)) return null;
    return {
      templateKey,
      channel,
      locale: previewLocale ?? locale.slice(0, 2).toLowerCase(),
      variables,
    };
  };
}

/** Fetches one rendering, with the cache the dialog uses too. */
export function useFetchPreview() {
  const { api } = useNotificationsContext();
  const client = useQueryClient();
  return (request: RenderPreviewRequest) =>
    client.fetchQuery({
      queryKey: previewKey(request),
      queryFn: () => api.requests.preview(request),
      staleTime: 60_000,
      retry: false,
    });
}

function usePreviewQuery(request: RenderPreviewRequest | null) {
  const { api } = useNotificationsContext();
  return useQuery({
    queryKey: request ? previewKey(request) : ['notifications-kit', 'none'],
    queryFn: () => api.requests.preview(request as RenderPreviewRequest),
    enabled: request !== null,
    staleTime: 60_000,
    retry: false,
  });
}

// ------------------------------------------------------------ stand-ins

export function previewInboxEntry(
  result: RenderPreviewResponse,
  extra: Partial<InboxEntry> = {}
): InboxEntry {
  const now = new Date().toISOString();
  return {
    id: PREVIEW_ID,
    templateKey: result.templateKey ?? null,
    category: null,
    categoryClass: null,
    priority: null,
    locale: result.resolvedLocale ?? null,
    subject: result.subject ?? null,
    bodyText: result.textBody ?? null,
    bodyHtml: result.htmlBody ?? null,
    createdAt: now,
    seenAt: null,
    readAt: null,
    dismissedAt: null,
    seen: false,
    read: false,
    dismissed: false,
    ...extra,
  };
}

export function previewAnnouncementEntry(
  result: RenderPreviewResponse,
  extra: Partial<AnnouncementEntry> = {}
): AnnouncementEntry {
  return {
    id: PREVIEW_ID,
    category: null,
    categoryClass: null,
    locale: result.resolvedLocale ?? null,
    subject: result.subject ?? null,
    bodyText: result.textBody ?? null,
    bodyHtml: result.htmlBody ?? null,
    publishedAt: new Date().toISOString(),
    visibleFrom: null,
    visibleUntil: null,
    dismissed: false,
    ...extra,
  };
}

/** Takes the page's preview down when the form that put it there goes. */
export function useClearPreviewOnLeave() {
  const [, setPreview] = useKitPreview();
  const ref = useRef(setPreview);
  ref.current = setPreview;
  useEffect(() => () => ref.current(null), []);
}

// ------------------------------------------------------------ the button

/**
 * "Preview" with a menu of the chosen channels; with a single channel the
 * button runs it straight away.
 */
export function PreviewButton({
  channels,
  busy,
  disabledReason,
  onPick,
}: {
  channels: readonly PreviewChannel[];
  busy?: boolean;
  /** Why it cannot run (shown as the button's title). */
  disabledReason?: string;
  onPick: (channel: PreviewChannel) => void;
}) {
  const { t } = useNotificationsContext();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuId = useDomId('nk-preview-menu');
  const single = channels.length === 1;
  const disabled = Boolean(disabledReason) || channels.length === 0;

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={rootRef} className={styles.previewAnchor}>
      {open && !single && (
        <div id={menuId} className={styles.previewMenu} role='menu'>
          <div className={styles.previewMenuTitle}>{t('preview.menu')}</div>
          {channels.map(channel => (
            <button
              key={channel}
              type='button'
              role='menuitem'
              className={styles.previewItem}
              onClick={() => {
                setOpen(false);
                onPick(channel);
              }}
            >
              <span className={styles.previewItemIcon}>
                <Icon name={CHANNEL_ICON[channel]} size={20} />
              </span>
              <span>
                <span className={styles.previewItemTitle}>
                  {t(`preview.as.${channel}`)}
                </span>
                <span className={styles.previewItemNote}>
                  {t(`preview.as.${channel}.note`)}
                </span>
              </span>
            </button>
          ))}
        </div>
      )}
      <Button
        size='lg'
        icon='eye'
        iconEnd={single || disabled ? undefined : 'chevronUp'}
        disabled={disabled || busy}
        title={disabledReason}
        aria-haspopup={single ? undefined : 'menu'}
        aria-expanded={single ? undefined : open}
        aria-controls={open ? menuId : undefined}
        onClick={() => {
          const first = channels[0];
          if (single && first) onPick(first);
          else setOpen(v => !v);
        }}
      >
        {busy ? t('item.loading') : t('preview.title')}
      </Button>
    </div>
  );
}

/** The yellow line at the top of a form while its preview is on the page. */
export function PreviewStrip({
  children,
  onExit,
}: {
  children: ReactNode;
  onExit: () => void;
}) {
  const { t } = useNotificationsContext();
  return (
    <div className={styles.previewStrip} role='status'>
      <Icon name='eye' size={18} />
      <span className={styles.previewStripText}>{children}</span>
      <Button size='sm' onClick={onExit}>
        {t('preview.exit')}
      </Button>
    </div>
  );
}

// ------------------------------------------------------------ the window

/**
 * The email and chat previews: the message in a frame that looks like the
 * place it will be read. The "In the cabinet" tab hands over to `onInApp`,
 * which plays the notification out on the page itself.
 */
export function PreviewDialog({
  open,
  channel,
  channels,
  content,
  recipients,
  onChannelChange,
  onInApp,
  onClose,
}: {
  open: boolean;
  channel: PreviewChannel;
  channels: readonly PreviewChannel[];
  content: MessageContent;
  recipients: readonly RecipientDraft[];
  onChannelChange: (channel: PreviewChannel) => void;
  onInApp: () => void;
  onClose: () => void;
}) {
  const { t } = useNotificationsContext();
  const titleId = useDomId('nk-preview');
  const requestFor = usePreviewRequest(content);
  const request = open && channel !== 'IN_APP' ? requestFor(channel) : null;
  const query = usePreviewQuery(request);
  const first = recipients[0];
  const who = first
    ? recipients.length > 1
      ? t('preview.who.many', {
          name: first.label,
          count: recipients.length - 1,
        })
      : t('preview.who.one', { name: first.label })
    : t('preview.who.none');

  return (
    <Dialog open={open} onClose={onClose} labelledBy={titleId} width={860}>
      <div className={styles.previewHead}>
        <div>
          <h2 id={titleId} className={styles.previewTitle}>
            {t('preview.title')}
          </h2>
          <p className={styles.muted}>{t('preview.subtitle', { who })}</p>
        </div>
        <CloseButton large label={t('preview.close')} onClick={onClose} />
      </div>
      <Tabs
        value={channel}
        label={t('preview.title')}
        items={channels.map(c => ({ value: c, label: t(`preview.tab.${c}`) }))}
        onChange={next =>
          next === 'IN_APP' ? onInApp() : onChannelChange(next)
        }
      />
      <div className={styles.previewStage} key={channel}>
        {query.isPending ? (
          <div className={styles.previewLoading}>
            <Spinner label={t('item.loading')} />
          </div>
        ) : query.isError ? (
          <ErrorNotice error={query.error} t={t} />
        ) : channel === 'EMAIL' ? (
          <EmailView result={query.data} recipients={recipients} />
        ) : (
          <ChatView result={query.data} />
        )}
      </div>
      <div className={styles.previewFoot}>
        <span className={styles.muted}>
          {channel === 'EMAIL'
            ? t('preview.email.note')
            : t('preview.chat.note')}
        </span>
        <Button onClick={onClose}>{t('preview.close')}</Button>
      </div>
    </Dialog>
  );
}

function EmailView({
  result,
  recipients,
}: {
  result: RenderPreviewResponse;
  recipients: readonly RecipientDraft[];
}) {
  const { t } = useNotificationsContext();
  const hasHtml = Boolean(result.htmlBody);
  const [part, setPart] = useState<'html' | 'text'>(hasHtml ? 'html' : 'text');
  const first = recipients[0];
  return (
    <div className={styles.mail}>
      <div className={styles.mailHead}>
        <div className={styles.mailSubjectRow}>
          <span className={styles.mailSubject}>
            {result.subject || t('preview.noSubject')}
          </span>
          {hasHtml && result.textBody && (
            <Segmented
              name='nk-mail-part'
              label={t('preview.email.part')}
              value={part}
              options={[
                { value: 'html', label: 'HTML' },
                { value: 'text', label: t('preview.email.text') },
              ]}
              onChange={setPart}
            />
          )}
        </div>
        <div className={styles.mailLine}>
          <span>{t('preview.email.from')}</span>
          <span className={styles.muted}>{t('preview.email.fromService')}</span>
        </div>
        <div className={styles.mailLine}>
          <span>{t('preview.email.to')}</span>
          <span>
            {first ? first.label : t('preview.who.none')}
            {recipients.length > 1 && (
              <span className={styles.muted}>
                {' · '}
                {t('preview.email.more', { count: recipients.length - 1 })}
              </span>
            )}
          </span>
        </div>
      </div>
      <div className={styles.mailCanvas}>
        <div className={styles.letter}>
          {part === 'html' && result.htmlBody ? (
            <HtmlFrame html={result.htmlBody} title={result.subject ?? ''} />
          ) : (
            <pre className={styles.letterText}>
              {result.textBody || t('item.noBody')}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
}

function ChatView({ result }: { result: RenderPreviewResponse }) {
  const { t, locale } = useNotificationsContext();
  const sender = t('preview.chat.sender');
  const initials = sender
    .split(/\s+/)
    .map(word => word[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
  const time = new Intl.DateTimeFormat(locale, {
    hour: '2-digit',
    minute: '2-digit',
  }).format(Date.now());
  // The chat channel sends the rich part as the message body (plain text or
  // markdown, per the service), the subject as its title.
  const text = result.htmlBody || result.textBody;
  return (
    <div className={styles.chatCanvas}>
      <div className={styles.chat}>
        <div className={styles.chatHead}>
          <span className={styles.chatAvatar} aria-hidden='true'>
            {initials}
          </span>
          <div>
            <div className={styles.chatName}>{sender}</div>
            <div className={styles.muted}>{t('preview.chat.botNote')}</div>
          </div>
        </div>
        <div className={styles.chatBody}>
          <span className={styles.chatDay}>{t('preview.chat.today')}</span>
          <div className={cx(styles.bubble)}>
            {result.subject && (
              <div className={styles.bubbleTitle}>{result.subject}</div>
            )}
            <div className={styles.bubbleText}>{text || t('item.noBody')}</div>
            <div className={styles.bubbleTime}>{time}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

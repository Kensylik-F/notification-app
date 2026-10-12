import { createContext, useContext, useMemo } from 'react';
import type { ReactNode } from 'react';

import type {
  AnnouncementEntry,
  InboxEntry,
  NotificationsApi,
  RecipientDraft,
  SendCategoryClass,
} from '../core';
import { DEFAULT_MAX_VISIBILITY_DAYS } from '../core';
import { createTranslate } from './messages';
import type { Messages, Translate } from './messages';
import { defaultPresentation } from './presentation';
import type { PresentationResolver } from './presentation';

export interface PollingOptions {
  /** How often the unread badge is refreshed. The service has no push
   *  channel, so the badge is polled. Default: 60 000. */
  unreadCountMs?: number;
  /** How often the announcement feed is refreshed. Default: 300 000. */
  announcementsMs?: number;
}

export interface ItemDescription {
  title: string;
  hint?: string;
}

/** A category the host offers in the administration forms. The service keeps
 *  its catalogue in configuration and publishes no list of it. */
export interface AdminCategory {
  code: string;
  label: string;
  /** Preselected class when the category is picked for a send. */
  categoryClass?: SendCategoryClass;
  /** Configured as an announcement category in the service. */
  announcement?: boolean;
}

/** A role an announcement can be addressed to (the service's
 *  `targetable-roles`). */
export interface AdminRole {
  code: string;
  label: string;
}

/**
 * What the signed-in person may do. The service checks every call itself
 * and answers 403 otherwise; these flags only keep the interface from
 * offering what would be refused.
 */
export interface NotificationPermissions {
  /** Submit a notification request (`NOTIFICATION_SENDER` or `_ADMIN`). */
  send: boolean;
  /** Render a template preview (`NOTIFICATION_AUTHOR` or `_ADMIN`). */
  preview: boolean;
  /** Read delivery history and content, cancel an unsent delivery
   *  (`NOTIFICATION_SUPPORT` or `_ADMIN`). */
  deliveries: boolean;
  /** Requeue a dead delivery (`NOTIFICATION_ADMIN`). */
  retryDeliveries: boolean;
  /** Publish and correct announcements, follow and stop their email run
   *  (`NOTIFICATION_ANNOUNCER`). */
  announce: boolean;
}

export interface AdminOptions {
  categories?: readonly AdminCategory[];
  roles?: readonly AdminRole[];
  /** Finds people for the recipient field. Without it recipients are typed
   *  in as a user id or an e-mail address. */
  searchRecipients?: (
    query: string,
    signal: AbortSignal
  ) => Promise<RecipientDraft[]>;
  /** Human names for template keys (the catalogue has keys only). */
  templateLabels?: Readonly<Record<string, string>>;
  /** Human names for template variables, by variable name. */
  variableLabels?: Readonly<Record<string, string>>;
  /** The service's `announcements.max-visibility-window`. Default: 90. */
  maxVisibilityDays?: number;
  /** Default: everything allowed, and the service decides. */
  permissions?: Partial<NotificationPermissions>;
}

export interface ResolvedAdminOptions {
  categories: readonly AdminCategory[];
  roles: readonly AdminRole[];
  searchRecipients: AdminOptions['searchRecipients'];
  templateLabels: Readonly<Record<string, string>>;
  variableLabels: Readonly<Record<string, string>>;
  maxVisibilityDays: number;
  permissions: NotificationPermissions;
}

export interface NotificationsProviderProps {
  /** From `createNotificationsApi`. */
  api: NotificationsApi;
  /** BCP 47 tag for dates and the built-in dictionary. Default: `'ru'`. */
  locale?: string;
  /** Overrides for individual strings of the built-in dictionary. */
  messages?: Partial<Messages>;
  /** Replaces the dictionary lookup altogether (e.g. with i18next). */
  translate?: Translate;
  /**
   * `false` switches every request off - for a signed-out page or a feature
   * flag. Components then render their idle state. Default: `true`.
   */
  enabled?: boolean;
  polling?: PollingOptions;
  /**
   * A list row carries no subject (the service returns it only for a single
   * item). `'fetch'` loads each visible row's subject by id and caches it;
   * `'none'` shows what `describeItem` returns. Default: `'fetch'`.
   */
  subjects?: 'fetch' | 'none';
  /** A label for a row from its `templateKey`/`category`: shown until the
   *  subject arrives, and instead of it when `subjects` is `'none'`. */
  describeItem?: (entry: InboxEntry) => ItemDescription | undefined;
  /** How each announcement is shown. Default: every one as a corner card. */
  resolvePresentation?: PresentationResolver;
  /**
   * Renders a server-produced HTML body. The kit never injects HTML itself:
   * without this prop it shows the plain-text body. Pass the host's
   * sanitising renderer here.
   */
  renderHtml?: (
    html: string,
    source: InboxEntry | AnnouncementEntry
  ) => ReactNode;
  /** Report rather than throw: a failed background command, a contract
   *  mismatch. Wire it to the host's logger. */
  onError?: (error: unknown) => void;
  /** Settings of the administration components (0.2). */
  admin?: AdminOptions;
  children: ReactNode;
}

export interface NotificationsContextValue {
  api: NotificationsApi;
  locale: string;
  t: Translate;
  enabled: boolean;
  polling: Required<PollingOptions>;
  subjects: 'fetch' | 'none';
  describeItem: (entry: InboxEntry) => ItemDescription | undefined;
  resolvePresentation: PresentationResolver;
  renderHtml:
    | ((html: string, source: InboxEntry | AnnouncementEntry) => ReactNode)
    | undefined;
  onError: (error: unknown) => void;
  admin: ResolvedAdminOptions;
}

const NotificationsContext = createContext<NotificationsContextValue | null>(
  null
);

const noDescription = () => undefined;
const ignore = () => undefined;
const NONE: readonly never[] = [];
const NO_LABELS: Readonly<Record<string, string>> = {};

function resolveAdmin(admin: AdminOptions | undefined): ResolvedAdminOptions {
  const p = admin?.permissions ?? {};
  return {
    categories: admin?.categories ?? NONE,
    roles: admin?.roles ?? NONE,
    searchRecipients: admin?.searchRecipients,
    templateLabels: admin?.templateLabels ?? NO_LABELS,
    variableLabels: admin?.variableLabels ?? NO_LABELS,
    maxVisibilityDays: admin?.maxVisibilityDays ?? DEFAULT_MAX_VISIBILITY_DAYS,
    permissions: {
      send: p.send ?? true,
      preview: p.preview ?? true,
      deliveries: p.deliveries ?? true,
      retryDeliveries: p.retryDeliveries ?? true,
      announce: p.announce ?? true,
    },
  };
}

export function NotificationsProvider({
  api,
  locale = 'ru',
  messages,
  translate,
  enabled = true,
  polling,
  subjects = 'fetch',
  describeItem = noDescription,
  resolvePresentation = defaultPresentation,
  renderHtml,
  onError = ignore,
  admin,
  children,
}: NotificationsProviderProps) {
  const resolvedAdmin = useMemo(() => resolveAdmin(admin), [admin]);
  const unreadCountMs = polling?.unreadCountMs ?? 60_000;
  const announcementsMs = polling?.announcementsMs ?? 300_000;

  const value = useMemo<NotificationsContextValue>(
    () => ({
      api,
      locale,
      t: translate ?? createTranslate(locale, messages),
      enabled,
      polling: { unreadCountMs, announcementsMs },
      subjects,
      describeItem,
      resolvePresentation,
      renderHtml,
      onError,
      admin: resolvedAdmin,
    }),
    [
      api,
      locale,
      translate,
      messages,
      enabled,
      unreadCountMs,
      announcementsMs,
      subjects,
      describeItem,
      resolvePresentation,
      renderHtml,
      onError,
      resolvedAdmin,
    ]
  );

  return (
    <NotificationsContext.Provider value={value}>
      {children}
    </NotificationsContext.Provider>
  );
}

export function useNotificationsContext(): NotificationsContextValue {
  const value = useContext(NotificationsContext);
  if (!value) {
    throw new Error(
      'notifications-kit: wrap the tree in <NotificationsProvider>'
    );
  }
  return value;
}

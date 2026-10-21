import { createContext, useContext, useMemo, useState } from 'react';
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
import { createPreviewStore } from './previewStore';
import type { PreviewStore } from './previewStore';

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
  /** The class the service's catalogue gives the category: preselected
   *  for a send; for an announcement category it ties the category to a
   *  view in the publisher (a click on the view picks this category). */
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
  /**
   * Key of the deployment's free-form template (`subject`, `bodyHtml`,
   * `bodyText`), e.g. `'custom-message'` from service-templates/. With it the
   * forms offer a text editor; without it only "template by key".
   */
  freeformTemplateKey?: string;
  /**
   * "Own text / Service template" in `NotificationComposer`. The service
   * publishes no list of its templates or their variables, so writing a
   * template key by hand is for those who know them. Default: `false` -
   * own text only. `AnnouncementPublisher` always has both tabs.
   */
  serviceTemplates?: boolean;
  /** The service's `announcements.max-visibility-window`. Default: 90. */
  maxVisibilityDays?: number;
  /**
   * Languages the service renders announcements in (its
   * `supported-locales`). Publishing renders all of them; the form's switch
   * picks the preview language. Default: `['ru', 'en']`.
   */
  locales?: readonly string[];
  /** Default: everything allowed, and the service decides. */
  permissions?: Partial<NotificationPermissions>;
}

export interface ResolvedAdminOptions {
  categories: readonly AdminCategory[];
  roles: readonly AdminRole[];
  searchRecipients: AdminOptions['searchRecipients'];
  freeformTemplateKey: string | undefined;
  serviceTemplates: boolean;
  maxVisibilityDays: number;
  locales: readonly string[];
  permissions: NotificationPermissions;
}

/**
 * Parts of the kit that can be switched off, e.g. from the host's feature
 * toggles. A part that is off renders nothing and sends no requests.
 */
export interface NotificationsFeatures {
  /** The inbox: its tab, its rows in the bell, the unread badge, cards for
   *  new notifications. */
  inbox: boolean;
  /** Announcements: their tab, their rows in the bell, the outstanding
   *  count. */
  announcements: boolean;
  /** Announcements shown over the page (dialog, strip, deck). Needs
   *  `announcements`. */
  banners: boolean;
  /** The header bell. */
  bell: boolean;
  /** Sending notifications: `NotificationComposer`, `DeliveryLog`. */
  mailings: boolean;
  /** Publishing announcements: `AnnouncementPublisher`. */
  publishing: boolean;
}

export const ALL_FEATURES: NotificationsFeatures = {
  inbox: true,
  announcements: true,
  banners: true,
  bell: true,
  mailings: true,
  publishing: true,
};

function resolveFeatures(
  features: Partial<NotificationsFeatures> | undefined
): NotificationsFeatures {
  const next = { ...ALL_FEATURES, ...features };
  next.banners = next.banners && next.announcements;
  return next;
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
  /** Switches parts of the kit off. Default: everything on. */
  features?: Partial<NotificationsFeatures>;
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
  /** How each announcement is shown. Default: by its `categoryClass` -
   *  TRANSACTIONAL as a dialog, PLATFORM as a strip, MARKETING (and no
   *  class) in the deck. */
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
  /**
   * Opens a path of the cabinet in place - the host's router. A link in a
   * message that leads into the cabinet (`/preorders/new`, or a full
   * address on the same origin) then opens without a new tab, and the
   * dialog it was in closes. Without it such links open in a new tab.
   */
  navigate?: (path: string) => void;
  /** Settings of the administration components (0.2). */
  admin?: AdminOptions;
  /**
   * Separates what the kit keeps in this browser (the history of dismissed
   * announcements) between people sharing it - pass the user's id.
   * Default: `'default'`.
   */
  storageScope?: string;
  children: ReactNode;
}

export interface NotificationsContextValue {
  api: NotificationsApi;
  locale: string;
  t: Translate;
  enabled: boolean;
  features: NotificationsFeatures;
  polling: Required<PollingOptions>;
  subjects: 'fetch' | 'none';
  describeItem: (entry: InboxEntry) => ItemDescription | undefined;
  resolvePresentation: PresentationResolver;
  renderHtml:
    | ((html: string, source: InboxEntry | AnnouncementEntry) => ReactNode)
    | undefined;
  onError: (error: unknown) => void;
  navigate: ((path: string) => void) | undefined;
  admin: ResolvedAdminOptions;
  storageScope: string;
  /** What the administration forms are previewing on this page. */
  preview: PreviewStore;
}

const NotificationsContext = createContext<NotificationsContextValue | null>(
  null
);

const noDescription = () => undefined;
const ignore = () => undefined;
const NONE: readonly never[] = [];
const DEFAULT_LOCALES: readonly string[] = ['ru', 'en'];

function resolveAdmin(admin: AdminOptions | undefined): ResolvedAdminOptions {
  const p = admin?.permissions ?? {};
  return {
    categories: admin?.categories ?? NONE,
    roles: admin?.roles ?? NONE,
    searchRecipients: admin?.searchRecipients,
    freeformTemplateKey: admin?.freeformTemplateKey?.trim() || undefined,
    serviceTemplates: admin?.serviceTemplates ?? false,
    maxVisibilityDays: admin?.maxVisibilityDays ?? DEFAULT_MAX_VISIBILITY_DAYS,
    locales:
      admin?.locales && admin.locales.length > 0
        ? admin.locales.map(code => code.trim().toLowerCase()).filter(Boolean)
        : DEFAULT_LOCALES,
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
  features,
  polling,
  subjects = 'fetch',
  describeItem = noDescription,
  resolvePresentation = defaultPresentation,
  renderHtml,
  onError = ignore,
  navigate,
  admin,
  storageScope = 'default',
  children,
}: NotificationsProviderProps) {
  const resolvedAdmin = useMemo(() => resolveAdmin(admin), [admin]);
  // Compared by value: a host usually passes a fresh object each render.
  const f = resolveFeatures(features);
  const resolvedFeatures = useMemo<NotificationsFeatures>(
    () => ({
      inbox: f.inbox,
      announcements: f.announcements,
      banners: f.banners,
      bell: f.bell,
      mailings: f.mailings,
      publishing: f.publishing,
    }),
    [f.inbox, f.announcements, f.banners, f.bell, f.mailings, f.publishing]
  );
  const [preview] = useState(createPreviewStore);
  const unreadCountMs = polling?.unreadCountMs ?? 60_000;
  const announcementsMs = polling?.announcementsMs ?? 300_000;

  const value = useMemo<NotificationsContextValue>(
    () => ({
      api,
      locale,
      t: translate ?? createTranslate(locale, messages),
      enabled,
      features: resolvedFeatures,
      polling: { unreadCountMs, announcementsMs },
      subjects,
      describeItem,
      resolvePresentation,
      renderHtml,
      onError,
      navigate,
      admin: resolvedAdmin,
      storageScope,
      preview,
    }),
    [
      api,
      locale,
      translate,
      messages,
      enabled,
      resolvedFeatures,
      unreadCountMs,
      announcementsMs,
      subjects,
      describeItem,
      resolvePresentation,
      renderHtml,
      onError,
      navigate,
      resolvedAdmin,
      storageScope,
      preview,
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

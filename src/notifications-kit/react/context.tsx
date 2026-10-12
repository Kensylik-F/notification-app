import { createContext, useContext, useMemo } from 'react';
import type { ReactNode } from 'react';

import type { AnnouncementEntry, InboxEntry, NotificationsApi } from '../core';
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
}

const NotificationsContext = createContext<NotificationsContextValue | null>(
  null
);

const noDescription = () => undefined;
const ignore = () => undefined;

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
  children,
}: NotificationsProviderProps) {
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

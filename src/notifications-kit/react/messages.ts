/**
 * Every string the kit shows. A host overrides any subset through the
 * provider's `messages`, or replaces the lookup entirely with `translate`.
 */
import { ADMIN_MESSAGES_EN, ADMIN_MESSAGES_RU } from './admin-messages';

export const MESSAGES_RU = {
  'bell.label': 'Уведомления',
  'bell.labelWithCount': 'Уведомления, непрочитанных: {count}',
  'bell.title': 'Уведомления',
  'bell.openAll': 'Все уведомления',
  'bell.empty': 'Новых уведомлений нет',
  'inbox.tab.all': 'Все',
  'inbox.tab.unread': 'Непрочитанные',
  'inbox.markAllRead': 'Прочитать все',
  'inbox.loadMore': 'Показать ещё',
  'inbox.empty': 'Уведомлений пока нет',
  'inbox.emptyUnread': 'Непрочитанных уведомлений нет',
  'inbox.error': 'Не удалось загрузить уведомления',
  'inbox.retry': 'Повторить',
  'inbox.unreadMark': 'Не прочитано',
  'inbox.untitled': 'Уведомление',
  'inbox.total': 'Всего: {count}',
  'item.dismiss': 'Закрыть',
  'item.expand': 'Показать текст',
  'item.collapse': 'Свернуть',
  'item.openSeparately': 'Открыть на отдельной странице',
  'inbox.dismissAll': 'Закрыть все',
  'inbox.dismissAll.confirm': 'Закрыть все уведомления?',
  'inbox.dismissAll.confirmCount': 'Закрыть все уведомления ({count})?',
  'inbox.dismissAll.confirmNote':
    'Они уйдут из ленты и счётчика. По прямой ссылке их по-прежнему можно открыть.',
  'inbox.dismissAll.ok': 'Закрыть все',
  'inbox.dismissAll.cancel': 'Отмена',
  'inbox.dismissAll.progress': 'Закрываем: {done} из {total}',
  'inbox.dismissAll.progressNoTotal': 'Закрыто: {done}',
  'inbox.dismissAll.done': 'Закрыто: {done}',
  'inbox.dismissAll.failed': 'не удалось: {failed}',
  'inbox.dismissAll.stop': 'Остановить',
  'item.loading': 'Загрузка…',
  'item.markRead': 'Отметить прочитанным',
  'item.notFound': 'Уведомление не найдено',
  'item.notFoundHint':
    'Возможно, оно удалено по сроку хранения или адресовано другому пользователю.',
  'item.error': 'Не удалось загрузить уведомление',
  'item.noBody': 'У этого уведомления нет текста.',
  'item.received': 'Получено {date}',
  'announcement.position': '{index} из {total}',
  'announcement.important': 'Важное',
  'announcement.kind.PLATFORM': 'Объявление',
  'bell.announcements': 'Объявления',
  'bell.inbox': 'Входящие',
  'bell.seen': 'Просмотренные',
  'bell.emptyAnnouncements': 'Новых объявлений нет',
  'bell.labelWithNew': 'Уведомления, новых: {count}',
  'announcement.dismiss': 'Закрыть',
  'announcement.acknowledge': 'Понятно',
  'announcement.region': 'Объявления',
  'announcement.untitled': 'Объявление',
  'announcement.collapse': 'Свернуть',
  'feed.active': 'Активные',
  'feed.dismissed': 'Закрытые',
  'feed.error': 'Не удалось загрузить объявления',
  'feed.emptyActive': 'Сейчас объявлений нет',
  'feed.emptyDismissed': 'Закрытых объявлений нет',
  'feed.dismissedHint':
    'Здесь объявления, закрытые в этом браузере. Сервис хранит объявление только до конца срока показа.',
  'feed.dismissedAt': 'закрыто {date}',
  'feed.until': 'Показывается до {date}',
  'feed.expired': 'Срок показа закончился — это копия, сохранённая в браузере.',
  'announcement.dismissAll': 'Закрыть все',
  'announcement.expand': 'Объявления: {count}. Развернуть',
  'announcement.more': 'ещё {count}',
  'priority.HIGH': 'Важное',
  'time.justNow': 'только что',
  'error.generic': 'Что-то пошло не так. Попробуйте ещё раз.',
  'error.traceId': 'Код обращения: {traceId}',
  'announcement.header': 'Объявления · {count}',
  'announcement.readMore': 'Подробнее',
  'announcement.dismissLabel': 'Закрыть объявление',
  'announcement.dismissForever': 'Больше не показывать',
  'reader.close': 'Закрыть',
  'toast.newNotification': 'Новое уведомление',
  'toast.open': 'Открыть',
  'toast.close': 'Закрыть уведомление',
  'preview.chip': 'Предпросмотр',
  'preview.closePreview': 'Закрыть предпросмотр',
  'center.tab.inbox': 'Входящие',
  'center.tab.announcements': 'Объявления',
  'center.unreadOnly': 'Только непрочитанные',
  'center.back': 'К списку',
  'center.pick': 'Выберите уведомление',
  'center.pickAnnouncement': 'Выберите объявление',
  'center.pickNote': 'Текст откроется здесь.',
  'feed.dismissedEarlier': 'Закрытые ранее',
  'feed.closedOn': 'Закрыто {date}',
  'feed.untilPast': 'Показывалось до {date}',
  ...ADMIN_MESSAGES_RU,
} as const;

export type MessageKey = keyof typeof MESSAGES_RU;
export type Messages = Record<MessageKey, string>;

export const MESSAGES_EN: Messages = {
  'bell.label': 'Notifications',
  'bell.labelWithCount': 'Notifications, {count} unread',
  'bell.title': 'Notifications',
  'bell.openAll': 'All notifications',
  'bell.empty': 'No new notifications',
  'inbox.tab.all': 'All',
  'inbox.tab.unread': 'Unread',
  'inbox.markAllRead': 'Mark all read',
  'inbox.loadMore': 'Show more',
  'inbox.empty': 'No notifications yet',
  'inbox.emptyUnread': 'No unread notifications',
  'inbox.error': 'Could not load notifications',
  'inbox.retry': 'Retry',
  'inbox.unreadMark': 'Unread',
  'inbox.untitled': 'Notification',
  'inbox.total': 'Total: {count}',
  'item.dismiss': 'Dismiss',
  'item.expand': 'Show text',
  'item.collapse': 'Collapse',
  'item.openSeparately': 'Open on a separate page',
  'inbox.dismissAll': 'Dismiss all',
  'inbox.dismissAll.confirm': 'Dismiss all notifications?',
  'inbox.dismissAll.confirmCount': 'Dismiss all notifications ({count})?',
  'inbox.dismissAll.confirmNote':
    'They leave the inbox and the counter. A direct link still opens them.',
  'inbox.dismissAll.ok': 'Dismiss all',
  'inbox.dismissAll.cancel': 'Cancel',
  'inbox.dismissAll.progress': 'Dismissing: {done} of {total}',
  'inbox.dismissAll.progressNoTotal': 'Dismissed: {done}',
  'inbox.dismissAll.done': 'Dismissed: {done}',
  'inbox.dismissAll.failed': 'failed: {failed}',
  'inbox.dismissAll.stop': 'Stop',
  'item.loading': 'Loading…',
  'item.markRead': 'Mark as read',
  'item.notFound': 'Notification not found',
  'item.notFoundHint':
    'It may have been removed by retention or addressed to someone else.',
  'item.error': 'Could not load the notification',
  'item.noBody': 'This notification has no text.',
  'item.received': 'Received {date}',
  'announcement.position': '{index} of {total}',
  'announcement.important': 'Important',
  'announcement.kind.PLATFORM': 'Announcement',
  'bell.announcements': 'Announcements',
  'bell.inbox': 'Inbox',
  'bell.seen': 'Seen',
  'bell.emptyAnnouncements': 'No new announcements',
  'bell.labelWithNew': 'Notifications, {count} new',
  'announcement.dismiss': 'Close',
  'announcement.acknowledge': 'Got it',
  'announcement.region': 'Announcements',
  'announcement.untitled': 'Announcement',
  'announcement.collapse': 'Show less',
  'feed.active': 'Active',
  'feed.dismissed': 'Closed',
  'feed.error': 'Could not load announcements',
  'feed.emptyActive': 'No announcements right now',
  'feed.emptyDismissed': 'No closed announcements',
  'feed.dismissedHint':
    'Announcements closed in this browser. The service keeps an announcement only until its window ends.',
  'feed.dismissedAt': 'closed {date}',
  'feed.until': 'Shown until {date}',
  'feed.expired':
    'Its window has ended — this is the copy kept in the browser.',
  'announcement.dismissAll': 'Close all',
  'announcement.expand': 'Announcements: {count}. Expand',
  'announcement.more': '{count} more',
  'priority.HIGH': 'Important',
  'time.justNow': 'just now',
  'error.generic': 'Something went wrong. Please try again.',
  'error.traceId': 'Reference: {traceId}',
  'announcement.header': 'Announcements · {count}',
  'announcement.readMore': 'Read more',
  'announcement.dismissLabel': 'Close the announcement',
  'announcement.dismissForever': 'Do not show again',
  'reader.close': 'Close',
  'toast.newNotification': 'New notification',
  'toast.open': 'Open',
  'toast.close': 'Close the notification',
  'preview.chip': 'Preview',
  'preview.closePreview': 'Close the preview',
  'center.tab.inbox': 'Inbox',
  'center.tab.announcements': 'Announcements',
  'center.unreadOnly': 'Unread only',
  'center.back': 'Back to the list',
  'center.pick': 'Choose a notification',
  'center.pickAnnouncement': 'Choose an announcement',
  'center.pickNote': 'Its text opens here.',
  'feed.dismissedEarlier': 'Closed earlier',
  'feed.closedOn': 'Closed on {date}',
  'feed.untilPast': 'Was shown until {date}',
  ...ADMIN_MESSAGES_EN,
};

export type MessageVars = Record<string, string | number>;
export type Translate = (key: MessageKey, vars?: MessageVars) => string;

export function interpolate(template: string, vars?: MessageVars): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in vars ? String(vars[name]) : match
  );
}

export function dictionaryFor(locale: string): Messages {
  return locale.toLowerCase().startsWith('ru') ? MESSAGES_RU : MESSAGES_EN;
}

export function createTranslate(
  locale: string,
  overrides?: Partial<Messages>
): Translate {
  const dictionary = { ...dictionaryFor(locale), ...overrides };
  return (key, vars) => interpolate(dictionary[key], vars);
}

/**
 * Picks the plural form from `forms` - "one|few|many" for Russian,
 * "one|other" for English - by the locale's plural rules.
 */
export function plural(forms: string, count: number, locale: string): string {
  const list = forms.split('|');
  let rule: Intl.LDMLPluralRule = 'other';
  try {
    rule = new Intl.PluralRules(locale).select(count);
  } catch {
    // An unknown locale: fall through to the last form.
  }
  if (list.length >= 3) {
    return (
      (rule === 'one' ? list[0] : rule === 'few' ? list[1] : list[2]) ?? ''
    );
  }
  return (rule === 'one' ? list[0] : list[1]) ?? list[0] ?? '';
}

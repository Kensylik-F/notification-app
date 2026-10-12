/** notifications-kit React layer: provider, hooks and components. */
export {
  NotificationsProvider,
  useNotificationsContext,
  type ItemDescription,
  type NotificationsContextValue,
  type NotificationsProviderProps,
  type PollingOptions,
} from './context';
export {
  useAnnouncements,
  useDismissAnnouncement,
  useInboxCommands,
  useInboxDetails,
  useInboxItem,
  useInboxList,
  useInboxSubjects,
  useOutstandingAnnouncementCount,
  useUnreadBadge,
  useUnreadCount,
  type InboxDetails,
  type InboxListOptions,
} from './hooks';
export {
  NotificationBell,
  type NotificationBellProps,
} from './NotificationBell';
export {
  InboxList,
  InboxPanel,
  InboxTabs,
  MarkAllReadButton,
  type InboxListProps,
  type InboxPanelProps,
} from './InboxPanel';
export {
  InboxItemView,
  useInboxItemTitle,
  type InboxItemViewProps,
} from './InboxItemView';
export {
  AnnouncementsHost,
  type AnnouncementsHostProps,
} from './AnnouncementsHost';
export {
  defaultPresentation,
  planAnnouncements,
  presentationByCategory,
  type AnnouncementPlan,
  type AnnouncementPresentation,
  type PresentationResolver,
} from './presentation';
export {
  MESSAGES_EN,
  MESSAGES_RU,
  createTranslate,
  type MessageKey,
  type MessageVars,
  type Messages,
  type Translate,
} from './messages';
export { formatDateTime, formatRelative } from './format';
export {
  type AdminCategory,
  type AdminOptions,
  type AdminRole,
  type NotificationPermissions,
  type ResolvedAdminOptions,
} from './context';
export {
  NotificationComposer,
  type NotificationComposerProps,
} from './admin/NotificationComposer';
export {
  DeliveryLog,
  DeliveryTable,
  StatusBadge,
  type DeliveryLogProps,
} from './admin/DeliveryLog';
export {
  AnnouncementPublisher,
  type AnnouncementPublisherProps,
} from './admin/AnnouncementPublisher';
export {
  EmailRunProgress,
  PublishedAnnouncements,
} from './admin/PublishedAnnouncements';
export { TemplatePreview } from './admin/TemplatePreview';
export { RecipientField } from './admin/RecipientField';
export { describeError } from './admin/errors';
export {
  emailRunPollDelay,
  requestIsSettling,
  useCancelEmailRun,
  useCorrectAnnouncement,
  useDeliveryCommands,
  useDeliveryContent,
  useDeliveryHistory,
  useDeliverySearch,
  useEmailRun,
  useNotificationRequest,
  usePublishAnnouncement,
  usePublishedAnnouncements,
  useSendNotification,
  useTemplatePreview,
  type PublishedRecord,
} from './admin/hooks';

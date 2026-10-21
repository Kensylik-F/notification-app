/** notifications-kit React layer: provider, hooks and components. */
export {
  ALL_FEATURES,
  NotificationsProvider,
  useNotificationsContext,
  type ItemDescription,
  type NotificationsFeatures,
  type NotificationsContextValue,
  type NotificationsProviderProps,
  type PollingOptions,
} from './context';
export {
  useAnnouncement,
  useAnnouncements,
  useDismissAnnouncement,
  useDismissedAnnouncements,
  useDismissAll,
  useInboxCommands,
  useInboxDetails,
  useInboxItem,
  useInboxList,
  useInboxSubjects,
  useOutstandingAnnouncementCount,
  useUnreadBadge,
  useUnreadCount,
  type DismissAllProgress,
  type InboxDetails,
  type InboxListOptions,
} from './hooks';
export {
  NotificationBell,
  type NotificationBellProps,
} from './NotificationBell';
export {
  DismissAllButton,
  InboxActions,
  InboxList,
  MarkAllReadButton,
  type InboxListProps,
} from './InboxPanel';
export { InboxRow, ListRow, type ListRowProps } from './InboxRow';
export {
  NotificationCenter,
  type NotificationCenterProps,
  type NotificationCenterTab,
} from './NotificationCenter';
export {
  InboxItemView,
  useInboxItemTitle,
  type InboxItemViewProps,
} from './InboxItemView';
export {
  readDismissed,
  type DismissedAnnouncement,
} from './announcementHistory';
export {
  AnnouncementsHost,
  type AnnouncementsHostProps,
} from './AnnouncementsHost';
export {
  CLASS_PRESENTATION,
  byPriority,
  classRank,
  defaultPresentation,
  isImportant,
  presentationByCategory,
  presentationByClass,
  queueAnnouncements,
  type AnnouncementPresentation,
  type AnnouncementQueue,
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
export {
  formatCardTime,
  formatDateTime,
  formatDay,
  formatListTime,
  formatRelative,
} from './format';
export {
  Button,
  Chip,
  CloseButton,
  Dialog,
  HtmlFrame,
  Switch,
  Tabs,
  type DialogProps,
  type TabItem,
} from './primitives';
export { MessageBody, plainText } from './content';
export {
  PREVIEW_ID,
  useKitPreview,
  type AnnouncementPreview,
  type InboxPreview,
  type KitPreview,
} from './preview';
export { plural } from './messages';
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
export { EmailRunProgress } from './admin/AnnouncementPublisher';
export { RichTextEditor } from './admin/RichTextEditor';
export {
  MessageFields,
  MessageModeSwitch,
  MessageTabs,
} from './admin/MessageFields';
export {
  EditDialog as AnnouncementEditDialog,
  PublishedAnnouncements,
  type PublishedAnnouncementsProps,
} from './admin/PublishedAnnouncements';
export {
  AnnouncementEditor,
  type EditTarget as AnnouncementEditTarget,
} from './admin/AnnouncementEditor';
export { Combobox, Dropdown, type DropdownOption } from './admin/Dropdown';
export { htmlToText, sanitizeHtml } from './admin/richtext';
export {
  PREVIEW_CHANNELS,
  PreviewButton,
  PreviewDialog,
  type PreviewChannel,
} from './admin/Preview';
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
  useSendNotification,
  useTemplatePreview,
} from './admin/hooks';

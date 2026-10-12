import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';

import {
  AnnouncementPublisher,
  AnnouncementsHost,
  DeliveryLog,
  InboxItemView,
  InboxPanel,
  NotificationBell,
  NotificationComposer,
  NotificationsProvider,
  createNotificationsApi,
  notificationKeys,
  presentationByCategory,
} from '../src/notifications-kit';
import type { AdminOptions, InboxEntry } from '../src/notifications-kit';
import { searchPeople } from './mock-admin';
import { createMockService } from './mock-service';
import './demo.css';

const service = createMockService();
const api = createNotificationsApi({
  transport: service.transport,
  acceptLanguage: () => 'ru',
});
const queryClient = new QueryClient();

// The service says WHAT an announcement is; the host decides how to show it.
const resolvePresentation = presentationByCategory(
  {
    'platform-incident': 'modal',
    'platform-release': 'corner',
    'platform-tip': 'toast',
  },
  'corner'
);

const LABELS: Record<string, string> = {
  preorder: 'Предзаказы',
  export: 'Выгрузки',
  platform: 'Сервис',
  order: 'Заказы',
  demo: 'Демо',
};

const describeItem = (entry: InboxEntry) =>
  entry.category && LABELS[entry.category]
    ? { title: LABELS[entry.category]! }
    : undefined;

// What the host knows and the service does not publish: category and role
// catalogues, human names, the people directory, the person's permissions.
const ADMIN: AdminOptions = {
  categories: [
    { code: 'preorder', label: 'Предзаказы', categoryClass: 'TRANSACTIONAL' },
    { code: 'order', label: 'Заказы', categoryClass: 'TRANSACTIONAL' },
    {
      code: 'account',
      label: 'Учётная запись',
      categoryClass: 'TRANSACTIONAL',
    },
    { code: 'digest', label: 'Новости', categoryClass: 'MARKETING' },
    { code: 'platform-release', label: 'Выпуск', announcement: true },
    { code: 'platform-incident', label: 'Работы и сбои', announcement: true },
  ],
  roles: [
    { code: 'MODERATOR', label: 'Модераторы' },
    { code: 'SOURCE_OWNER', label: 'Владельцы источников' },
    { code: 'ANALYST', label: 'Аналитики' },
  ],
  templateLabels: {
    welcome: 'Приветствие',
    'password-reset': 'Сброс пароля',
    'platform-release': 'Новая версия',
  },
  variableLabels: {
    productName: 'Продукт',
    version: 'Версия',
    gettingStartedLink: 'Ссылка «С чего начать»',
    resetLink: 'Ссылка для сброса',
    expiresInMinutes: 'Срок действия, мин',
  },
  searchRecipients: searchPeople,
};

type View = 'inbox' | 'compose' | 'log' | 'announce';
const VIEWS: Array<[View, string]> = [
  ['inbox', 'Уведомления'],
  ['compose', 'Рассылка'],
  ['log', 'История доставок'],
  ['announce', 'Объявления'],
];

function App() {
  const params = new URLSearchParams(window.location.search);
  const [view, setView] = useState<View>(
    () => (params.get('view') as View | null) ?? 'inbox'
  );
  const [openId, setOpenId] = useState<string | null>(() => params.get('item'));
  const [requestId, setRequestId] = useState<string | undefined>();
  const [dark, setDark] = useState(() => params.get('theme') === 'dark');
  const headerRef = useRef<HTMLElement>(null);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';

  const admin = useMemo(() => ADMIN, []);
  const go = (next: View) => {
    setOpenId(null);
    setView(next);
  };

  return (
    <NotificationsProvider
      api={api}
      locale='ru'
      resolvePresentation={resolvePresentation}
      describeItem={describeItem}
      polling={{ unreadCountMs: 5000, announcementsMs: 10_000 }}
      admin={admin}
    >
      <div className='shell'>
        <header className='header' ref={headerRef}>
          <span className='brand'>notifications-kit demo</span>
          <button
            className='demoButton'
            onClick={() => {
              service.push('Новое важное уведомление', 'HIGH');
              void queryClient.invalidateQueries({
                queryKey: notificationKeys.inbox(),
              });
            }}
          >
            + уведомление
          </button>
          <button className='demoButton' onClick={() => setDark(v => !v)}>
            {dark ? 'Светлая тема' : 'Тёмная тема'}
          </button>
          <NotificationBell
            anchorRef={headerRef}
            onOpenItem={entry => {
              setView('inbox');
              setOpenId(entry.id);
            }}
            onOpenAll={() => go('inbox')}
          />
        </header>
        <div className='body'>
          <nav className='nav' aria-label='Разделы'>
            {VIEWS.map(([id, label]) => (
              <button
                key={id}
                className='navItem'
                aria-current={view === id ? 'page' : undefined}
                onClick={() => go(id)}
              >
                {label}
              </button>
            ))}
          </nav>
          <main className='main'>
            {view === 'inbox' && openId && (
              <>
                <button
                  className='demoButton back'
                  onClick={() => setOpenId(null)}
                >
                  ← К списку
                </button>
                <InboxItemView
                  id={openId}
                  onDismissed={() => setOpenId(null)}
                />
              </>
            )}
            {view === 'inbox' && !openId && (
              <>
                <h1 className='pageTitle'>Уведомления</h1>
                <InboxPanel onOpenItem={entry => setOpenId(entry.id)} />
              </>
            )}
            {view === 'compose' && (
              <>
                <h1 className='pageTitle'>Новая рассылка</h1>
                <NotificationComposer
                  onOpenDeliveries={id => {
                    setRequestId(id);
                    setView('log');
                  }}
                />
              </>
            )}
            {view === 'log' && (
              <>
                <h1 className='pageTitle'>История доставок</h1>
                <DeliveryLog key={requestId ?? 'all'} requestId={requestId} />
              </>
            )}
            {view === 'announce' && (
              <>
                <h1 className='pageTitle'>Объявления</h1>
                <AnnouncementPublisher />
              </>
            )}
          </main>
        </div>
      </div>
      <AnnouncementsHost toastDurationMs={8000} />
    </NotificationsProvider>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>
);

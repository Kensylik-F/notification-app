import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';

import {
  AnnouncementPublisher,
  AnnouncementsHost,
  DeliveryLog,
  InboxItemView,
  NotificationBell,
  NotificationCenter,
  NotificationComposer,
  NotificationsProvider,
  Tabs,
  createNotificationsApi,
  notificationKeys,
} from '../src/notifications-kit';
import type {
  AdminOptions,
  AnnouncementEntry,
  InboxEntry,
  NotificationCenterTab,
  NotificationsFeatures,
} from '../src/notifications-kit';
import { searchPeople } from './mock-admin';
import { createMockService } from './mock-service';
import './demo.css';

const service = createMockService();
const api = createNotificationsApi({
  transport: service.transport,
  acceptLanguage: () => 'ru',
});
const queryClient = new QueryClient();

// Feature toggles, as the host's config would give them: announcements and
// the bell on, the inbox and sending off. `?flags=all` turns everything on.
const HOST_DEFAULTS: NotificationsFeatures = {
  inbox: false,
  announcements: true,
  banners: true,
  bell: true,
  mailings: false,
  publishing: true,
};
const initialParams = new URLSearchParams(window.location.search);
const FEATURES: Partial<NotificationsFeatures> =
  initialParams.get('flags') === 'all' ? {} : HOST_DEFAULTS;

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

// What the host knows and the service does not publish: which categories
// and roles its deployment has configured, the people directory, the
// person's permissions. Demo values.
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
    {
      code: 'platform-incident',
      label: 'Работы и сбои',
      announcement: true,
      categoryClass: 'TRANSACTIONAL',
    },
    {
      code: 'platform-tip',
      label: 'Регламенты и советы',
      announcement: true,
      categoryClass: 'PLATFORM',
    },
    {
      code: 'platform-release',
      label: 'Новое в продукте',
      announcement: true,
      categoryClass: 'MARKETING',
    },
  ],
  roles: [
    { code: 'MODERATOR', label: 'Модератор' },
    { code: 'SOURCE_OWNER', label: 'Владелец источника' },
    { code: 'ANALYST', label: 'Аналитик' },
  ],
  // The deployment has service-templates/custom-message.
  freeformTemplateKey: 'custom-message',
  searchRecipients: searchPeople,
};

type View = 'inbox' | 'compose' | 'announce';
const NAV: Array<{ section: string; items: Array<[View | null, string]> }> = [
  {
    section: 'Личный кабинет',
    items: [
      [null, 'Профиль'],
      ['inbox', 'Уведомления'],
    ],
  },
  {
    section: 'Администрирование',
    items: [
      [null, 'Источники'],
      [null, 'Применимость'],
      [null, 'Чёрный список'],
      [null, 'Выгрузки'],
      ['compose', 'Рассылки'],
      ['announce', 'Объявления'],
    ],
  },
];

function App() {
  const params = new URLSearchParams(window.location.search);
  const [view, setView] = useState<View>(
    () => (params.get('view') as View | null) ?? 'inbox'
  );
  const [tab, setTab] = useState<NotificationCenterTab>(() =>
    params.get('tab') === 'announcements' ? 'announcements' : 'inbox'
  );
  const [selected, setSelected] = useState<string | null>(() =>
    params.get('item')
  );
  const [page, setPage] = useState<string | null>(() => params.get('page'));
  const [mailTab, setMailTab] = useState<'new' | 'log'>(() =>
    params.get('mail') === 'log' ? 'log' : 'new'
  );
  const [requestId, setRequestId] = useState<string | undefined>();
  const [dark, setDark] = useState(() => params.get('theme') === 'dark');
  const [agent, setAgent] = useState(() => params.get('ai') === 'open');
  const headerRef = useRef<HTMLElement>(null);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';

  const admin = useMemo(() => ADMIN, []);
  const go = (next: View) => {
    setPage(null);
    setView(next);
  };
  const openItem = (entry: InboxEntry) => {
    setPage(null);
    setView('inbox');
    setTab('inbox');
    setSelected(entry.id);
  };
  const openAnnouncement = (entry: AnnouncementEntry) => {
    setPage(null);
    setView('inbox');
    setTab('announcements');
    setSelected(entry.id);
  };
  const navHidden = (id: View | null) =>
    (id === 'compose' && FEATURES.mailings === false) ||
    (id === 'announce' && FEATURES.publishing === false);

  return (
    <NotificationsProvider
      api={api}
      locale='ru'
      features={FEATURES}
      describeItem={describeItem}
      polling={{ unreadCountMs: 5000, announcementsMs: 10_000 }}
      admin={admin}
    >
      <div className='shell'>
        <header className='header' ref={headerRef}>
          <span className='brand'>OneCheck · demo</span>
          {FEATURES.inbox !== false && (
            <button
              className='demoButton'
              onClick={() => {
                service.push('Новое важное уведомление', 'HIGH');
                void queryClient.invalidateQueries({
                  queryKey: notificationKeys.unreadCount(),
                });
              }}
            >
              + уведомление
            </button>
          )}
          <button className='demoButton' onClick={() => setDark(v => !v)}>
            {dark ? 'Светлая тема' : 'Тёмная тема'}
          </button>
          <NotificationBell
            anchorRef={headerRef}
            onOpenItem={openItem}
            onOpenAnnouncement={openAnnouncement}
            onOpenAll={() => go('inbox')}
          />
          <span className='avatar' aria-hidden='true' />
        </header>
        <div className='body'>
          <div className='work'>
            <nav className='nav' aria-label='Разделы'>
              {NAV.map(group => (
                <div key={group.section}>
                  <div className='navHead'>{group.section}</div>
                  {group.items
                    .filter(([id]) => !navHidden(id))
                    .map(([id, label]) => (
                      <button
                        key={label}
                        className='navItem'
                        aria-current={id && view === id ? 'page' : undefined}
                        disabled={!id}
                        onClick={() => id && go(id)}
                      >
                        {label}
                      </button>
                    ))}
                </div>
              ))}
            </nav>
            <main className='main'>
              {view === 'inbox' && page && (
                <>
                  <button className='crumbLink' onClick={() => setPage(null)}>
                    ← К списку уведомлений
                  </button>
                  <InboxItemView id={page} onDismissed={() => setPage(null)} />
                </>
              )}
              {view === 'inbox' && !page && (
                <>
                  <p className='crumbs'>Личный кабинет / Уведомления</p>
                  <NotificationCenter
                    title='Уведомления'
                    tab={tab}
                    onTabChange={setTab}
                    selectedId={selected}
                    onSelectedChange={setSelected}
                    onOpenItem={entry => setPage(entry.id)}
                  />
                </>
              )}
              {view === 'compose' && (
                <>
                  <p className='crumbs'>Администрирование / Рассылки</p>
                  <h1 className='pageTitle'>Рассылки</h1>
                  <Tabs
                    value={mailTab}
                    onChange={setMailTab}
                    items={[
                      { value: 'new', label: 'Новая рассылка' },
                      { value: 'log', label: 'История доставок' },
                    ]}
                  />
                  {mailTab === 'new' ? (
                    <NotificationComposer
                      onOpenDeliveries={id => {
                        setRequestId(id);
                        setMailTab('log');
                      }}
                    />
                  ) : (
                    <div className='pagePad'>
                      <DeliveryLog
                        key={requestId ?? 'all'}
                        requestId={requestId}
                      />
                    </div>
                  )}
                </>
              )}
              {view === 'announce' && (
                <>
                  <p className='crumbs'>Администрирование / Объявления</p>
                  <h1 className='pageTitle'>Новое объявление</h1>
                  <p className='pageNote'>
                    Видно всем выбранным пользователям в кабинете до даты
                    окончания.
                  </p>
                  <AnnouncementPublisher />
                </>
              )}
            </main>
          </div>
          {agent ? (
            <aside className='agent' aria-label='AI агент'>
              <div className='agentHead'>
                <span>AI Агент</span>
                <button className='demoButton' onClick={() => setAgent(false)}>
                  Свернуть
                </button>
              </div>
              <div className='agentInput'>Задайте вопрос агенту…</div>
            </aside>
          ) : (
            <button
              className='agentRail'
              onClick={() => setAgent(true)}
              aria-label='Открыть AI агента'
            >
              AI Агент
            </button>
          )}
        </div>
      </div>
      <AnnouncementsHost onOpenItem={openItem} />
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

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';

import {
  AnnouncementsHost,
  InboxItemView,
  InboxPanel,
  NotificationBell,
  NotificationsProvider,
  createNotificationsApi,
  notificationKeys,
  presentationByCategory,
} from '../src/notifications-kit';
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

function App() {
  const [openId, setOpenId] = useState<string | null>(() =>
    new URLSearchParams(window.location.search).get('item')
  );
  const [dark, setDark] = useState(
    () => new URLSearchParams(window.location.search).get('theme') === 'dark'
  );
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';

  const describeItem = useMemo(
    () => (entry: { category: string | null }) =>
      entry.category
        ? { title: LABELS[entry.category] ?? entry.category }
        : undefined,
    []
  );

  return (
    <NotificationsProvider
      api={api}
      locale='ru'
      resolvePresentation={resolvePresentation}
      describeItem={describeItem}
      polling={{ unreadCountMs: 5000 }}
    >
      <div className='shell'>
        <header className='header'>
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
            onOpenItem={entry => setOpenId(entry.id)}
            onOpenAll={() => setOpenId(null)}
          />
        </header>
        <main className='main'>
          <p className='crumbs'>Личный кабинет / Уведомления</p>
          {openId ? (
            <>
              <button
                className='demoButton back'
                onClick={() => setOpenId(null)}
              >
                ← К списку
              </button>
              <InboxItemView id={openId} onDismissed={() => setOpenId(null)} />
            </>
          ) : (
            <>
              <h1 className='pageTitle'>Уведомления</h1>
              <InboxPanel onOpenItem={entry => setOpenId(entry.id)} />
            </>
          )}
        </main>
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

import { useEffect, useMemo, useRef, useState } from 'react';

import { TEMPLATE_KEY_PATTERN } from '../../core';
import type { Channel, RenderPreviewRequest } from '../../core';
import { useNotificationsContext } from '../context';
import { HtmlFrame, IconButton, Spinner } from '../primitives';
import styles from './admin.module.css';
import { ErrorNotice } from './errors';
import { Segmented } from './forms';
import { useTemplatePreview } from './hooks';

interface TemplatePreviewProps {
  templateKey: string;
  variables: Record<string, string>;
  /** Channels to show; the first is selected. */
  channels: readonly Channel[];
  /** Nothing to render yet (e.g. an empty editor). */
  idle?: boolean;
}

const DEBOUNCE_MS = 600;

/**
 * The message as the service renders it - the same strict renderer a send
 * uses, so a wrong key or a missing variable shows up here first. Follows
 * the form on its own, debounced.
 */
export function TemplatePreview({
  templateKey,
  variables,
  channels,
  idle,
}: TemplatePreviewProps) {
  const { t, admin, locale } = useNotificationsContext();
  const preview = useTemplatePreview();
  const [picked, setPicked] = useState<Channel | undefined>(channels[0]);
  const channel = picked && channels.includes(picked) ? picked : channels[0];

  const request = useMemo<RenderPreviewRequest | null>(
    () =>
      !idle && channel && TEMPLATE_KEY_PATTERN.test(templateKey)
        ? {
            templateKey,
            channel,
            locale: locale.slice(0, 2).toLowerCase(),
            variables,
          }
        : null,
    [idle, channel, templateKey, locale, variables]
  );
  const requestKey = JSON.stringify(request);
  // The object changes identity on every render; its content is `requestKey`.
  const requestRef = useRef(request);
  requestRef.current = request;
  const run = preview.mutate;

  useEffect(() => {
    const current = requestRef.current;
    if (!current || !admin.permissions.preview) return;
    const timer = setTimeout(() => run(current), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [requestKey, run, admin.permissions.preview]);

  if (!admin.permissions.preview) {
    return (
      <aside className={styles.preview}>
        <h3 className={styles.sectionTitle}>{t('preview.title')}</h3>
        <p className={styles.muted}>{t('preview.noAccess')}</p>
      </aside>
    );
  }

  const result = request ? preview.data : undefined;

  return (
    <aside className={styles.preview} aria-live='polite'>
      <header className={styles.previewHeader}>
        <h3 className={styles.sectionTitle}>{t('preview.title')}</h3>
        <div className={styles.inlineRow}>
          {preview.isPending && <Spinner label={t('item.loading')} />}
          {request && (
            <IconButton
              icon='refresh'
              small
              label={t('preview.refresh')}
              onClick={() => run(request)}
            />
          )}
        </div>
      </header>

      {channels.length > 1 && channel && (
        <Segmented
          name='nk-preview-channel'
          value={channel}
          options={channels.map(c => ({ value: c, label: t(`channel.${c}`) }))}
          onChange={setPicked}
        />
      )}

      {!request ? (
        <div className={styles.previewEmpty}>{t('preview.empty')}</div>
      ) : preview.isError ? (
        <ErrorNotice error={preview.error} t={t} />
      ) : !result ? (
        <div className={styles.previewEmpty}>{t('item.loading')}</div>
      ) : (
        <div
          className={styles.previewSheet}
          data-pending={preview.isPending || undefined}
        >
          {result.subject && (
            <div className={styles.previewSubject}>{result.subject}</div>
          )}
          {result.htmlBody ? (
            <HtmlFrame html={result.htmlBody} title={t('preview.title')} />
          ) : result.textBody ? (
            <p className={styles.previewText}>{result.textBody}</p>
          ) : (
            <p className={styles.muted}>{t('item.noBody')}</p>
          )}
        </div>
      )}
    </aside>
  );
}

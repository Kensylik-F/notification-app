import { useEffect, useMemo, useRef, useState } from 'react';

import { TEMPLATE_KEY_PATTERN } from '../../core';
import type { Channel, RenderPreviewRequest } from '../../core';
import { useNotificationsContext } from '../context';
import { Button, Spinner } from '../primitives';
import { useTemplatePreview } from './hooks';
import styles from './admin.module.css';
import { ErrorNotice } from './errors';
import { HtmlFrame, Segmented, Select } from './forms';

interface TemplatePreviewProps {
  templateKey: string;
  /** Channels to offer; the first is selected. */
  channels: readonly Channel[];
  /** Languages per channel (the template's `channels`). A channel without
   *  an entry - the service picks its default. */
  locales: Partial<Record<Channel, readonly string[]>>;
  variables: Record<string, string>;
}

const AUTO_REFRESH_MS = 700;

/**
 * The service renders the message exactly as a send would (same strict
 * renderer), so a missing variable or a broken template shows up here.
 * After the first render it follows the form, debounced.
 */
const NO_LOCALES: readonly string[] = [];

export function TemplatePreview({
  templateKey,
  channels,
  locales: localesByChannel,
  variables,
}: TemplatePreviewProps) {
  const { t, admin, locale: uiLocale } = useNotificationsContext();
  const preview = useTemplatePreview();
  const [channel, setChannel] = useState<Channel | undefined>(channels[0]);
  const [locale, setLocale] = useState<string>('');
  const [started, setStarted] = useState(false);
  const locales = (channel && localesByChannel[channel]) || NO_LOCALES;

  // Keep the selection valid when the template (and its channels) change.
  useEffect(() => {
    if (!channel || !channels.includes(channel)) setChannel(channels[0]);
  }, [channels, channel]);

  useEffect(() => {
    if (locales.length === 0) setLocale('');
    else if (!locales.includes(locale)) {
      const own = uiLocale.slice(0, 2).toLowerCase();
      setLocale(locales.includes(own) ? own : (locales[0] ?? ''));
    }
  }, [locales, locale, uiLocale]);

  const validKey = TEMPLATE_KEY_PATTERN.test(templateKey);
  const request = useMemo<RenderPreviewRequest | null>(
    () =>
      validKey && channel
        ? {
            templateKey,
            channel,
            ...(locale ? { locale } : {}),
            variables,
          }
        : null,
    [validKey, templateKey, channel, locale, variables]
  );
  const requestKey = JSON.stringify(request);
  // The object changes identity on every render; its content is `requestKey`.
  const requestRef = useRef(request);
  requestRef.current = request;

  const run = preview.mutate;
  const lastSent = useRef<string | null>(null);
  useEffect(() => {
    const current = requestRef.current;
    if (!started || !current || lastSent.current === requestKey) return;
    const timer = setTimeout(() => {
      lastSent.current = requestKey;
      run(current);
    }, AUTO_REFRESH_MS);
    return () => clearTimeout(timer);
  }, [started, requestKey, run]);

  if (!admin.permissions.preview) {
    return (
      <aside className={styles.preview}>
        <h3 className={styles.sectionTitle}>{t('preview.title')}</h3>
        <p className={styles.muted}>{t('preview.noAccess')}</p>
      </aside>
    );
  }

  const result = preview.data;
  const html = result?.htmlBody ?? null;
  const text = result?.textBody ?? null;

  return (
    <aside className={styles.preview} aria-live='polite'>
      <header className={styles.previewHeader}>
        <h3 className={styles.sectionTitle}>{t('preview.title')}</h3>
        {request && (
          <Button
            variant={started ? 'ghost' : 'primary'}
            icon={started ? 'refresh' : undefined}
            disabled={preview.isPending}
            onClick={() => {
              setStarted(true);
              lastSent.current = requestKey;
              run(request);
            }}
          >
            {started ? t('preview.refresh') : t('preview.run')}
          </Button>
        )}
      </header>

      {!request ? (
        <p className={styles.muted}>{t('preview.empty')}</p>
      ) : (
        <>
          <div className={styles.previewControls}>
            {channels.length > 1 && channel && (
              <Segmented
                name='nk-preview-channel'
                value={channel}
                options={channels.map(c => ({
                  value: c,
                  label: t(`channel.${c}`),
                }))}
                onChange={setChannel}
              />
            )}
            {locales.length > 1 && (
              <Select
                aria-label={t('preview.locale')}
                className={styles.selectCompact}
                value={locale}
                onChange={event => setLocale(event.target.value)}
              >
                {locales.map(l => (
                  <option key={l} value={l}>
                    {l}
                  </option>
                ))}
              </Select>
            )}
          </div>

          {!started && !result && (
            <p className={styles.muted}>{t('preview.idle')}</p>
          )}
          {preview.isPending && !result && (
            <div className={styles.previewLoading}>
              <Spinner label={t('item.loading')} />
            </div>
          )}
          {preview.isError && <ErrorNotice error={preview.error} t={t} />}
          {result && !preview.isError && (
            <div
              className={styles.previewSheet}
              data-pending={preview.isPending || undefined}
            >
              {result.subject && (
                <div className={styles.previewSubject}>
                  <span className={styles.muted}>{t('preview.subject')}</span>
                  <strong>{result.subject}</strong>
                </div>
              )}
              {html ? (
                <HtmlFrame html={html} title={t('preview.title')} />
              ) : text ? (
                <p className={styles.previewText}>{text}</p>
              ) : (
                <p className={styles.muted}>{t('item.noBody')}</p>
              )}
              {(result.templateVersion || result.resolvedLocale) && (
                <span className={styles.previewMeta}>
                  {[
                    result.resolvedLocale,
                    result.templateVersion &&
                      t('preview.version', { version: result.templateVersion }),
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              )}
            </div>
          )}
        </>
      )}
    </aside>
  );
}

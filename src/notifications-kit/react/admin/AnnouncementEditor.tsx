/**
 * Changing a published announcement: its text, or the parameters of its
 * template. The service re-renders every language from what is sent
 * (`POST /announcements/{id}/corrections`); the audience, the view and the
 * window cannot change.
 */
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import {
  contentToTemplate,
  isNotificationsError,
  notificationKeys,
  validateContent,
} from '../../core';
import type {
  AnnouncementEntry,
  MessageContent,
  PublishAnnouncementRequest,
  RenderPreviewResponse,
} from '../../core';
import { MessageBody } from '../content';
import { useNotificationsContext } from '../context';
import { Button, Spinner } from '../primitives';
import styles from './admin.module.css';
import { PreviewLocaleSwitch, usePreviewLocale } from './announceShared';
import { ErrorNotice } from './errors';
import { Notice } from './forms';
import { useCorrectAnnouncement } from './hooks';
import { EMPTY_FREEFORM, MessageFields, MessageTabs } from './MessageFields';
import { useFetchPreview, usePreviewRequest } from './Preview';
import { readPublished, rememberCorrection } from './publishedJournal';

const DAY_MS = 86_400_000;

/** What an edit starts from. */
export interface EditTarget {
  id: string;
  /**
   * Sent back with the new content. The service reads only the variables
   * of a correction (and re-renders the announcement's own template), so
   * the audience, category and window here are never changed by it.
   */
  base: PublishAnnouncementRequest;
  initial: MessageContent;
  /** The way it was made is known (published from this browser): the tab
   *  and the template stay fixed. */
  originKnown: boolean;
  /** The service would not give its text (window over, or not addressed to
   *  the caller) and this browser did not publish it. */
  unavailable: boolean;
}

/** The request as content for the form. */
export function requestToContent(
  request: PublishAnnouncementRequest,
  freeformKey: string | undefined
): MessageContent {
  const vars = Object.fromEntries(
    Object.entries(request.variables ?? {}).map(([k, v]) => [
      k,
      String(v ?? ''),
    ])
  );
  if (freeformKey && request.templateKey === freeformKey) {
    return {
      mode: 'freeform',
      subject: vars.subject ?? '',
      bodyHtml: vars.bodyHtml ?? '',
      bodyText: vars.bodyText ?? '',
    };
  }
  return {
    mode: 'template',
    templateKey: request.templateKey,
    variables: Object.entries(vars).map(([name, value]) => ({ name, value })),
  };
}

/**
 * Where the edit of announcement `id` starts: what this browser sent when
 * publishing it, else the text the service shows now.
 */
export function useEditTarget(
  id: string,
  hint?: Partial<AnnouncementEntry>
): { loading: boolean; target: EditTarget | null } {
  const { api, admin, storageScope } = useNotificationsContext();
  const freeformKey = admin.freeformTemplateKey;
  const record = readPublished(storageScope).find(r => r.id === id);
  const query = useQuery({
    queryKey: notificationKeys.announcement(id),
    queryFn: ({ signal }) => api.announcements.get(id, { signal }),
    enabled: !record,
    staleTime: 0,
    retry: (count, error) =>
      !(isNotificationsError(error) && error.status === 404) && count < 2,
  });

  if (record) {
    return {
      loading: false,
      target: {
        id,
        base: record.request,
        initial: requestToContent(record.request, freeformKey),
        originKnown: true,
        unavailable: false,
      },
    };
  }
  if (query.isPending) return { loading: true, target: null };

  const entry = query.data ?? null;
  const known = entry ?? hint ?? null;
  const base: PublishAnnouncementRequest = {
    category: known?.category ?? '',
    // Not read by the service for a correction; present because the
    // request type requires it.
    audienceType: 'EVERYONE',
    templateKey: freeformKey ?? 'custom-message',
    variables: {},
    visibleUntil:
      known?.visibleUntil ?? new Date(Date.now() + DAY_MS).toISOString(),
  };
  return {
    loading: false,
    target: {
      id,
      base,
      initial: entry
        ? {
            mode: 'freeform',
            subject: entry.subject ?? '',
            bodyHtml: entry.bodyHtml ?? '',
            bodyText: entry.bodyText ?? '',
          }
        : EMPTY_FREEFORM,
      originKnown: false,
      unavailable: !entry,
    },
  };
}

/** The edit form: tabs (when the origin is unknown), the fields, the
 *  preview in the chosen language, save. */
export function AnnouncementEditor({
  target,
  onCancel,
  onDone,
}: {
  target: EditTarget;
  onCancel: () => void;
  onDone: (request: PublishAnnouncementRequest) => void;
}) {
  const { t, admin, storageScope } = useNotificationsContext();
  const freeformKey = admin.freeformTemplateKey;
  const correct = useCorrectAnnouncement();
  const [content, setContent] = useState<MessageContent>(target.initial);
  const [showErrors, setShowErrors] = useState(false);
  const [previewLocale, setPreviewLocale] = usePreviewLocale();
  const errors = validateContent(content, freeformKey);
  const valid = Object.keys(errors).length === 0;
  const preview = useInlinePreview(content, previewLocale);

  useEffect(() => setContent(target.initial), [target.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = () => {
    setShowErrors(true);
    if (!valid) return;
    const request: PublishAnnouncementRequest = {
      ...target.base,
      ...contentToTemplate(content, freeformKey),
    };
    correct.mutate(
      { id: target.id, request },
      {
        onSuccess: () => {
          rememberCorrection(storageScope, target.id, request);
          onDone(request);
        },
      }
    );
  };

  return (
    <div className={styles.correction}>
      {target.unavailable && (
        <Notice tone='warning' title={t('edit.unavailable')} />
      )}
      {!target.originKnown && (
        <>
          <MessageTabs value={content} onChange={setContent} />
          {content.mode === 'freeform' && !target.unavailable && (
            <p className={styles.muted}>{t('edit.originUnknown')}</p>
          )}
        </>
      )}
      <MessageFields
        value={content}
        onChange={setContent}
        errors={showErrors ? errors : {}}
        keyLocked={target.originKnown && content.mode === 'template'}
      />
      <PreviewLocaleSwitch value={previewLocale} onChange={setPreviewLocale} />
      {preview.result && (
        <div className={styles.inlinePreview}>
          <span className={styles.muted}>{t('edit.previewTitle')}</span>
          <strong className={styles.inlinePreviewSubject}>
            {preview.result.subject}
          </strong>
          <MessageBody
            source={{
              id: target.id,
              category: target.base.category,
              categoryClass: null,
              locale: preview.result.resolvedLocale ?? previewLocale,
              subject: preview.result.subject ?? null,
              bodyText: preview.result.textBody ?? null,
              bodyHtml: preview.result.htmlBody ?? null,
              publishedAt: null,
              visibleFrom: null,
              visibleUntil: null,
              dismissed: false,
            }}
            title={preview.result.subject ?? t('edit.previewTitle')}
          />
        </div>
      )}
      {correct.isError && <ErrorNotice error={correct.error} t={t} />}
      {preview.error !== null && <ErrorNotice error={preview.error} t={t} />}
      <div className={styles.inlineRow}>
        <Button variant='primary' disabled={correct.isPending} onClick={save}>
          {correct.isPending ? t('edit.saving') : t('edit.save')}
        </Button>
        <Button
          icon='eye'
          disabled={preview.busy || !admin.permissions.preview}
          onClick={() => {
            setShowErrors(true);
            if (valid) void preview.run();
          }}
        >
          {preview.busy ? <Spinner label={t('edit.preview')} /> : null}
          {t('edit.preview')}
        </Button>
        <Button variant='ghost' disabled={correct.isPending} onClick={onCancel}>
          {t('edit.cancel')}
        </Button>
      </div>
    </div>
  );
}

/** The service's rendering of the content, shown inside the form. */
function useInlinePreview(content: MessageContent, locale: string) {
  const fetchPreview = useFetchPreview();
  const requestFor = usePreviewRequest(content, locale);
  const [result, setResult] = useState<RenderPreviewResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  // A preview of other text or another language is stale.
  const key = JSON.stringify([content, locale]);
  useEffect(() => {
    setResult(null);
    setError(null);
  }, [key]);

  return {
    result,
    busy,
    error,
    run: async () => {
      const request = requestFor('IN_APP');
      if (!request) return;
      setBusy(true);
      setError(null);
      try {
        setResult(await fetchPreview(request));
      } catch (caught) {
        setError(caught);
      } finally {
        setBusy(false);
      }
    },
  };
}

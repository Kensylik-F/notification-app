/**
 * Changing a published announcement: its text, or the parameters of its
 * template (`POST /announcements/{id}/corrections`, every language is
 * re-rendered), and its dates or removing it from display
 * (`POST /announcements/{id}/window`, `features.announcementWindow`). The
 * audience and the view cannot change.
 */
import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';

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
import { Button, Spinner, cx } from '../primitives';
import type { Translate } from '../messages';
import styles from './admin.module.css';
import { PreviewLocaleSwitch, usePreviewLocale } from './announceShared';
import { ErrorNotice } from './errors';
import { Field, Notice, TextInput, toLocalInput } from './forms';
import { useChangeAnnouncementWindow, useCorrectAnnouncement } from './hooks';
import { EMPTY_FREEFORM, MessageFields, MessageTabs } from './MessageFields';
import { useFetchPreview, usePreviewRequest } from './Preview';
import {
  readPublished,
  rememberCorrection,
  rememberWindow,
} from './publishedJournal';

const DAY_MS = 86_400_000;

const escapeHtml = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Plain text as editor HTML: paragraphs by blank lines, line breaks kept. */
export function textToHtml(text: string): string {
  return text
    .trim()
    .split(/\n\s*\n/)
    .filter(Boolean)
    .map(part => `<p>${escapeHtml(part).replace(/\n/g, '<br>')}</p>`)
    .join('');
}

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
  /** When it is shown now, ISO; `null` - not known. */
  visibleFrom: string | null;
  visibleUntil: string | null;
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
        visibleFrom:
          record.announcement.visibleFrom ??
          record.request.visibleFrom ??
          record.announcement.publishedAt ??
          record.publishedAt,
        visibleUntil:
          record.announcement.visibleUntil ?? record.request.visibleUntil,
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
            // A text-only announcement has no HTML: the editor gets its text.
            bodyHtml: entry.bodyHtml ?? textToHtml(entry.bodyText ?? ''),
            bodyText: entry.bodyText ?? '',
          }
        : EMPTY_FREEFORM,
      originKnown: false,
      unavailable: !entry,
      visibleFrom: known?.visibleFrom ?? known?.publishedAt ?? null,
      visibleUntil: known?.visibleUntil ?? null,
    },
  };
}

/** The last minute of the previous day, local time: "remove from display". */
export function endOfYesterday(now = new Date()): Date {
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return new Date(midnight.getTime() - 60_000);
}

const toInput = (iso: string | null) =>
  iso && !Number.isNaN(Date.parse(iso)) ? toLocalInput(new Date(iso)) : '';

type WindowError = 'required' | 'beforeStart' | 'tooLong' | undefined;

/** A past end is allowed: it removes the announcement from display. */
export function validateWindow(
  from: string,
  until: string,
  maxDays: number
): { from?: 'invalid'; until?: WindowError } {
  const start = from ? Date.parse(from) : NaN;
  const end = until ? Date.parse(until) : NaN;
  if (Number.isNaN(end)) return { until: 'required' };
  if (from && Number.isNaN(start)) return { from: 'invalid' };
  if (!Number.isNaN(start) && end > Date.now()) {
    if (end <= start) return { until: 'beforeStart' };
    if (end - start > maxDays * DAY_MS) return { until: 'tooLong' };
  }
  return {};
}

/** Not a 404 of the announcement itself: the route is not there. */
function windowUnsupported(error: unknown): boolean {
  return (
    isNotificationsError(error) &&
    (error.status === 404 || error.status === 405 || error.status === 501) &&
    error.code !== 'error.notification.announcement.not-found'
  );
}

function untilMessage(error: WindowError, t: Translate, days: number) {
  if (error === 'tooLong') return t('announce.until.error.tooLong', { days });
  if (error === 'beforeStart') return t('announce.until.error.beforeStart');
  if (error === 'required') return t('announce.until.error.required');
  return undefined;
}

/** The edit form: tabs (when the origin is unknown), the fields, the
 *  preview in the chosen language, the dates, removing from display, save. */
export function AnnouncementEditor({
  target,
  onCancel,
  onDone,
}: {
  target: EditTarget;
  onCancel: () => void;
  /** `removed` - its display was ended. */
  onDone: (
    request: PublishAnnouncementRequest,
    result: { removed: boolean }
  ) => void;
}) {
  const { t, admin, features, storageScope } = useNotificationsContext();
  const freeformKey = admin.freeformTemplateKey;
  const correct = useCorrectAnnouncement();
  const changeWindow = useChangeAnnouncementWindow();
  const [content, setContent] = useState<MessageContent>(target.initial);
  const initialFrom = useMemo(() => toInput(target.visibleFrom), [target]);
  const initialUntil = useMemo(() => toInput(target.visibleUntil), [target]);
  const [from, setFrom] = useState(initialFrom);
  const [until, setUntil] = useState(initialUntil);
  const [showErrors, setShowErrors] = useState(false);
  /** Ending the display waits for a yes; `save` - also the other changes. */
  const [confirmEnd, setConfirmEnd] = useState<{
    at: string;
    save: boolean;
  } | null>(null);
  const [previewLocale, setPreviewLocale] = usePreviewLocale();
  const days = admin.maxVisibilityDays;
  const windowOn = features.announcementWindow;

  const contentChanged =
    JSON.stringify(content) !== JSON.stringify(target.initial);
  const windowChanged =
    windowOn && (from !== initialFrom || until !== initialUntil);
  const contentErrors = contentChanged
    ? validateContent(content, freeformKey)
    : {};
  const windowErrors = windowChanged ? validateWindow(from, until, days) : {};
  const valid =
    Object.keys(contentErrors).length === 0 &&
    Object.keys(windowErrors).length === 0;
  const preview = useInlinePreview(content, previewLocale);
  const busy = correct.isPending || changeWindow.isPending;

  useEffect(() => setContent(target.initial), [target.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const contentRequest = (): PublishAnnouncementRequest => ({
    ...target.base,
    ...contentToTemplate(content, freeformKey),
  });

  const sendWindow = async (
    visibleUntil: string,
    visibleFrom: string | null
  ) => {
    const request = {
      ...(visibleFrom !== null ? { visibleFrom } : {}),
      visibleUntil,
    };
    const saved = await changeWindow.mutateAsync({ id: target.id, request });
    // The service's dates win: ending the display may move the start too.
    rememberWindow(storageScope, target.id, {
      visibleFrom: saved.visibleFrom ?? visibleFrom,
      visibleUntil: saved.visibleUntil ?? visibleUntil,
    });
  };

  const run = async (endAt: string | null, withContent = endAt === null) => {
    try {
      // The text first: it is saved even if the service cannot change the
      // dates yet.
      if (withContent && contentChanged) {
        const request = contentRequest();
        await correct.mutateAsync({ id: target.id, request });
        rememberCorrection(storageScope, target.id, request);
      }
      if (endAt) {
        await sendWindow(endAt, null);
      } else if (windowChanged) {
        const fromIso =
          from && from !== initialFrom ? new Date(from).toISOString() : null;
        await sendWindow(new Date(until).toISOString(), fromIso);
      }
      setConfirmEnd(null);
      const ended =
        endAt ?? (windowChanged ? new Date(until).toISOString() : null);
      onDone(contentRequest(), {
        removed: ended !== null && Date.parse(ended) <= Date.now(),
      });
    } catch {
      setConfirmEnd(null);
      // Shown below from the mutation state.
    }
  };

  const save = () => {
    setShowErrors(true);
    if (!valid) return;
    if (!contentChanged && !windowChanged) {
      onCancel();
      return;
    }
    // A past end removes the announcement from display: ask first.
    if (windowChanged && Date.parse(until) <= Date.now()) {
      setConfirmEnd({ at: new Date(until).toISOString(), save: true });
      return;
    }
    void run(null);
  };

  const windowError = changeWindow.isError ? changeWindow.error : null;

  return (
    <div className={styles.correction}>
      {target.unavailable && (
        <Notice tone='warning' title={t('edit.unavailable')} />
      )}
      {!target.originKnown && (
        <>
          <MessageTabs value={content} onChange={setContent} editing />
          {content.mode === 'freeform' && !target.unavailable && (
            <p className={styles.muted}>{t('edit.originUnknown')}</p>
          )}
        </>
      )}
      <MessageFields
        value={content}
        onChange={setContent}
        errors={showErrors ? contentErrors : {}}
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

      {windowOn && (
        <div className={styles.editWindow}>
          <strong>{t('edit.window')}</strong>
          <div className={styles.editWindowRow}>
            <Field
              label={t('announce.from')}
              error={
                showErrors && windowErrors.from
                  ? t('announce.from.error')
                  : undefined
              }
            >
              {({ id, describedBy, invalid }) => (
                <TextInput
                  id={id}
                  type='datetime-local'
                  className={styles.dateInput}
                  aria-describedby={describedBy}
                  invalid={invalid}
                  value={from}
                  onChange={event => setFrom(event.target.value)}
                />
              )}
            </Field>
            <Field
              label={t('announce.until')}
              required
              hint={t('edit.window.hint', { days })}
              error={
                showErrors
                  ? untilMessage(windowErrors.until, t, days)
                  : undefined
              }
            >
              {({ id, describedBy, invalid }) => (
                <TextInput
                  id={id}
                  type='datetime-local'
                  className={styles.dateInput}
                  aria-describedby={describedBy}
                  invalid={invalid}
                  value={until}
                  onChange={event => setUntil(event.target.value)}
                />
              )}
            </Field>
          </div>
        </div>
      )}

      {windowError !== null &&
        (windowUnsupported(windowError) ? (
          <Notice tone='error' title={t('edit.window.unsupported')} />
        ) : (
          <ErrorNotice error={windowError} t={t} />
        ))}
      {correct.isError && <ErrorNotice error={correct.error} t={t} />}
      {preview.error !== null && <ErrorNotice error={preview.error} t={t} />}
      {confirmEnd ? (
        <div
          className={cx(styles.editorActions, styles.editConfirm)}
          role='alertdialog'
          aria-label={t('edit.remove')}
        >
          <span>{t('edit.remove.confirm')}</span>
          <div className={styles.inlineRow}>
            <Button
              variant='primary'
              className={styles.editRemoveConfirm}
              disabled={busy}
              onClick={() => void run(confirmEnd.at, confirmEnd.save)}
            >
              {busy ? t('edit.saving') : t('edit.remove')}
            </Button>
            <Button disabled={busy} onClick={() => setConfirmEnd(null)}>
              {t('announce.confirm.back')}
            </Button>
          </div>
        </div>
      ) : (
        <div className={cx(styles.inlineRow, styles.editorActions)}>
          <Button variant='primary' disabled={busy} onClick={save}>
            {busy ? t('edit.saving') : t('edit.save')}
          </Button>
          <Button
            icon='eye'
            disabled={preview.busy || !admin.permissions.preview}
            onClick={() => {
              setShowErrors(true);
              if (
                Object.keys(validateContent(content, freeformKey)).length === 0
              )
                void preview.run();
            }}
          >
            {preview.busy ? <Spinner label={t('edit.preview')} /> : null}
            {t('edit.preview')}
          </Button>
          <Button variant='ghost' disabled={busy} onClick={onCancel}>
            {t('edit.cancel')}
          </Button>
          {windowOn && (
            <Button
              className={styles.editRemove}
              disabled={busy}
              onClick={() =>
                setConfirmEnd({
                  at: endOfYesterday().toISOString(),
                  save: false,
                })
              }
            >
              {t('edit.remove')}
            </Button>
          )}
        </div>
      )}
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

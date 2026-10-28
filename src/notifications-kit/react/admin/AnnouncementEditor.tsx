/**
 * Changing a published announcement, as notification-service allows it:
 * - the text, or the parameters of its template -
 *   `POST /announcements/{id}/corrections` (every language re-rendered);
 * - the dates - `PUT /announcements/{id}/window`: the end not in the past,
 *   the start only while the display has not begun;
 * - removing it from display - `POST /announcements/{id}/withdrawal`: final.
 * The audience and the view cannot change.
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
import {
  useChangeAnnouncementWindow,
  useCorrectAnnouncement,
  useWithdrawAnnouncement,
} from './hooks';
import { EMPTY_FREEFORM, MessageFields, MessageTabs } from './MessageFields';
import { useFetchPreview, usePreviewRequest } from './Preview';
import {
  readPublished,
  rememberAdmin,
  rememberCorrection,
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
  /** Withdrawn: nothing about it can change any more. */
  withdrawn: boolean;
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
        withdrawn: Boolean(record.announcement.withdrawnAt),
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
      withdrawn: false,
    },
  };
}

const toInput = (iso: string | null) =>
  iso && !Number.isNaN(Date.parse(iso)) ? toLocalInput(new Date(iso)) : '';

type WindowErrors = {
  from?: 'invalid' | 'past';
  until?: 'required' | 'past' | 'beforeStart' | 'tooLong';
};

/**
 * The rules of `PUT /announcements/{id}/window`: the end after now; the
 * start (only while the display has not begun) not in the past; the end
 * after the start; at most `maxDays` long.
 */
export function validateWindow(
  from: string,
  until: string,
  maxDays: number,
  { opened, now = Date.now() }: { opened: boolean; now?: number }
): WindowErrors {
  const start = from ? Date.parse(from) : NaN;
  const end = until ? Date.parse(until) : NaN;
  const errors: WindowErrors = {};
  if (from && Number.isNaN(start)) errors.from = 'invalid';
  else if (!opened && start < now) errors.from = 'past';
  if (Number.isNaN(end)) errors.until = 'required';
  else if (end <= now) errors.until = 'past';
  else if (!Number.isNaN(start) && end <= start) errors.until = 'beforeStart';
  else if (!Number.isNaN(start) && end - start > maxDays * DAY_MS)
    errors.until = 'tooLong';
  return errors;
}

function untilMessage(
  error: WindowErrors['until'],
  t: Translate,
  days: number
) {
  if (error === 'tooLong') return t('announce.until.error.tooLong', { days });
  if (error === 'beforeStart') return t('announce.until.error.beforeStart');
  if (error === 'past') return t('edit.window.untilPast');
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
  /** `removed` - it was withdrawn. */
  onDone: (
    request: PublishAnnouncementRequest,
    result: { removed: boolean }
  ) => void;
}) {
  const { t, admin, storageScope } = useNotificationsContext();
  const freeformKey = admin.freeformTemplateKey;
  const correct = useCorrectAnnouncement();
  const changeWindow = useChangeAnnouncementWindow();
  const withdraw = useWithdrawAnnouncement();
  const [content, setContent] = useState<MessageContent>(target.initial);
  const initialFrom = useMemo(() => toInput(target.visibleFrom), [target]);
  const initialUntil = useMemo(() => toInput(target.visibleUntil), [target]);
  const [from, setFrom] = useState(initialFrom);
  const [until, setUntil] = useState(initialUntil);
  const [showErrors, setShowErrors] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState('');
  const [previewLocale, setPreviewLocale] = usePreviewLocale();
  const days = admin.maxVisibilityDays;
  // Once the display has begun its start cannot move.
  const opened =
    !target.visibleFrom || Date.parse(target.visibleFrom) <= Date.now();

  const contentChanged =
    JSON.stringify(content) !== JSON.stringify(target.initial);
  const fromChanged = !opened && from !== initialFrom;
  const windowChanged = fromChanged || until !== initialUntil;
  const contentErrors = contentChanged
    ? validateContent(content, freeformKey)
    : {};
  const windowErrors = windowChanged
    ? validateWindow(opened ? initialFrom : from, until, days, { opened })
    : {};
  const valid =
    Object.keys(contentErrors).length === 0 &&
    Object.keys(windowErrors).length === 0;
  const preview = useInlinePreview(content, previewLocale);
  const busy =
    correct.isPending || changeWindow.isPending || withdraw.isPending;

  useEffect(() => setContent(target.initial), [target.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const contentRequest = (): PublishAnnouncementRequest => ({
    ...target.base,
    ...contentToTemplate(content, freeformKey),
  });

  const save = async () => {
    setShowErrors(true);
    if (!valid) return;
    if (!contentChanged && !windowChanged) {
      onCancel();
      return;
    }
    try {
      if (contentChanged) {
        const request = contentRequest();
        await correct.mutateAsync({ id: target.id, request });
        rememberCorrection(storageScope, target.id, request);
      }
      if (windowChanged) {
        const saved = await changeWindow.mutateAsync({
          id: target.id,
          request: {
            ...(fromChanged
              ? { visibleFrom: new Date(from).toISOString() }
              : {}),
            visibleUntil: new Date(until).toISOString(),
          },
        });
        rememberAdmin(storageScope, target.id, saved);
      }
      onDone(contentRequest(), { removed: false });
    } catch {
      // Shown below from the mutation state.
    }
  };

  const doWithdraw = async () => {
    try {
      const trimmed = reason.trim();
      const saved = await withdraw.mutateAsync({
        id: target.id,
        request: trimmed ? { reason: trimmed } : {},
      });
      rememberAdmin(storageScope, target.id, saved);
      setConfirming(false);
      onDone(contentRequest(), { removed: true });
    } catch {
      setConfirming(false);
    }
  };

  if (target.withdrawn) {
    return (
      <div className={styles.correction}>
        <Notice tone='warning' title={t('edit.withdrawn')} />
        <div className={cx(styles.inlineRow, styles.editorActions)}>
          <Button onClick={onCancel}>{t('edit.cancel')}</Button>
        </div>
      </div>
    );
  }

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

      <div className={styles.editWindow}>
        <strong>{t('edit.window')}</strong>
        <div className={styles.editWindowRow}>
          <Field
            label={t('announce.from')}
            hint={opened ? t('edit.window.fromLocked') : undefined}
            error={
              showErrors && windowErrors.from
                ? windowErrors.from === 'past'
                  ? t('edit.window.fromPast')
                  : t('announce.from.error')
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
                disabled={opened}
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
              showErrors ? untilMessage(windowErrors.until, t, days) : undefined
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

      {correct.isError && <ErrorNotice error={correct.error} t={t} />}
      {changeWindow.isError && <ErrorNotice error={changeWindow.error} t={t} />}
      {withdraw.isError && <ErrorNotice error={withdraw.error} t={t} />}
      {preview.error !== null && <ErrorNotice error={preview.error} t={t} />}
      {confirming ? (
        <div
          className={cx(styles.editorActions, styles.editConfirm)}
          role='alertdialog'
          aria-label={t('edit.remove')}
        >
          <span>{t('edit.remove.confirm')}</span>
          <Field label={t('edit.remove.reason')}>
            {({ id, describedBy, invalid }) => (
              <TextInput
                id={id}
                aria-describedby={describedBy}
                invalid={invalid}
                maxLength={500}
                value={reason}
                onChange={event => setReason(event.target.value)}
              />
            )}
          </Field>
          <div className={styles.inlineRow}>
            <Button
              variant='primary'
              className={styles.editRemoveConfirm}
              disabled={busy}
              onClick={() => void doWithdraw()}
            >
              {busy ? t('edit.saving') : t('edit.remove')}
            </Button>
            <Button disabled={busy} onClick={() => setConfirming(false)}>
              {t('announce.confirm.back')}
            </Button>
          </div>
        </div>
      ) : (
        <div className={cx(styles.inlineRow, styles.editorActions)}>
          <Button variant='primary' disabled={busy} onClick={() => void save()}>
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
          <Button
            className={styles.editRemove}
            disabled={busy}
            onClick={() => setConfirming(true)}
          >
            {t('edit.remove')}
          </Button>
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

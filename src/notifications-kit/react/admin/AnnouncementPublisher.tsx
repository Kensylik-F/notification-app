import { useRef, useState } from 'react';

import {
  buildPublishRequest,
  contentToTemplate,
  isTerminal,
  progressRatio,
  validateContent,
  validatePublish,
} from '../../core';
import type {
  AnnouncementAdmin,
  AudienceType,
  MessageContent,
  OperationResponse,
  PublishAnnouncementRequest,
  PublishDraft,
} from '../../core';
import { useNotificationsContext } from '../context';
import { formatDateTime, formatDay } from '../format';
import type { AnnouncementPresentation } from '../presentation';
import { useKitPreview } from '../preview';
import {
  Button,
  Dialog,
  Icon,
  Spinner,
  StateBlock,
  cx,
  useDomId,
} from '../primitives';
import styles from './admin.module.css';
import { Combobox, Dropdown } from './Dropdown';
import { ErrorNotice } from './errors';
import {
  Field,
  FieldSet,
  FormSection,
  Notice,
  Segmented,
  TextInput,
  revealFirstError,
  toLocalInput,
} from './forms';
import {
  useCancelEmailRun,
  useCorrectAnnouncement,
  useEmailRun,
  usePublishAnnouncement,
} from './hooks';
import {
  MessageFields,
  MessageModeSwitch,
  initialContent,
} from './MessageFields';
import {
  PreviewButton,
  PreviewStrip,
  previewAnnouncementEntry,
  useClearPreviewOnLeave,
  useFetchPreview,
  usePreviewRequest,
} from './Preview';

const DEFAULT_WINDOW_DAYS = 7;
const CONTENT_KEYS = ['subject', 'body', 'templateKey', 'variables'] as const;
const SHOWN: Exclude<AnnouncementPresentation, 'none'>[] = [
  'corner',
  'modal',
  'toast',
];

interface PublisherState {
  category: string;
  audienceType: AudienceType;
  audienceValue: string;
  content: MessageContent;
  fromNow: boolean;
  visibleFrom: string;
  visibleUntil: string;
}

function initialState(freeformKey: string | undefined): PublisherState {
  return {
    category: '',
    audienceType: 'EVERYONE',
    audienceValue: '',
    content: initialContent(freeformKey),
    fromNow: true,
    visibleFrom: '',
    visibleUntil: toLocalInput(
      new Date(Date.now() + DEFAULT_WINDOW_DAYS * 86_400_000)
    ),
  };
}

function toDraft(state: PublisherState): PublishDraft {
  return {
    category: state.category,
    audienceType: state.audienceType,
    audienceValue: state.audienceValue,
    content: state.content,
    visibleFrom: state.fromNow ? null : state.visibleFrom,
    visibleUntil: state.visibleUntil,
  };
}

function useLabels() {
  const { admin, t } = useNotificationsContext();
  return {
    category: (code: string) =>
      admin.categories.find(c => c.code === code)?.label ?? code,
    role: (code: string | null | undefined) =>
      admin.roles.find(r => r.code === code)?.label ?? code ?? '',
    audience: (type: AudienceType | null | undefined, value?: string | null) =>
      type === 'ROLE'
        ? `${t('announce.audience.ROLE')}: ${
            admin.roles.find(r => r.code === value)?.label ?? value ?? ''
          }`
        : t('announce.audience.EVERYONE'),
  };
}

/** How the host shows an announcement of this category. */
function usePresentationOf() {
  const { resolvePresentation } = useNotificationsContext();
  return (category: string): AnnouncementPresentation =>
    resolvePresentation({
      id: 'probe',
      category: category.trim() || null,
      categoryClass: null,
      locale: null,
      subject: null,
      bodyText: null,
      bodyHtml: null,
      publishedAt: null,
      visibleFrom: null,
      visibleUntil: null,
      dismissed: false,
    });
}

/**
 * Plays an announcement out on this page, where and how it would show:
 * the service renders it for the in-app channel, the kit puts it among the
 * overlays (the deck, a dialog or a strip) marked as a preview.
 */
function useAnnouncementPreview(content: MessageContent) {
  const [, setKitPreview] = useKitPreview();
  const fetchPreview = useFetchPreview();
  const requestFor = usePreviewRequest(content);
  const presentationOf = usePresentationOf();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [none, setNone] = useState(false);

  const run = async (category: string, visibleUntil: string | null) => {
    const request = requestFor('IN_APP');
    if (!request) return;
    setBusy(true);
    setError(null);
    setNone(false);
    try {
      const result = await fetchPreview(request);
      const until = visibleUntil ? new Date(visibleUntil) : null;
      const entry = previewAnnouncementEntry(result, {
        category: category.trim() || null,
        visibleUntil:
          until && !Number.isNaN(until.getTime()) ? until.toISOString() : null,
      });
      const presentation = presentationOf(category);
      if (presentation === 'none') setNone(true);
      else setKitPreview({ kind: 'announcement', entry, presentation });
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  };

  return {
    run,
    busy,
    error,
    none,
    clear: () => {
      setError(null);
      setNone(false);
    },
  };
}

const PRESENTATION_ICON: Record<
  Exclude<AnnouncementPresentation, 'none'>,
  JSX.Element
> = {
  corner: (
    <svg
      width='28'
      height='20'
      viewBox='0 0 28 20'
      fill='none'
      aria-hidden='true'
    >
      <rect x='.5' y='.5' width='27' height='19' rx='3' stroke='currentColor' />
      <rect x='15' y='11' width='10' height='6' rx='1.5' fill='currentColor' />
    </svg>
  ),
  modal: (
    <svg
      width='28'
      height='20'
      viewBox='0 0 28 20'
      fill='none'
      aria-hidden='true'
    >
      <rect x='.5' y='.5' width='27' height='19' rx='3' stroke='currentColor' />
      <rect x='8' y='5' width='12' height='10' rx='1.5' fill='currentColor' />
    </svg>
  ),
  toast: (
    <svg
      width='28'
      height='20'
      viewBox='0 0 28 20'
      fill='none'
      aria-hidden='true'
    >
      <rect x='.5' y='.5' width='27' height='19' rx='3' stroke='currentColor' />
      <rect x='5' y='3' width='18' height='4' rx='1.5' fill='currentColor' />
    </svg>
  ),
};

export interface AnnouncementPublisherProps {
  onPublished?: (announcement: AnnouncementAdmin) => void;
}

/** Publish an announcement: the message, who sees it and how, how long. */
export function AnnouncementPublisher({
  onPublished,
}: AnnouncementPublisherProps) {
  const { t, admin, locale } = useNotificationsContext();
  const freeformKey = admin.freeformTemplateKey;
  const [state, setState] = useState<PublisherState>(() =>
    initialState(freeformKey)
  );
  const [showErrors, setShowErrors] = useState(false);
  const [showContentErrors, setShowContentErrors] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [published, setPublished] = useState<{
    announcement: AnnouncementAdmin;
    request: PublishAnnouncementRequest;
  } | null>(null);
  const publish = usePublishAnnouncement();
  const labels = useLabels();
  const presentationOf = usePresentationOf();
  const [kitPreview, setKitPreview] = useKitPreview();
  const preview = useAnnouncementPreview(state.content);
  const confirmTitle = useDomId('nk-confirm');
  const publishRef = useRef<HTMLButtonElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  useClearPreviewOnLeave();

  if (!admin.permissions.announce) {
    return (
      <div className={styles.root}>
        <StateBlock
          title={t('admin.noAccess')}
          note={t('admin.noAccess.announce')}
        />
      </div>
    );
  }

  if (published) {
    return (
      <PublishResult
        announcement={published.announcement}
        request={published.request}
        onNew={() => {
          setPublished(null);
          setState(initialState(freeformKey));
          setShowErrors(false);
          setShowContentErrors(false);
          publish.reset();
        }}
      />
    );
  }

  const draft = toDraft(state);
  const errors = validatePublish(draft, {
    freeformTemplateKey: freeformKey,
    maxVisibilityDays: admin.maxVisibilityDays,
  });
  const visible = showErrors
    ? errors
    : showContentErrors
      ? Object.fromEntries(
          CONTENT_KEYS.filter(k => errors[k]).map(k => [k, errors[k]])
        )
      : {};
  const valid = Object.keys(errors).length === 0;
  const contentValid = CONTENT_KEYS.every(k => !errors[k]);
  const update = (patch: Partial<PublisherState>) =>
    setState(current => ({ ...current, ...patch }));
  const days = admin.maxVisibilityDays;
  const announcementCategories = admin.categories.filter(c => c.announcement);
  const presentation = presentationOf(state.category);

  const untilError =
    visible.visibleUntil === 'tooLong'
      ? t('announce.until.error.tooLong', { days })
      : visible.visibleUntil === 'beforeStart'
        ? t('announce.until.error.beforeStart')
        : visible.visibleUntil
          ? t('announce.until.error.required')
          : undefined;

  const doPublish = () => {
    const request = buildPublishRequest(draft, freeformKey);
    publish.mutate(request, {
      onSuccess: announcement => {
        setConfirming(false);
        setKitPreview(null);
        setPublished({ announcement, request });
        onPublished?.(announcement);
      },
      onError: () => setConfirming(false),
    });
  };

  const audienceText =
    state.audienceType === 'ROLE' && state.audienceValue.trim()
      ? t('announce.audience.roleNamed', {
          role: labels.role(state.audienceValue),
        })
      : t('announce.audience.EVERYONE');
  const whoSees =
    state.audienceType === 'ROLE' && state.audienceValue.trim()
      ? t('preview.strip.announceRole', {
          role: labels.role(state.audienceValue),
        })
      : t('preview.strip.announceEveryone');
  const until = formatDay(
    state.visibleUntil ? new Date(state.visibleUntil).toISOString() : null,
    Date.now(),
    locale
  );
  const previewOn = kitPreview?.kind === 'announcement';

  return (
    <div className={cx(styles.root, styles.composer)} ref={rootRef}>
      {previewOn && (
        <PreviewStrip onExit={() => setKitPreview(null)}>
          <strong>{t('preview.strip.title')}</strong> {whoSees}{' '}
          {t('preview.strip.notPublished')}
        </PreviewStrip>
      )}
      <form
        className={styles.form}
        noValidate
        onSubmit={event => {
          event.preventDefault();
        }}
      >
        <FormSection
          title={t('compose.section.message')}
          aside={
            <MessageModeSwitch
              value={state.content}
              onChange={content => update({ content })}
            />
          }
        >
          <MessageFields
            value={state.content}
            onChange={content => update({ content })}
            errors={visible}
          />
        </FormSection>

        <FormSection title={t('announce.section.who')}>
          <div className={styles.grid2}>
            <FieldSet legend={t('announce.audience')}>
              <Segmented
                name='nk-audience'
                label={t('announce.audience')}
                value={state.audienceType}
                options={[
                  { value: 'EVERYONE', label: t('announce.audience.EVERYONE') },
                  { value: 'ROLE', label: t('announce.audience.ROLE') },
                ]}
                onChange={audienceType => update({ audienceType })}
              />
            </FieldSet>
            {state.audienceType === 'ROLE' && (
              <Field
                label={t('announce.role')}
                required
                error={visible.audience ? t('announce.role.error') : undefined}
              >
                {({ id, describedBy, invalid }) =>
                  admin.roles.length > 0 ? (
                    <Dropdown
                      id={id}
                      describedBy={describedBy}
                      invalid={invalid}
                      value={state.audienceValue}
                      placeholder={t('announce.role.placeholder')}
                      options={admin.roles.map(r => ({
                        value: r.code,
                        label: r.label,
                      }))}
                      onChange={audienceValue => update({ audienceValue })}
                    />
                  ) : (
                    <TextInput
                      id={id}
                      aria-describedby={describedBy}
                      invalid={invalid}
                      value={state.audienceValue}
                      spellCheck={false}
                      onChange={event =>
                        update({ audienceValue: event.target.value })
                      }
                    />
                  )
                }
              </Field>
            )}
          </div>
          <Field
            label={t('announce.category')}
            required
            hint={t('announce.category.hint')}
            error={visible.category ? t('announce.category.error') : undefined}
          >
            {({ id, describedBy, invalid }) => (
              <Combobox
                id={id}
                describedBy={describedBy}
                invalid={invalid}
                value={state.category}
                placeholder={t('compose.category.placeholder')}
                options={announcementCategories.map(c => ({
                  value: c.code,
                  label: c.label,
                  hint: c.code,
                }))}
                onChange={category => update({ category })}
              />
            )}
          </Field>
          <div
            className={styles.presentations}
            role='group'
            aria-label={t('announce.presentation')}
          >
            {SHOWN.map(kind => (
              <div
                key={kind}
                className={styles.presentation}
                data-active={presentation === kind || undefined}
                aria-current={presentation === kind ? 'true' : undefined}
              >
                {PRESENTATION_ICON[kind]}
                {t(`presentation.${kind}`)}
              </div>
            ))}
          </div>
          <span className={styles.fieldHint}>
            {presentation === 'none'
              ? t('announce.presentation.none')
              : t('announce.presentation.hint')}
          </span>
        </FormSection>

        <FormSection title={t('announce.section.when')}>
          <div className={styles.grid2}>
            <div className={styles.stack}>
              <FieldSet legend={t('announce.from')}>
                <Segmented
                  name='nk-from'
                  label={t('announce.from')}
                  value={state.fromNow ? 'now' : 'at'}
                  options={[
                    { value: 'now', label: t('announce.from.now') },
                    { value: 'at', label: t('announce.from.at') },
                  ]}
                  onChange={value =>
                    update({
                      fromNow: value === 'now',
                      visibleFrom:
                        value === 'at' && !state.visibleFrom
                          ? toLocalInput(new Date(Date.now() + 60 * 60_000))
                          : state.visibleFrom,
                    })
                  }
                />
              </FieldSet>
              {!state.fromNow && (
                <Field
                  label={t('announce.from.date')}
                  required
                  error={
                    visible.visibleFrom ? t('announce.from.error') : undefined
                  }
                >
                  {({ id, describedBy, invalid }) => (
                    <TextInput
                      id={id}
                      type='datetime-local'
                      className={styles.dateInput}
                      aria-describedby={describedBy}
                      invalid={invalid}
                      value={state.visibleFrom}
                      onChange={event =>
                        update({ visibleFrom: event.target.value })
                      }
                    />
                  )}
                </Field>
              )}
            </div>
            <Field
              label={t('announce.until')}
              required
              hint={t('announce.until.hint', { days })}
              error={untilError}
            >
              {({ id, describedBy, invalid }) => (
                <TextInput
                  id={id}
                  type='datetime-local'
                  className={styles.dateInput}
                  aria-describedby={describedBy}
                  invalid={invalid}
                  value={state.visibleUntil}
                  onChange={event =>
                    update({ visibleUntil: event.target.value })
                  }
                />
              )}
            </Field>
          </div>
        </FormSection>

        {publish.isError && <ErrorNotice error={publish.error} t={t} />}
        {preview.error !== null && (
          <ErrorNotice
            error={preview.error}
            t={t}
            action={
              <Button size='sm' onClick={preview.clear}>
                {t('preview.close')}
              </Button>
            }
          />
        )}
        {preview.none && (
          <Notice tone='warning' title={t('announce.presentation.none')} />
        )}
      </form>

      <div className={styles.actionBar}>
        <span className={styles.actionSummary}>
          {showErrors && !valid ? (
            <span className={styles.fieldError}>{t('compose.fixErrors')}</span>
          ) : (
            [
              audienceText,
              presentation !== 'none'
                ? t(`presentation.${presentation}.short`)
                : null,
              until ? t('announce.summary.until', { date: until }) : null,
            ]
              .filter(Boolean)
              .join(' · ')
          )}
        </span>
        <PreviewButton
          channels={['IN_APP']}
          busy={preview.busy}
          disabledReason={
            admin.permissions.preview ? undefined : t('preview.noAccess')
          }
          onPick={() => {
            if (!contentValid) {
              setShowContentErrors(true);
              revealFirstError(rootRef.current);
              return;
            }
            void preview.run(state.category, state.visibleUntil);
          }}
        />
        <Button
          variant='primary'
          size='lg'
          onClick={() => {
            setShowErrors(true);
            if (valid) setConfirming(true);
            else revealFirstError(rootRef.current);
          }}
        >
          {t('announce.publish')}
        </Button>
      </div>

      <Dialog
        open={confirming}
        onClose={publish.isPending ? undefined : () => setConfirming(false)}
        labelledBy={confirmTitle}
        role='alertdialog'
        width={440}
        initialFocus={publishRef}
      >
        <div className={styles.confirmHead}>
          <span className={styles.confirmIcon} aria-hidden='true'>
            <Icon name='send' size={18} />
          </span>
          <h2 id={confirmTitle} className={styles.confirmTitle}>
            {t('announce.confirm.title')}
          </h2>
        </div>
        <p className={styles.confirmText}>
          {state.audienceType === 'EVERYONE'
            ? t('announce.confirm.everyone')
            : t('announce.confirm.role', {
                role: labels.role(state.audienceValue),
              })}{' '}
          {t('announce.confirm.final')}
        </p>
        <div className={styles.confirmActions}>
          <Button
            disabled={publish.isPending}
            onClick={() => setConfirming(false)}
          >
            {t('announce.confirm.back')}
          </Button>
          <Button
            ref={publishRef}
            variant='primary'
            disabled={publish.isPending}
            onClick={doPublish}
          >
            {publish.isPending
              ? t('announce.publishing')
              : t('announce.publish')}
          </Button>
        </div>
      </Dialog>
    </div>
  );
}

// ----------------------------------------------------------------- result

function PublishResult({
  announcement,
  request,
  onNew,
}: {
  announcement: AnnouncementAdmin;
  request: PublishAnnouncementRequest;
  onNew: () => void;
}) {
  const { t, locale } = useNotificationsContext();
  const labels = useLabels();
  const [current, setCurrent] = useState(request);
  const [correcting, setCorrecting] = useState(false);
  const [corrected, setCorrected] = useState(0);
  const id = announcement.id ?? null;

  const from = formatDateTime(
    announcement.visibleFrom ?? announcement.publishedAt ?? null,
    locale
  );
  const until = formatDateTime(announcement.visibleUntil ?? null, locale);

  return (
    <div className={cx(styles.root, styles.stack, styles.result)}>
      <Notice
        tone='success'
        title={t('announce.published')}
        action={
          <Button variant='primary' icon='plus' onClick={onNew}>
            {t('announce.new')}
          </Button>
        }
      >
        {corrected > 0 && (
          <span>{t('announce.corrected', { count: corrected })}</span>
        )}
      </Notice>

      <div className={styles.card}>
        <dl className={styles.facts}>
          <dt>{t('announce.category')}</dt>
          <dd>{labels.category(current.category)}</dd>
          <dt>{t('announce.audience')}</dt>
          <dd>
            {labels.audience(
              announcement.audienceType,
              announcement.audienceValue
            )}
          </dd>
          <dt>{t('announce.window.label')}</dt>
          <dd>
            {t('announce.window', { from: from ?? '—', until: until ?? '—' })}
          </dd>
          {announcement.id && (
            <>
              <dt>ID</dt>
              <dd>{announcement.id}</dd>
            </>
          )}
        </dl>
        {id && announcement.emailRunId && (
          <EmailRunProgress announcementId={id} />
        )}
        {id && !correcting && (
          <div>
            <Button onClick={() => setCorrecting(true)}>
              {t('announce.correct')}
            </Button>
          </div>
        )}
        {id && correcting && (
          <CorrectionForm
            id={id}
            request={current}
            onCancel={() => setCorrecting(false)}
            onDone={next => {
              setCurrent(next);
              setCorrected(n => n + 1);
              setCorrecting(false);
            }}
          />
        )}
      </div>
    </div>
  );
}

function CorrectionForm({
  id,
  request,
  onCancel,
  onDone,
}: {
  id: string;
  request: PublishAnnouncementRequest;
  onCancel: () => void;
  onDone: (request: PublishAnnouncementRequest) => void;
}) {
  const { t, admin } = useNotificationsContext();
  const freeformKey = admin.freeformTemplateKey;
  const correct = useCorrectAnnouncement();
  const [content, setContent] = useState<MessageContent>(() => {
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
  });
  const [showErrors, setShowErrors] = useState(false);
  const errors = validateContent(content, freeformKey);
  const preview = useAnnouncementPreview(content);

  return (
    <div className={styles.correction}>
      <div className={styles.correctionHead}>
        <span className={styles.sectionTitle}>{t('announce.correct')}</span>
        <MessageModeSwitch value={content} onChange={setContent} />
      </div>
      <p className={styles.muted}>{t('announce.correct.hint')}</p>
      <MessageFields
        value={content}
        onChange={setContent}
        errors={showErrors ? errors : {}}
      />
      {correct.isError && <ErrorNotice error={correct.error} t={t} />}
      {preview.error !== null && <ErrorNotice error={preview.error} t={t} />}
      <div className={styles.inlineRow}>
        <Button
          variant='primary'
          disabled={correct.isPending}
          onClick={() => {
            setShowErrors(true);
            if (Object.keys(errors).length) return;
            // The audience and the window go back unchanged.
            const next = {
              ...request,
              ...contentToTemplate(content, freeformKey),
            };
            correct.mutate(
              { id, request: next },
              { onSuccess: () => onDone(next) }
            );
          }}
        >
          {t('announce.correct.save')}
        </Button>
        <Button
          icon='eye'
          disabled={preview.busy || !admin.permissions.preview}
          onClick={() => {
            setShowErrors(true);
            if (Object.keys(errors).length) return;
            void preview.run(request.category, request.visibleUntil);
          }}
        >
          {t('preview.title')}
        </Button>
        <Button variant='ghost' disabled={correct.isPending} onClick={onCancel}>
          {t('announce.correct.cancel')}
        </Button>
      </div>
    </div>
  );
}

// -------------------------------------------------------------- email run

const STATUS_TONE: Record<string, string> = {
  SUCCEEDED: 'success',
  FAILED: 'error',
  CANCELLED: 'warning',
  EXPIRED: 'warning',
};

/** The email fan-out of one announcement: progress, outcome, stop. */
export function EmailRunProgress({
  announcementId,
}: {
  announcementId: string;
}) {
  const { t, admin } = useNotificationsContext();
  const run = useEmailRun(announcementId);
  const cancel = useCancelEmailRun();
  const [confirm, setConfirm] = useState(false);

  if (run.isPending) {
    return (
      <div className={styles.inlineRow}>
        <Spinner label={t('emailRun.title')} />
        <span className={styles.muted}>{t('emailRun.title')}</span>
      </div>
    );
  }
  if (run.isError) {
    return (
      <ErrorNotice
        error={run.error}
        t={t}
        action={
          <Button onClick={() => void run.refetch()}>{t('inbox.retry')}</Button>
        }
      />
    );
  }

  const operation: OperationResponse = run.data.operation;
  const status = operation.status ?? 'PENDING';
  const done = isTerminal(operation);
  const ratio = progressRatio(operation);
  const completed = operation.progress?.completed ?? 0;
  const total = operation.progress?.total ?? null;

  return (
    <div className={styles.run}>
      <div className={styles.runHead}>
        <span>
          <strong>{t('emailRun.title')}</strong>
          {' · '}
          <span className={styles.runStatus} data-tone={STATUS_TONE[status]}>
            {t(`emailRun.status.${status}`)}
          </span>
        </span>
        <span className={styles.muted}>
          {total !== null
            ? t('emailRun.progress', { completed, total })
            : t('emailRun.progressNoTotal', { completed })}
        </span>
      </div>
      <div
        className={styles.progress}
        role='progressbar'
        aria-label={t('emailRun.title')}
        aria-valuemin={0}
        aria-valuemax={total ?? undefined}
        aria-valuenow={total !== null ? completed : undefined}
        data-indeterminate={(!done && ratio === null) || undefined}
      >
        <span
          style={{
            width: `${Math.round((done ? (ratio ?? 1) : (ratio ?? 0)) * 100)}%`,
          }}
        />
      </div>
      {operation.failure && (
        <Notice tone='error'>
          {operation.failure.detail ?? operation.failure.code}
        </Notice>
      )}
      {!done &&
        admin.permissions.announce &&
        (confirm ? (
          <div className={styles.confirm}>
            <span>{t('emailRun.stopConfirm')}</span>
            <div className={styles.inlineRow}>
              <Button
                variant='primary'
                disabled={cancel.isPending}
                onClick={() =>
                  cancel.mutate(announcementId, {
                    onSettled: () => setConfirm(false),
                  })
                }
              >
                {t('emailRun.stop')}
              </Button>
              <Button onClick={() => setConfirm(false)}>
                {t('announce.confirm.back')}
              </Button>
            </div>
          </div>
        ) : (
          <div>
            <Button
              disabled={cancel.isSuccess}
              onClick={() => setConfirm(true)}
            >
              {cancel.isSuccess ? t('emailRun.stopping') : t('emailRun.stop')}
            </Button>
          </div>
        ))}
      {cancel.isError && <ErrorNotice error={cancel.error} t={t} />}
    </div>
  );
}

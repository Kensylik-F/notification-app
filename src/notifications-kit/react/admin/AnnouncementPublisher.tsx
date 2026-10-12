import { useMemo, useState } from 'react';

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
import { formatDateTime } from '../format';
import { Button, Spinner, StateBlock, cx } from '../primitives';
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
  toLocalInput,
} from './forms';
import {
  useCancelEmailRun,
  useCorrectAnnouncement,
  useEmailRun,
  usePublishAnnouncement,
} from './hooks';
import { MessageFields, initialContent } from './MessageFields';
import { TemplatePreview } from './TemplatePreview';

const DEFAULT_WINDOW_DAYS = 7;

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
    audience: (type: AudienceType | null | undefined, value?: string | null) =>
      type === 'ROLE'
        ? `${t('announce.audience.ROLE')}: ${
            admin.roles.find(r => r.code === value)?.label ?? value ?? ''
          }`
        : t('announce.audience.EVERYONE'),
  };
}

export interface AnnouncementPublisherProps {
  onPublished?: (announcement: AnnouncementAdmin) => void;
}

/** Publish an announcement: category, audience, message, how long to show. */
export function AnnouncementPublisher({
  onPublished,
}: AnnouncementPublisherProps) {
  const { t, admin } = useNotificationsContext();
  const freeformKey = admin.freeformTemplateKey;
  const [state, setState] = useState<PublisherState>(() =>
    initialState(freeformKey)
  );
  const [showErrors, setShowErrors] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [published, setPublished] = useState<{
    announcement: AnnouncementAdmin;
    request: PublishAnnouncementRequest;
  } | null>(null);
  const publish = usePublishAnnouncement();
  const labels = useLabels();

  const preview = useMemo(
    () => contentToTemplate(state.content, freeformKey),
    [state.content, freeformKey]
  );

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
  const visible = showErrors ? errors : {};
  const valid = Object.keys(errors).length === 0;
  const update = (patch: Partial<PublisherState>) =>
    setState(current => ({ ...current, ...patch }));
  const days = admin.maxVisibilityDays;
  const announcementCategories = admin.categories.filter(c => c.announcement);

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
        setPublished({ announcement, request });
        onPublished?.(announcement);
      },
      onError: () => setConfirming(false),
    });
  };

  const previewIdle =
    state.content.mode === 'freeform' &&
    !state.content.subject.trim() &&
    !state.content.bodyText.trim();

  return (
    <div className={cx(styles.root, styles.workspace)}>
      <form
        className={styles.form}
        noValidate
        onSubmit={event => {
          event.preventDefault();
          setShowErrors(true);
          if (valid) setConfirming(true);
        }}
      >
        <FormSection step={1} title={t('announce.section.what')}>
          <MessageFields
            value={state.content}
            onChange={content => update({ content })}
            errors={visible}
          />
        </FormSection>

        <FormSection step={2} title={t('announce.section.who')}>
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
                options={announcementCategories.map(c => ({
                  value: c.code,
                  label: c.label,
                  hint: c.code,
                }))}
                onChange={category => update({ category })}
              />
            )}
          </Field>
          <FieldSet legend={t('announce.audience')}>
            <Segmented
              name='nk-audience'
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
        </FormSection>

        <FormSection step={3} title={t('announce.section.when')}>
          <Segmented
            name='nk-from'
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
          <div className={styles.grid2}>
            {!state.fromNow && (
              <Field
                label={t('announce.from')}
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

        {confirming ? (
          <div className={styles.confirm} role='alertdialog' aria-modal='false'>
            <strong>{t('announce.confirm.title')}</strong>
            <span>
              {state.audienceType === 'EVERYONE'
                ? t('announce.confirm.everyone')
                : t('announce.confirm.role', {
                    role: labels.audience('ROLE', state.audienceValue),
                  })}{' '}
              {t('announce.confirm.final')}
            </span>
            <div className={styles.inlineRow}>
              <Button
                variant='primary'
                disabled={publish.isPending}
                onClick={doPublish}
              >
                {publish.isPending
                  ? t('announce.publishing')
                  : t('announce.publish')}
              </Button>
              <Button
                disabled={publish.isPending}
                onClick={() => setConfirming(false)}
              >
                {t('announce.confirm.back')}
              </Button>
            </div>
          </div>
        ) : (
          <div className={styles.submitBar}>
            <span className={styles.muted}>
              {showErrors && !valid ? t('compose.fixErrors') : ''}
            </span>
            <Button type='submit' variant='primary'>
              {t('announce.publish')}
            </Button>
          </div>
        )}
      </form>

      <TemplatePreview
        templateKey={preview.templateKey}
        variables={preview.variables}
        channels={['IN_APP']}
        idle={previewIdle}
      />
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
  const preview = useMemo(
    () => contentToTemplate(content, freeformKey),
    [content, freeformKey]
  );

  return (
    <div className={styles.correction}>
      <p className={styles.muted}>{t('announce.correct.hint')}</p>
      <div className={styles.workspace}>
        <div className={styles.stack}>
          <MessageFields
            value={content}
            onChange={setContent}
            errors={showErrors ? errors : {}}
          />
          {correct.isError && <ErrorNotice error={correct.error} t={t} />}
          <div className={styles.inlineRow}>
            <Button
              variant='primary'
              disabled={correct.isPending}
              onClick={() => {
                setShowErrors(true);
                if (Object.keys(errors).length) return;
                // The audience and the window go back unchanged.
                const next = { ...request, ...preview };
                correct.mutate(
                  { id, request: next },
                  { onSuccess: () => onDone(next) }
                );
              }}
            >
              {t('announce.correct.save')}
            </Button>
            <Button disabled={correct.isPending} onClick={onCancel}>
              {t('announce.correct.cancel')}
            </Button>
          </div>
        </div>
        <TemplatePreview
          templateKey={preview.templateKey}
          variables={preview.variables}
          channels={['IN_APP']}
        />
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

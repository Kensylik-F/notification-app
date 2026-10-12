import { useMemo, useState } from 'react';

import {
  SERVICE_TEMPLATES,
  isTerminal,
  missingVariables,
  progressRatio,
  templateKeyOf,
  variablesOf,
} from '../../core';
import type { OperationResponse } from '../../core';
import { useNotificationsContext } from '../context';
import { formatDateTime } from '../format';
import { Button, Spinner, cx } from '../primitives';
import styles from './admin.module.css';
import { ErrorNotice } from './errors';
import { Notice } from './forms';
import {
  useCancelEmailRun,
  useCorrectAnnouncement,
  useEmailRun,
  usePublishedAnnouncements,
} from './hooks';
import type { PublishedRecord } from './hooks';
import { TemplateFields } from './TemplateFields';
import type { TemplateState } from './TemplateFields';
import { TemplatePreview } from './TemplatePreview';

/** Announcements published from this tab, with their email run. */
export function PublishedAnnouncements() {
  const { t } = useNotificationsContext();
  const { data: records = [] } = usePublishedAnnouncements();

  return (
    <section className={cx(styles.root, styles.stack)}>
      <header className={styles.stack}>
        <h3 className={styles.sectionTitle}>{t('announce.session.title')}</h3>
        <p className={styles.muted}>{t('announce.session.hint')}</p>
      </header>
      {records.length === 0 ? (
        <p className={styles.muted}>{t('announce.session.empty')}</p>
      ) : (
        <ul className={styles.cards}>
          {records.map(record => (
            <PublishedCard
              key={record.announcement.id ?? record.request.visibleUntil}
              record={record}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function PublishedCard({ record }: { record: PublishedRecord }) {
  const { t, locale, admin } = useNotificationsContext();
  const [correcting, setCorrecting] = useState(false);
  const { announcement, request } = record;
  const id = announcement.id ?? null;

  const category =
    admin.categories.find(c => c.code === request.category)?.label ??
    request.category;
  const audience =
    request.audienceType === 'ROLE'
      ? `${t('announce.audience.ROLE')}: ${
          admin.roles.find(r => r.code === request.audienceValue)?.label ??
          request.audienceValue
        }`
      : t('announce.audience.EVERYONE');
  const from = formatDateTime(
    announcement.visibleFrom ??
      request.visibleFrom ??
      announcement.publishedAt ??
      null,
    locale
  );
  const until = formatDateTime(
    announcement.visibleUntil ?? request.visibleUntil,
    locale
  );
  const template = request.templateKey;

  return (
    <li className={styles.card}>
      <div className={styles.cardHead}>
        <div className={styles.stackTight}>
          <strong>{category}</strong>
          <span className={styles.muted}>
            {[
              audience,
              admin.templateLabels[template] ?? template,
              t('announce.window', { from: from ?? '—', until: until ?? '—' }),
            ].join(' · ')}
          </span>
          {record.corrections > 0 && (
            <span className={styles.muted}>
              {t('announce.corrected', { count: record.corrections })}
            </span>
          )}
        </div>
        {id && !correcting && (
          <Button variant='ghost' onClick={() => setCorrecting(true)}>
            {t('announce.correct')}
          </Button>
        )}
      </div>

      {id && announcement.emailRunId && (
        <EmailRunProgress announcementId={id} />
      )}

      {id && correcting && (
        <CorrectionForm
          id={id}
          record={record}
          onDone={() => setCorrecting(false)}
        />
      )}
    </li>
  );
}

function CorrectionForm({
  id,
  record,
  onDone,
}: {
  id: string;
  record: PublishedRecord;
  onDone: () => void;
}) {
  const { t } = useNotificationsContext();
  const correct = useCorrectAnnouncement();
  const catalogue = useMemo(
    () => SERVICE_TEMPLATES.filter(item => item.announcement),
    []
  );
  const [state, setState] = useState<TemplateState>(() => {
    const known =
      SERVICE_TEMPLATES.find(item => item.key === record.request.templateKey) ??
      null;
    const sent = Object.fromEntries(
      Object.entries(record.request.variables ?? {}).map(([k, v]) => [
        k,
        String(v ?? ''),
      ])
    );
    return known
      ? {
          template: known,
          customMode: false,
          customTemplateKey: '',
          variables: sent,
          customVariables: [],
        }
      : {
          template: null,
          customMode: true,
          customTemplateKey: record.request.templateKey,
          variables: {},
          customVariables: Object.entries(sent).map(([name, value]) => ({
            name,
            value,
          })),
        };
  });
  const [showErrors, setShowErrors] = useState(false);

  const key = templateKeyOf({
    template: state.template,
    customTemplateKey: state.customMode ? state.customTemplateKey : '',
  });
  const variables = variablesOf({
    variables: state.variables,
    customVariables: state.customMode ? state.customVariables : [],
  });
  const missing = state.template
    ? missingVariables(state.template, state.variables)
    : [];
  const errors = showErrors
    ? {
        ...(key ? {} : { template: 'required' }),
        ...(missing.length ? { variables: 'required' } : {}),
      }
    : {};

  return (
    <div className={styles.correction}>
      <p className={styles.muted}>{t('announce.correct.hint')}</p>
      <div className={styles.workspace}>
        <div className={styles.stack}>
          <TemplateFields
            value={state}
            onChange={setState}
            templates={catalogue}
            errors={errors}
          />
          {correct.isError && <ErrorNotice error={correct.error} t={t} />}
          <div className={styles.inlineRow}>
            <Button
              variant='primary'
              disabled={correct.isPending}
              onClick={() => {
                setShowErrors(true);
                if (!key || missing.length) return;
                correct.mutate(
                  {
                    id,
                    // The audience and the window go back unchanged.
                    request: { ...record.request, templateKey: key, variables },
                  },
                  { onSuccess: onDone }
                );
              }}
            >
              {t('announce.correct.save')}
            </Button>
            <Button disabled={correct.isPending} onClick={onDone}>
              {t('announce.correct.cancel')}
            </Button>
          </div>
        </div>
        <TemplatePreview
          templateKey={key}
          channels={['IN_APP']}
          locales={state.template?.channels ?? {}}
          variables={variables}
        />
      </div>
    </div>
  );
}

const STATUS_TONE: Record<string, 'info' | 'success' | 'warning' | 'error'> = {
  PENDING: 'info',
  RUNNING: 'info',
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

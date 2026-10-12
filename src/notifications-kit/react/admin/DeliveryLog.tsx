import { Fragment, useState } from 'react';

import {
  DELIVERY_STATUSES,
  canCancelDelivery,
  canRetryDelivery,
  isNotificationsError,
} from '../../core';
import type {
  Channel,
  DeliveryFilter,
  DeliveryResponse,
  DeliveryStatus,
} from '../../core';
import { useNotificationsContext } from '../context';
import { formatDateTime, formatRelative } from '../format';
import type { Translate } from '../messages';
import { Button, Icon, Spinner, StateBlock, cx } from '../primitives';
import styles from './admin.module.css';
import { ErrorNotice } from './errors';
import {
  CheckChips,
  Field,
  HtmlFrame,
  Select,
  TextInput,
  localDateToIso,
} from './forms';
import {
  useDeliveryCommands,
  useDeliveryContent,
  useDeliveryHistory,
  useDeliverySearch,
} from './hooks';

const CHANNELS: Channel[] = ['EMAIL', 'IN_APP', 'CHAT', 'WEBHOOK'];

/** Status → tone of its badge. */
const TONE: Record<DeliveryStatus, 'ok' | 'progress' | 'bad' | 'muted'> = {
  ACCEPTED: 'progress',
  PENDING: 'progress',
  CLAIMED: 'progress',
  SENT: 'ok',
  DELIVERED: 'ok',
  FAILED: 'bad',
  DEAD: 'bad',
  SUPPRESSED: 'muted',
  CANCELLED: 'muted',
  BATCHED: 'muted',
  COLLAPSED: 'muted',
};

export function StatusBadge({
  status,
  t,
}: {
  status: DeliveryStatus | null | undefined;
  t: Translate;
}) {
  if (!status) return <span className={styles.muted}>—</span>;
  return (
    <span className={styles.status} data-tone={TONE[status]}>
      {t(`status.${status}`)}
    </span>
  );
}

// ------------------------------------------------------------------ table

interface DeliveryTableProps {
  rows: readonly DeliveryResponse[];
  /** Filter the log by this request (the "all deliveries" link). */
  onShowRequest?: (requestId: string) => void;
}

/** Deliveries as rows; a row opens its history, content and commands. */
export function DeliveryTable({ rows, onShowRequest }: DeliveryTableProps) {
  const { t, locale, admin } = useNotificationsContext();
  const [openId, setOpenId] = useState<string | null>(null);
  const now = Date.now();
  // History and content need the support role; a sender sees the rows only.
  const expandable = admin.permissions.deliveries;
  const templateName = (key: string | null | undefined) =>
    key ? (admin.templateLabels[key] ?? key) : '—';

  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th scope='col'>{t('deliveries.col.created')}</th>
            <th scope='col'>{t('deliveries.col.template')}</th>
            <th scope='col'>{t('deliveries.col.channel')}</th>
            <th scope='col'>{t('deliveries.col.recipient')}</th>
            <th scope='col'>{t('deliveries.col.status')}</th>
            <th scope='col' className={styles.numeric}>
              {t('deliveries.col.attempts')}
            </th>
            <th scope='col'>
              <span className={styles.visuallyHidden}>
                {t('deliveries.details')}
              </span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => {
            const id = row.id ?? `row-${index}`;
            const open = expandable && openId === id;
            const relative = formatRelative(row.createdAt ?? null, now, locale);
            return (
              <Fragment key={id}>
                <tr
                  className={styles.tableRow}
                  data-open={open || undefined}
                  data-static={!expandable || undefined}
                  onClick={
                    expandable ? () => setOpenId(open ? null : id) : undefined
                  }
                >
                  <td
                    title={formatDateTime(row.createdAt ?? null, locale) ?? ''}
                  >
                    {relative === 'now' ? t('time.justNow') : (relative ?? '—')}
                  </td>
                  <td className={styles.ellipsis}>
                    {templateName(row.templateKey)}
                  </td>
                  <td>{row.channel ? t(`channel.${row.channel}`) : '—'}</td>
                  <td className={styles.ellipsis}>
                    {row.recipientReference ?? '—'}
                  </td>
                  <td>
                    <StatusBadge status={row.status} t={t} />
                  </td>
                  <td className={styles.numeric}>
                    {row.attempts ?? 0}
                    {row.maxAttempts ? ` / ${row.maxAttempts}` : ''}
                  </td>
                  <td className={styles.chevronCell}>
                    {expandable && (
                      <button
                        type='button'
                        className={styles.rowToggle}
                        aria-expanded={open}
                        aria-label={t('deliveries.details')}
                        onClick={event => {
                          event.stopPropagation();
                          setOpenId(open ? null : id);
                        }}
                      >
                        <Icon name='chevron' small />
                      </button>
                    )}
                  </td>
                </tr>
                {open && row.id && (
                  <tr className={styles.detailsRow}>
                    <td colSpan={7}>
                      <DeliveryDetails
                        delivery={row}
                        onShowRequest={onShowRequest}
                      />
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function DeliveryDetails({
  delivery,
  onShowRequest,
}: {
  delivery: DeliveryResponse;
  onShowRequest?: (requestId: string) => void;
}) {
  const { t, locale, admin } = useNotificationsContext();
  const id = delivery.id as string;
  const history = useDeliveryHistory(id);
  const [wantContent, setWantContent] = useState(false);
  const content = useDeliveryContent(id, wantContent);
  const { retry, cancel } = useDeliveryCommands();
  const date = (value: string | null | undefined) =>
    formatDateTime(value ?? null, locale);

  const facts: Array<[string, string | null | undefined]> = [
    [t('deliveries.field.id'), delivery.id],
    [t('deliveries.field.category'), delivery.category],
    [
      t('deliveries.field.priority'),
      delivery.priority ? t(`priority.${delivery.priority}`) : null,
    ],
    [t('deliveries.field.scheduled'), date(delivery.scheduledAt)],
    [t('deliveries.field.sent'), date(delivery.sentAt)],
    [t('deliveries.field.delivered'), date(delivery.deliveredAt)],
    [t('deliveries.field.nextAttempt'), date(delivery.nextAttemptAt)],
    [t('deliveries.field.provider'), delivery.providerMessageId],
    [t('deliveries.field.version'), delivery.templateVersion],
  ];

  const gone =
    isNotificationsError(content.error) && content.error.status === 410;
  const commandError = retry.error ?? cancel.error;

  return (
    <div className={styles.details}>
      <div className={styles.detailsColumns}>
        <dl className={styles.facts}>
          {facts
            .filter(([, value]) => value)
            .map(([label, value]) => (
              <Fragment key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </Fragment>
            ))}
          {delivery.requestId && (
            <>
              <dt>{t('deliveries.field.request')}</dt>
              <dd>
                {onShowRequest ? (
                  <button
                    type='button'
                    className={styles.linkButton}
                    onClick={() => onShowRequest(delivery.requestId as string)}
                  >
                    {delivery.requestId}
                  </button>
                ) : (
                  delivery.requestId
                )}
              </dd>
            </>
          )}
        </dl>

        <div className={styles.stack}>
          {(delivery.lastError || delivery.suppressionReason) && (
            <div className={styles.errorBox}>
              {delivery.suppressionReason && (
                <span>
                  {t('deliveries.suppressed', {
                    reason: delivery.suppressionReason,
                  })}
                </span>
              )}
              {delivery.lastError && (
                <span>
                  <strong>{t('deliveries.lastError')}</strong>
                  {delivery.lastFailureClass &&
                    ` (${t(`failure.${delivery.lastFailureClass}`)})`}
                  : {delivery.lastError}
                </span>
              )}
            </div>
          )}

          <div>
            <h4 className={styles.subTitle}>{t('deliveries.history')}</h4>
            {history.isPending ? (
              <Spinner label={t('item.loading')} />
            ) : history.isError ? (
              <ErrorNotice error={history.error} t={t} />
            ) : history.data.length === 0 ? (
              <p className={styles.muted}>{t('deliveries.historyEmpty')}</p>
            ) : (
              <ol className={styles.timeline}>
                {history.data.map((step, index) => (
                  <li key={index}>
                    <span className={styles.timelineTime}>
                      {date(step.occurredAt)}
                    </span>
                    <StatusBadge status={step.to} t={t} />
                    {step.attemptNumber ? (
                      <span className={styles.muted}>
                        {t('deliveries.attempt', { n: step.attemptNumber })}
                      </span>
                    ) : null}
                    {step.detail && (
                      <span className={styles.muted}>{step.detail}</span>
                    )}
                  </li>
                ))}
              </ol>
            )}
          </div>
        </div>
      </div>

      <div className={styles.stack}>
        <h4 className={styles.subTitle}>{t('deliveries.content')}</h4>
        {!wantContent ? (
          <div className={styles.inlineRow}>
            <Button onClick={() => setWantContent(true)}>
              {t('deliveries.content.show')}
            </Button>
            <span className={styles.muted}>
              {t('deliveries.content.audit')}
            </span>
          </div>
        ) : content.isPending ? (
          <Spinner label={t('item.loading')} />
        ) : gone ? (
          <p className={styles.muted}>{t('deliveries.content.gone')}</p>
        ) : content.isError ? (
          <ErrorNotice error={content.error} t={t} />
        ) : (
          <div className={styles.previewSheet}>
            {content.data.subject && (
              <div className={styles.previewSubject}>
                <span className={styles.muted}>{t('preview.subject')}</span>
                <strong>{content.data.subject}</strong>
              </div>
            )}
            {content.data.htmlBody ? (
              <HtmlFrame
                html={content.data.htmlBody}
                title={t('deliveries.content')}
              />
            ) : (
              <p className={styles.previewText}>
                {content.data.textBody ?? t('item.noBody')}
              </p>
            )}
          </div>
        )}
      </div>

      {(() => {
        const showRetry =
          admin.permissions.retryDeliveries &&
          canRetryDelivery(delivery.status);
        const showCancel =
          admin.permissions.deliveries && canCancelDelivery(delivery.status);
        if (!showRetry && !showCancel) return null;
        return (
          <div className={styles.inlineRow}>
            {showRetry && (
              <Button
                variant='primary'
                icon='refresh'
                disabled={retry.isPending}
                onClick={() => retry.mutate(id)}
              >
                {t('deliveries.retry')}
              </Button>
            )}
            {showCancel && (
              <Button
                disabled={cancel.isPending}
                onClick={() => cancel.mutate(id)}
              >
                {t('deliveries.cancel')}
              </Button>
            )}
          </div>
        );
      })()}
      {commandError && <ErrorNotice error={commandError} t={t} />}
    </div>
  );
}

// -------------------------------------------------------------------- log

export interface DeliveryLogProps {
  /** Start filtered by one request, e.g. right after a send. */
  requestId?: string;
  pageSize?: number;
}

interface FilterForm {
  statuses: DeliveryStatus[];
  channel: Channel | '';
  templateKey: string;
  requestId: string;
  from: string;
  to: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function toFilter(form: FilterForm): DeliveryFilter {
  return {
    statuses: form.statuses,
    channel: form.channel || undefined,
    templateKey: form.templateKey,
    // A half-typed id would be rejected by the filter parser.
    requestId: UUID.test(form.requestId.trim()) ? form.requestId : undefined,
    createdFrom: localDateToIso(form.from) || undefined,
    createdTo: localDateToIso(form.to, true) || undefined,
  };
}

/** Delivery history with filters, paging, and per-delivery details. */
export function DeliveryLog({ requestId, pageSize = 25 }: DeliveryLogProps) {
  const { t, admin } = useNotificationsContext();
  const empty: FilterForm = {
    statuses: [],
    channel: '',
    templateKey: '',
    requestId: requestId ?? '',
    from: '',
    to: '',
  };
  const [form, setForm] = useState<FilterForm>(empty);
  const [page, setPage] = useState(0);
  const filter = toFilter(form);
  const search = useDeliverySearch({ filter, page, pageSize });

  if (!admin.permissions.deliveries) {
    return (
      <div className={styles.root}>
        <StateBlock
          title={t('admin.noAccess')}
          note={t('admin.noAccess.deliveries')}
        />
      </div>
    );
  }

  const change = (patch: Partial<FilterForm>) => {
    setForm(current => ({ ...current, ...patch }));
    setPage(0);
  };

  const rows = search.data?.content ?? [];
  const offset = search.data?.offset ?? page * pageSize;
  const total = search.data?.totalElements ?? null;
  const hasNext =
    total !== null ? offset + rows.length < total : rows.length === pageSize;
  const filtered =
    form.statuses.length > 0 ||
    form.channel ||
    form.templateKey ||
    form.requestId ||
    form.from ||
    form.to;

  return (
    <div className={cx(styles.root, styles.log)}>
      <div className={styles.filters}>
        <Field label={t('deliveries.filter.channel')}>
          {({ id }) => (
            <Select
              id={id}
              value={form.channel}
              onChange={event =>
                change({ channel: event.target.value as Channel | '' })
              }
            >
              <option value=''>{t('deliveries.filter.any')}</option>
              {CHANNELS.map(c => (
                <option key={c} value={c}>
                  {t(`channel.${c}`)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={t('deliveries.filter.template')}>
          {({ id }) => (
            <TextInput
              id={id}
              value={form.templateKey}
              spellCheck={false}
              onChange={event => change({ templateKey: event.target.value })}
            />
          )}
        </Field>
        <Field label={t('deliveries.filter.request')}>
          {({ id }) => (
            <TextInput
              id={id}
              value={form.requestId}
              spellCheck={false}
              placeholder='00000000-0000-…'
              onChange={event => change({ requestId: event.target.value })}
            />
          )}
        </Field>
        <Field label={t('deliveries.filter.from')}>
          {({ id }) => (
            <TextInput
              id={id}
              type='date'
              value={form.from}
              onChange={event => change({ from: event.target.value })}
            />
          )}
        </Field>
        <Field label={t('deliveries.filter.to')}>
          {({ id }) => (
            <TextInput
              id={id}
              type='date'
              value={form.to}
              onChange={event => change({ to: event.target.value })}
            />
          )}
        </Field>
      </div>
      <div className={styles.filterStatuses}>
        <CheckChips
          value={form.statuses}
          options={DELIVERY_STATUSES.map(s => ({
            value: s,
            label: t(`status.${s}`),
          }))}
          onChange={statuses => change({ statuses })}
        />
        {filtered && (
          <Button
            variant='ghost'
            onClick={() => {
              setForm({ ...empty, requestId: '' });
              setPage(0);
            }}
          >
            {t('deliveries.filter.reset')}
          </Button>
        )}
      </div>

      {search.isPending ? (
        <div className={styles.center}>
          <Spinner label={t('item.loading')} />
        </div>
      ) : search.isError && rows.length === 0 ? (
        <ErrorNotice
          error={search.error}
          t={t}
          action={
            <Button onClick={() => void search.refetch()}>
              {t('inbox.retry')}
            </Button>
          }
        />
      ) : rows.length === 0 ? (
        <StateBlock title={t('deliveries.empty')} />
      ) : (
        <div data-pending={search.isPlaceholderData || undefined}>
          <DeliveryTable
            rows={rows}
            onShowRequest={id => change({ requestId: id })}
          />
        </div>
      )}

      {(page > 0 || hasNext) && rows.length > 0 && (
        <div className={styles.pager}>
          <span className={styles.muted}>
            {total !== null
              ? t('deliveries.page', {
                  from: offset + 1,
                  to: offset + rows.length,
                  total,
                })
              : t('deliveries.pageNoTotal', {
                  from: offset + 1,
                  to: offset + rows.length,
                })}
          </span>
          <div className={styles.inlineRow}>
            <Button
              disabled={page === 0 || search.isFetching}
              onClick={() => setPage(p => Math.max(0, p - 1))}
            >
              {t('deliveries.prev')}
            </Button>
            <Button
              disabled={!hasNext || search.isFetching}
              onClick={() => setPage(p => p + 1)}
            >
              {t('deliveries.next')}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

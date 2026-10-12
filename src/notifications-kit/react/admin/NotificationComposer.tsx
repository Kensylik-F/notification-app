import { useId, useMemo, useRef, useState } from 'react';

import {
  CHANNEL_ORDER,
  SERVICE_TEMPLATES,
  buildSendRequest,
  channelsOf,
  newIdempotencyKey,
  templateKeyOf,
  validateSend,
  variablesOf,
} from '../../core';
import type {
  Channel,
  NotificationRequestResponse,
  RecipientDraft,
  SendCategoryClass,
  SendDraft,
  SendErrors,
  SendPriority,
  TemplateDescriptor,
} from '../../core';
import { useNotificationsContext } from '../context';
import { formatDateTime } from '../format';
import { Button, StateBlock, cx } from '../primitives';
import styles from './admin.module.css';
import { DeliveryTable } from './DeliveryLog';
import { ErrorNotice } from './errors';
import {
  CheckChips,
  Field,
  FieldSet,
  FormSection,
  Notice,
  Segmented,
  Select,
  TextInput,
  toLocalInput,
} from './forms';
import { useNotificationRequest, useSendNotification } from './hooks';
import { RecipientField } from './RecipientField';
import { EMPTY_TEMPLATE_STATE, TemplateFields } from './TemplateFields';
import type { TemplateState } from './TemplateFields';
import { TemplatePreview } from './TemplatePreview';

const ALL_CHANNELS: readonly Channel[] = CHANNEL_ORDER;
const CLASSES: SendCategoryClass[] = ['TRANSACTIONAL', 'PLATFORM', 'MARKETING'];
const PRIORITIES: SendPriority[] = ['NORMAL', 'HIGH', 'BULK'];

interface ComposerState extends TemplateState {
  channels: Channel[];
  category: string;
  categoryClass: SendCategoryClass;
  priority: SendPriority;
  recipients: RecipientDraft[];
  later: boolean;
  scheduledAt: string;
}

function initialState(defaultCategory?: string): ComposerState {
  return {
    ...EMPTY_TEMPLATE_STATE,
    channels: [],
    category: defaultCategory ?? '',
    categoryClass: 'TRANSACTIONAL',
    priority: 'NORMAL',
    recipients: [],
    later: false,
    scheduledAt: '',
  };
}

function toDraft(state: ComposerState): SendDraft {
  return {
    template: state.template,
    customTemplateKey: state.customMode ? state.customTemplateKey : '',
    variables: state.variables,
    customVariables: state.customMode ? state.customVariables : [],
    channels: state.channels,
    category: state.category,
    categoryClass: state.categoryClass,
    priority: state.priority,
    recipients: state.recipients,
    scheduledAt: state.later ? state.scheduledAt : null,
  };
}

export interface NotificationComposerProps {
  /** Templates offered. Default: every service template except digests. */
  templates?: readonly TemplateDescriptor[];
  defaultCategory?: string;
  /** Show the sent request in the delivery log (e.g. switch tabs). */
  onOpenDeliveries?: (requestId: string) => void;
  onSent?: (response: NotificationRequestResponse) => void;
}

/**
 * "New mailing": template and its data, recipients, channels, category,
 * priority, send now or at a time, with a live preview from the service.
 */
export function NotificationComposer({
  templates,
  defaultCategory,
  onOpenDeliveries,
  onSent,
}: NotificationComposerProps) {
  const { t, admin } = useNotificationsContext();
  const catalogue = useMemo(
    () => templates ?? SERVICE_TEMPLATES.filter(item => !item.digest),
    [templates]
  );
  const [state, setState] = useState<ComposerState>(() =>
    initialState(defaultCategory)
  );
  const [showErrors, setShowErrors] = useState(false);
  const categoryListId = useId();
  const send = useSendNotification();
  const [sent, setSent] = useState<{
    id: string | undefined;
    at: number;
    answer: NotificationRequestResponse;
  } | null>(null);

  // One key per submission: kept across repeats of the same draft, renewed
  // as soon as the draft changes.
  const keyRef = useRef<{ fingerprint: string; key: string } | null>(null);

  const draft = toDraft(state);
  const errors: SendErrors = validateSend(draft);
  const visibleErrors = showErrors ? errors : {};
  const valid = Object.keys(errors).length === 0;

  const templateChannels = state.template
    ? channelsOf(state.template)
    : ALL_CHANNELS;
  const update = (patch: Partial<ComposerState>) =>
    setState(current => ({ ...current, ...patch }));

  const onTemplate = (next: TemplateState) => {
    const offered = next.template ? channelsOf(next.template) : ALL_CHANNELS;
    setState(current => {
      const kept = current.channels.filter(c => offered.includes(c));
      return {
        ...current,
        ...next,
        // A template with one channel needs no choice.
        channels:
          kept.length > 0 ? kept : offered.length === 1 ? [...offered] : [],
      };
    });
  };

  const onCategory = (category: string) => {
    const known = admin.categories.find(c => c.code === category.trim());
    update({
      category,
      ...(known?.categoryClass ? { categoryClass: known.categoryClass } : {}),
    });
  };

  const submit = () => {
    setShowErrors(true);
    if (!valid) return;
    const request = buildSendRequest(draft);
    const fingerprint = JSON.stringify(request);
    if (keyRef.current?.fingerprint !== fingerprint) {
      keyRef.current = { fingerprint, key: newIdempotencyKey() };
    }
    send.mutate(
      { request, idempotencyKey: keyRef.current.key },
      {
        onSuccess: answer => {
          setSent({ id: answer.id ?? undefined, at: Date.now(), answer });
          onSent?.(answer);
        },
      }
    );
  };

  const restart = (keep: boolean) => {
    setSent(null);
    setShowErrors(false);
    send.reset();
    keyRef.current = null;
    if (!keep) setState(initialState(defaultCategory));
  };

  if (!admin.permissions.send) {
    return (
      <div className={styles.root}>
        <StateBlock
          title={t('admin.noAccess')}
          note={t('admin.noAccess.send')}
        />
      </div>
    );
  }

  if (sent) {
    return (
      <SendResult
        sent={sent}
        onOpenDeliveries={onOpenDeliveries}
        onNew={() => restart(false)}
        onAgain={() => restart(true)}
      />
    );
  }

  const templateKey = templateKeyOf(draft);
  const deliveries = state.recipients.length * state.channels.length;

  return (
    <div className={cx(styles.root, styles.workspace)}>
      <form
        className={styles.form}
        noValidate
        onSubmit={event => {
          event.preventDefault();
          submit();
        }}
      >
        <FormSection title={t('compose.section.template')}>
          <TemplateFields
            value={state}
            onChange={onTemplate}
            templates={catalogue}
            errors={visibleErrors}
          />
        </FormSection>

        <FormSection title={t('compose.section.recipients')}>
          <RecipientField
            value={state.recipients}
            onChange={recipients => update({ recipients })}
            error={visibleErrors.recipients}
          />
        </FormSection>

        <FormSection title={t('compose.section.delivery')}>
          <FieldSet
            legend={t('compose.channels')}
            error={
              visibleErrors.channels ? t('compose.channels.error') : undefined
            }
            hint={state.template ? t('compose.channels.hint') : undefined}
          >
            <CheckChips
              value={state.channels}
              options={templateChannels.map(c => ({
                value: c,
                label: t(`channel.${c}`),
              }))}
              onChange={channels => update({ channels })}
            />
          </FieldSet>
          <div className={styles.grid2}>
            <Field
              label={t('compose.category')}
              required
              hint={t('compose.category.hint')}
              error={
                visibleErrors.category === 'tooLong'
                  ? t('compose.category.error.tooLong')
                  : visibleErrors.category
                    ? t('compose.category.error.required')
                    : undefined
              }
            >
              {({ id, describedBy, invalid }) => (
                <>
                  <TextInput
                    id={id}
                    aria-describedby={describedBy}
                    invalid={invalid}
                    list={categoryListId}
                    value={state.category}
                    spellCheck={false}
                    autoComplete='off'
                    onChange={event => onCategory(event.target.value)}
                  />
                  <datalist id={categoryListId}>
                    {admin.categories.map(c => (
                      <option key={c.code} value={c.code}>
                        {c.label}
                      </option>
                    ))}
                  </datalist>
                </>
              )}
            </Field>
            <Field label={t('compose.class')}>
              {({ id }) => (
                <Select
                  id={id}
                  value={state.categoryClass}
                  onChange={event =>
                    update({
                      categoryClass: event.target.value as SendCategoryClass,
                    })
                  }
                >
                  {CLASSES.map(c => (
                    <option key={c} value={c}>
                      {t(`class.${c}`)}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </div>
          <FieldSet legend={t('priority.label')}>
            <Segmented
              name='nk-priority'
              value={state.priority}
              options={PRIORITIES.map(p => ({
                value: p,
                label: t(`priority.${p}`),
              }))}
              onChange={priority => update({ priority })}
            />
          </FieldSet>
        </FormSection>

        <FormSection title={t('compose.section.schedule')}>
          <Segmented
            name='nk-when'
            value={state.later ? 'later' : 'now'}
            options={[
              { value: 'now', label: t('compose.when.now') },
              { value: 'later', label: t('compose.when.later') },
            ]}
            onChange={value =>
              update({
                later: value === 'later',
                scheduledAt:
                  value === 'later' && !state.scheduledAt
                    ? toLocalInput(new Date(Date.now() + 60 * 60_000))
                    : state.scheduledAt,
              })
            }
          />
          {state.later && (
            <Field
              label={t('compose.when.at')}
              required
              error={
                visibleErrors.scheduledAt === 'past'
                  ? t('compose.when.error.past')
                  : visibleErrors.scheduledAt
                    ? t('compose.when.error.invalid')
                    : undefined
              }
            >
              {({ id, describedBy, invalid }) => (
                <TextInput
                  id={id}
                  type='datetime-local'
                  aria-describedby={describedBy}
                  invalid={invalid}
                  className={styles.dateInput}
                  value={state.scheduledAt}
                  onChange={event =>
                    update({ scheduledAt: event.target.value })
                  }
                />
              )}
            </Field>
          )}
        </FormSection>

        {send.isError && <ErrorNotice error={send.error} t={t} />}
        {send.isError && keyRef.current && (
          <p className={styles.muted}>{t('compose.retryHint')}</p>
        )}

        <div className={styles.submitBar}>
          <span className={styles.muted}>
            {showErrors && !valid
              ? t('compose.fixErrors')
              : t('compose.summary', {
                  recipients: state.recipients.length,
                  deliveries,
                })}
          </span>
          <Button
            type='submit'
            variant='primary'
            icon='send'
            disabled={send.isPending}
          >
            {send.isPending
              ? t('compose.sending')
              : state.later
                ? t('compose.submitScheduled')
                : t('compose.submit')}
          </Button>
        </div>
      </form>

      <TemplatePreview
        templateKey={templateKey}
        channels={
          state.channels.length > 0
            ? templateChannels.filter(c => state.channels.includes(c))
            : templateChannels
        }
        locales={state.template?.channels ?? {}}
        variables={variablesOf(draft)}
      />
    </div>
  );
}

function SendResult({
  sent,
  onOpenDeliveries,
  onNew,
  onAgain,
}: {
  sent: {
    id: string | undefined;
    at: number;
    answer: NotificationRequestResponse;
  };
  onOpenDeliveries?: (requestId: string) => void;
  onNew: () => void;
  onAgain: () => void;
}) {
  const { t, locale } = useNotificationsContext();
  const live = useNotificationRequest(sent.id, sent.at);
  const request = live.data ?? sent.answer;
  const scheduled =
    request.scheduledAt && Date.parse(request.scheduledAt) > Date.now()
      ? formatDateTime(request.scheduledAt, locale)
      : null;
  const deliveries = request.deliveries ?? [];

  return (
    <div className={cx(styles.root, styles.stack, styles.result)}>
      {request.rejectionReason ? (
        <Notice
          tone='error'
          title={t('compose.result.rejected', {
            reason: request.rejectionReason,
          })}
        />
      ) : (
        <Notice
          tone='success'
          title={
            scheduled
              ? t('compose.result.scheduled', { date: scheduled })
              : t('compose.result.title')
          }
        >
          {request.duplicate && <span>{t('compose.result.duplicate')}</span>}
          {request.id && (
            <span className={styles.muted}>
              {t('compose.result.id', { id: request.id })}
            </span>
          )}
        </Notice>
      )}

      {deliveries.length > 0 && (
        <section className={styles.stack}>
          <h3 className={styles.sectionTitle}>
            {t('compose.result.deliveries')}
          </h3>
          <DeliveryTable rows={deliveries} />
        </section>
      )}

      <div className={styles.inlineRow}>
        <Button variant='primary' icon='plus' onClick={onNew}>
          {t('compose.result.new')}
        </Button>
        <Button onClick={onAgain}>{t('compose.result.again')}</Button>
        {onOpenDeliveries && request.id && (
          <Button
            variant='ghost'
            onClick={() => onOpenDeliveries(request.id as string)}
          >
            {t('compose.result.openLog')}
          </Button>
        )}
      </div>
    </div>
  );
}

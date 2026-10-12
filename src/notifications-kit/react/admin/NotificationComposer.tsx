import { useMemo, useRef, useState } from 'react';

import {
  CHANNEL_ORDER,
  buildSendRequest,
  contentToTemplate,
  newIdempotencyKey,
  validateSend,
} from '../../core';
import type {
  Channel,
  MessageContent,
  NotificationRequestResponse,
  RecipientDraft,
  SendCategoryClass,
  SendDraft,
  SendPriority,
} from '../../core';
import { useNotificationsContext } from '../context';
import { formatDateTime } from '../format';
import { Button, StateBlock, cx } from '../primitives';
import styles from './admin.module.css';
import { DeliveryTable } from './DeliveryLog';
import { Combobox, Dropdown } from './Dropdown';
import { ErrorNotice } from './errors';
import {
  CheckChips,
  Field,
  FieldSet,
  FormSection,
  Notice,
  Segmented,
  TextInput,
  toLocalInput,
} from './forms';
import { useNotificationRequest, useSendNotification } from './hooks';
import { MessageFields, initialContent } from './MessageFields';
import { RecipientField } from './RecipientField';
import { TemplatePreview } from './TemplatePreview';

const CLASSES: SendCategoryClass[] = ['TRANSACTIONAL', 'PLATFORM', 'MARKETING'];
const PRIORITIES: SendPriority[] = ['NORMAL', 'HIGH', 'BULK'];
const PREVIEW_DEFAULT: Channel[] = ['EMAIL', 'IN_APP'];

interface ComposerState {
  content: MessageContent;
  channels: Channel[];
  category: string;
  categoryClass: SendCategoryClass;
  priority: SendPriority;
  recipients: RecipientDraft[];
  later: boolean;
  scheduledAt: string;
}

function initialState(
  freeformTemplateKey: string | undefined,
  defaultCategory?: string
): ComposerState {
  return {
    content: initialContent(freeformTemplateKey),
    channels: ['IN_APP'],
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
    content: state.content,
    channels: state.channels,
    category: state.category,
    categoryClass: state.categoryClass,
    priority: state.priority,
    recipients: state.recipients,
    scheduledAt: state.later ? state.scheduledAt : null,
  };
}

export interface NotificationComposerProps {
  defaultCategory?: string;
  /** Show the sent request in the delivery log (e.g. switch tabs). */
  onOpenDeliveries?: (requestId: string) => void;
  onSent?: (response: NotificationRequestResponse) => void;
}

/**
 * "New mailing": the message (text in the editor, or a template by key),
 * recipients, channels, category, when; class and priority under "More".
 * The preview on the right is the service's own rendering.
 */
export function NotificationComposer({
  defaultCategory,
  onOpenDeliveries,
  onSent,
}: NotificationComposerProps) {
  const { t, admin } = useNotificationsContext();
  const freeformKey = admin.freeformTemplateKey;
  const [state, setState] = useState<ComposerState>(() =>
    initialState(freeformKey, defaultCategory)
  );
  const [showErrors, setShowErrors] = useState(false);
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
  const errors = validateSend(draft, { freeformTemplateKey: freeformKey });
  const visible = showErrors ? errors : {};
  const valid = Object.keys(errors).length === 0;

  const update = (patch: Partial<ComposerState>) =>
    setState(current => ({ ...current, ...patch }));

  const preview = useMemo(
    () => contentToTemplate(state.content, freeformKey),
    [state.content, freeformKey]
  );
  const previewIdle =
    state.content.mode === 'freeform' &&
    !state.content.subject.trim() &&
    !state.content.bodyText.trim();

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

  const submit = () => {
    setShowErrors(true);
    if (!valid) return;
    const request = buildSendRequest(draft, freeformKey);
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
    if (!keep) setState(initialState(freeformKey, defaultCategory));
  };

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

  const deliveries = state.recipients.length * state.channels.length;
  const previewChannels = CHANNEL_ORDER.filter(c =>
    (state.channels.length ? state.channels : PREVIEW_DEFAULT).includes(c)
  );

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
        <FormSection step={1} title={t('compose.section.message')}>
          <MessageFields
            value={state.content}
            onChange={content => update({ content })}
            errors={visible}
          />
        </FormSection>

        <FormSection step={2} title={t('compose.section.recipients')}>
          <RecipientField
            value={state.recipients}
            onChange={recipients => update({ recipients })}
            error={visible.recipients}
          />
        </FormSection>

        <FormSection step={3} title={t('compose.section.delivery')}>
          <FieldSet
            legend={t('compose.channels')}
            hint={t('compose.channels.hint')}
            error={visible.channels ? t('compose.channels.error') : undefined}
          >
            <CheckChips
              value={state.channels}
              options={CHANNEL_ORDER.map(c => ({
                value: c,
                label: t(`channel.${c}`),
              }))}
              onChange={channels => update({ channels })}
            />
          </FieldSet>
          <Field
            label={t('compose.category')}
            required
            hint={t('compose.category.hint')}
            error={
              visible.category === 'tooLong'
                ? t('compose.category.error.tooLong')
                : visible.category
                  ? t('compose.category.error.required')
                  : undefined
            }
          >
            {({ id, describedBy, invalid }) => (
              <Combobox
                id={id}
                describedBy={describedBy}
                invalid={invalid}
                value={state.category}
                options={admin.categories.map(c => ({
                  value: c.code,
                  label: c.label,
                  hint: c.code,
                }))}
                onChange={category => {
                  const known = admin.categories.find(
                    c => c.code === category.trim()
                  );
                  update({
                    category,
                    ...(known?.categoryClass
                      ? { categoryClass: known.categoryClass }
                      : {}),
                  });
                }}
              />
            )}
          </Field>
        </FormSection>

        <FormSection step={4} title={t('compose.section.schedule')}>
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
                visible.scheduledAt === 'past'
                  ? t('compose.when.error.past')
                  : visible.scheduledAt
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

        <details className={styles.more}>
          <summary className={styles.moreSummary}>
            <span>{t('compose.more')}</span>
            <span className={styles.muted}>
              {t(`class.${state.categoryClass}`)} ·{' '}
              {t(`priority.${state.priority}`)}
            </span>
          </summary>
          <div className={styles.sectionBody}>
            <Field
              label={t('compose.class')}
              hint={t(`class.${state.categoryClass}.hint`)}
            >
              {({ id, describedBy }) => (
                <Dropdown
                  id={id}
                  describedBy={describedBy}
                  value={state.categoryClass}
                  options={CLASSES.map(c => ({
                    value: c,
                    label: t(`class.${c}`),
                    hint: t(`class.${c}.hint`),
                  }))}
                  onChange={categoryClass => update({ categoryClass })}
                />
              )}
            </Field>
            <FieldSet
              legend={t('priority.label')}
              hint={t(`priority.${state.priority}.hint`)}
            >
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
          </div>
        </details>

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
                  channels: state.channels.length,
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
        templateKey={preview.templateKey}
        variables={preview.variables}
        channels={previewChannels}
        idle={previewIdle}
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

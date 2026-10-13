import { useRef, useState } from 'react';

import {
  CHANNEL_ORDER,
  buildSendRequest,
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
import { plural } from '../messages';
import { useKitPreview } from '../preview';
import { Button, StateBlock, cx } from '../primitives';
import styles from './admin.module.css';
import { DeliveryTable } from './DeliveryLog';
import { Combobox, Dropdown } from './Dropdown';
import { ErrorNotice } from './errors';
import {
  CheckTiles,
  Disclosure,
  Field,
  FieldSet,
  FormSection,
  Notice,
  Segmented,
  TextInput,
  revealFirstError,
  toLocalInput,
} from './forms';
import { useNotificationRequest, useSendNotification } from './hooks';
import {
  MessageFields,
  MessageModeSwitch,
  initialContent,
} from './MessageFields';
import {
  CHANNEL_ICON,
  PREVIEW_CHANNELS,
  PreviewButton,
  PreviewDialog,
  PreviewStrip,
  previewInboxEntry,
  useClearPreviewOnLeave,
  useFetchPreview,
  usePreviewRequest,
} from './Preview';
import type { PreviewChannel } from './Preview';
import { RecipientField } from './RecipientField';

const CLASSES: SendCategoryClass[] = ['TRANSACTIONAL', 'PLATFORM', 'MARKETING'];
const PRIORITIES: SendPriority[] = ['NORMAL', 'HIGH', 'BULK'];
const CONTENT_KEYS = ['subject', 'body', 'templateKey', 'variables'] as const;

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
 * "New mailing" in one column: to whom, where, the message, the
 * parameters; class and priority under "More". The bar at the bottom stays
 * in view with the count of deliveries, "Preview" and "Send".
 */
export function NotificationComposer({
  defaultCategory,
  onOpenDeliveries,
  onSent,
}: NotificationComposerProps) {
  const { t, admin, locale } = useNotificationsContext();
  const freeformKey = admin.freeformTemplateKey;
  const [state, setState] = useState<ComposerState>(() =>
    initialState(freeformKey, defaultCategory)
  );
  const [showErrors, setShowErrors] = useState(false);
  const [showContentErrors, setShowContentErrors] = useState(false);
  const send = useSendNotification();
  const [sent, setSent] = useState<{
    id: string | undefined;
    at: number;
    answer: NotificationRequestResponse;
  } | null>(null);

  // Preview
  const [kitPreview, setKitPreview] = useKitPreview();
  const [dialog, setDialog] = useState<PreviewChannel | null>(null);
  const [lastDialog, setLastDialog] = useState<PreviewChannel>('EMAIL');
  const [previewError, setPreviewError] = useState<unknown>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const fetchPreview = useFetchPreview();
  const requestFor = usePreviewRequest(state.content);
  const topRef = useRef<HTMLDivElement>(null);
  useClearPreviewOnLeave();

  // One key per submission: kept across repeats of the same draft, renewed
  // as soon as the draft changes.
  const keyRef = useRef<{ fingerprint: string; key: string } | null>(null);

  const draft = toDraft(state);
  const errors = validateSend(draft, { freeformTemplateKey: freeformKey });
  const visible = showErrors
    ? errors
    : showContentErrors
      ? Object.fromEntries(
          CONTENT_KEYS.filter(k => errors[k]).map(k => [k, errors[k]])
        )
      : {};
  const valid = Object.keys(errors).length === 0;
  const contentValid = CONTENT_KEYS.every(k => !errors[k]);

  const update = (patch: Partial<ComposerState>) =>
    setState(current => ({ ...current, ...patch }));

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
    if (!valid) {
      revealFirstError(topRef.current);
      return;
    }
    const request = buildSendRequest(draft, freeformKey);
    const fingerprint = JSON.stringify(request);
    if (keyRef.current?.fingerprint !== fingerprint) {
      keyRef.current = { fingerprint, key: newIdempotencyKey() };
    }
    send.mutate(
      { request, idempotencyKey: keyRef.current.key },
      {
        onSuccess: answer => {
          setKitPreview(null);
          setSent({ id: answer.id ?? undefined, at: Date.now(), answer });
          onSent?.(answer);
        },
      }
    );
  };

  const restart = (keep: boolean) => {
    setSent(null);
    setShowErrors(false);
    setShowContentErrors(false);
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

  const runInApp = async () => {
    setDialog(null);
    const request = requestFor('IN_APP');
    if (!request) return;
    setPreviewBusy(true);
    setPreviewError(null);
    try {
      const result = await fetchPreview(request);
      setKitPreview({
        kind: 'inbox',
        entry: previewInboxEntry(result, {
          priority: state.priority,
          category: state.category.trim() || null,
          categoryClass: state.categoryClass,
        }),
      });
      topRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    } catch (error) {
      setPreviewError(error);
    } finally {
      setPreviewBusy(false);
    }
  };

  const pick = (channel: PreviewChannel) => {
    if (!contentValid) {
      setShowContentErrors(true);
      revealFirstError(topRef.current);
      return;
    }
    setPreviewError(null);
    if (channel === 'IN_APP') void runInApp();
    else {
      setLastDialog(channel);
      setDialog(channel);
    }
  };

  const previewChannels = PREVIEW_CHANNELS.filter(c =>
    state.channels.includes(c)
  );
  const recipients = state.recipients.length;
  const channels = state.channels.length;
  const deliveries = recipients * channels;
  const inAppActive = kitPreview?.kind === 'inbox';

  return (
    <div className={cx(styles.root, styles.composer)} ref={topRef}>
      {inAppActive && (
        <PreviewStrip onExit={() => setKitPreview(null)}>
          <strong>{t('preview.strip.title')}</strong> {t('preview.strip.inbox')}
        </PreviewStrip>
      )}
      <form
        className={styles.form}
        noValidate
        onSubmit={event => {
          event.preventDefault();
          submit();
        }}
      >
        <FormSection title={t('compose.section.recipients')}>
          <RecipientField
            value={state.recipients}
            onChange={recipients => update({ recipients })}
            error={visible.recipients}
          />
        </FormSection>

        <FormSection title={t('compose.section.channels')}>
          <CheckTiles
            label={t('compose.channels')}
            value={state.channels}
            options={CHANNEL_ORDER.map(c => ({
              value: c,
              label: t(`channel.${c}`),
              icon: CHANNEL_ICON[c],
            }))}
            onChange={channels => update({ channels })}
          />
          <span
            className={visible.channels ? styles.fieldError : styles.fieldHint}
            role={visible.channels ? 'alert' : undefined}
          >
            {visible.channels
              ? t('compose.channels.error')
              : t('compose.channels.hint')}
          </span>
        </FormSection>

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

        <FormSection title={t('compose.section.params')}>
          <div className={styles.grid2}>
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
                  placeholder={t('compose.category.placeholder')}
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
            <FieldSet legend={t('compose.section.schedule')}>
              <Segmented
                name='nk-when'
                label={t('compose.section.schedule')}
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
            </FieldSet>
          </div>
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
          <Disclosure
            summary={t('compose.moreSummary', {
              cls: t(`class.${state.categoryClass}`).toLowerCase(),
              priority: t(`priority.${state.priority}.short`),
            })}
          >
            <div className={styles.grid2}>
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
                  label={t('priority.label')}
                  value={state.priority}
                  options={PRIORITIES.map(p => ({
                    value: p,
                    label: t(`priority.${p}`),
                  }))}
                  onChange={priority => update({ priority })}
                />
              </FieldSet>
            </div>
          </Disclosure>
        </FormSection>

        {send.isError && <ErrorNotice error={send.error} t={t} />}
        {send.isError && keyRef.current && (
          <p className={styles.muted}>{t('compose.retryHint')}</p>
        )}
        {previewError !== null && (
          <ErrorNotice
            error={previewError}
            t={t}
            action={
              <Button size='sm' onClick={() => setPreviewError(null)}>
                {t('preview.close')}
              </Button>
            }
          />
        )}
      </form>

      <div className={styles.actionBar}>
        <span className={styles.actionSummary}>
          {showErrors && !valid ? (
            <span className={styles.fieldError}>{t('compose.fixErrors')}</span>
          ) : (
            <>
              {recipients} {plural(t('plural.recipient'), recipients, locale)} ×{' '}
              {channels} {plural(t('plural.channel'), channels, locale)} ={' '}
              <strong>
                {deliveries} {plural(t('plural.delivery'), deliveries, locale)}
              </strong>
            </>
          )}
        </span>
        <PreviewButton
          channels={previewChannels}
          busy={previewBusy}
          disabledReason={
            !admin.permissions.preview
              ? t('preview.noAccess')
              : previewChannels.length === 0
                ? t('preview.pickChannel')
                : undefined
          }
          onPick={pick}
        />
        <Button
          variant='primary'
          size='lg'
          icon='send'
          disabled={send.isPending}
          onClick={submit}
        >
          {send.isPending
            ? t('compose.sending')
            : state.later
              ? t('compose.submitScheduled')
              : t('compose.submit')}
        </Button>
      </div>

      <PreviewDialog
        open={dialog !== null}
        channel={dialog ?? lastDialog}
        channels={previewChannels}
        content={state.content}
        recipients={state.recipients}
        onChannelChange={channel => {
          setLastDialog(channel);
          setDialog(channel);
        }}
        onInApp={() => void runInApp()}
        onClose={() => setDialog(null)}
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

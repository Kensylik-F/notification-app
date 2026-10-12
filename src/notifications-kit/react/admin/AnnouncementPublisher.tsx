import { useMemo, useState } from 'react';

import {
  SERVICE_TEMPLATES,
  buildPublishRequest,
  templateKeyOf,
  validatePublish,
  variablesOf,
} from '../../core';
import type {
  AnnouncementAdmin,
  AudienceType,
  PublishDraft,
  PublishErrors,
  TemplateDescriptor,
} from '../../core';
import { useNotificationsContext } from '../context';
import { Button, StateBlock, cx } from '../primitives';
import styles from './admin.module.css';
import { ErrorNotice } from './errors';
import {
  Field,
  FieldSet,
  FormSection,
  Notice,
  Segmented,
  Select,
  TextInput,
  toLocalInput,
} from './forms';
import { usePublishAnnouncement } from './hooks';
import { PublishedAnnouncements } from './PublishedAnnouncements';
import { EMPTY_TEMPLATE_STATE, TemplateFields } from './TemplateFields';
import type { TemplateState } from './TemplateFields';
import { TemplatePreview } from './TemplatePreview';

const DEFAULT_WINDOW_DAYS = 7;
const CUSTOM = '__custom__';

interface PublisherState extends TemplateState {
  category: string;
  customCategory: boolean;
  audienceType: AudienceType;
  audienceValue: string;
  fromNow: boolean;
  visibleFrom: string;
  visibleUntil: string;
}

function initialState(): PublisherState {
  return {
    ...EMPTY_TEMPLATE_STATE,
    category: '',
    customCategory: false,
    audienceType: 'EVERYONE',
    audienceValue: '',
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
    template: state.template,
    customTemplateKey: state.customMode ? state.customTemplateKey : '',
    variables: state.variables,
    customVariables: state.customMode ? state.customVariables : [],
    visibleFrom: state.fromNow ? null : state.visibleFrom,
    visibleUntil: state.visibleUntil,
  };
}

export interface AnnouncementPublisherProps {
  /** Templates offered. Default: service templates fit for an audience
   *  (no per-recipient content, not a digest). */
  templates?: readonly TemplateDescriptor[];
  /** Render the list of announcements published in this tab under the
   *  form. Default: `true`. */
  showPublished?: boolean;
  onPublished?: (announcement: AnnouncementAdmin) => void;
}

/** Publish an announcement: category, audience, template, window. */
export function AnnouncementPublisher({
  templates,
  showPublished = true,
  onPublished,
}: AnnouncementPublisherProps) {
  const { t, admin } = useNotificationsContext();
  const catalogue = useMemo(
    () => templates ?? SERVICE_TEMPLATES.filter(item => item.announcement),
    [templates]
  );
  const categories = admin.categories.filter(c => c.announcement);
  const [state, setState] = useState<PublisherState>(initialState);
  const [showErrors, setShowErrors] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [published, setPublished] = useState<AnnouncementAdmin | null>(null);
  const publish = usePublishAnnouncement();

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

  const draft = toDraft(state);
  const errors: PublishErrors = validatePublish(draft, {
    maxVisibilityDays: admin.maxVisibilityDays,
  });
  const visible = showErrors ? errors : {};
  const valid = Object.keys(errors).length === 0;
  const update = (patch: Partial<PublisherState>) =>
    setState(current => ({ ...current, ...patch }));
  const days = admin.maxVisibilityDays;
  const roleLabel =
    admin.roles.find(r => r.code === state.audienceValue)?.label ??
    state.audienceValue;

  const untilError =
    visible.visibleUntil === 'tooLong'
      ? t('announce.until.error.tooLong', { days })
      : visible.visibleUntil === 'beforeStart'
        ? t('announce.until.error.beforeStart')
        : visible.visibleUntil
          ? t('announce.until.error.required')
          : undefined;

  const doPublish = () => {
    publish.mutate(buildPublishRequest(draft), {
      onSuccess: announcement => {
        setConfirming(false);
        setPublished(announcement);
        setShowErrors(false);
        setState(initialState());
        onPublished?.(announcement);
      },
      onError: () => setConfirming(false),
    });
  };

  const categoryValue = state.customCategory ? CUSTOM : state.category;

  return (
    <div className={cx(styles.root, styles.stack)}>
      {published && (
        <Notice
          tone='success'
          title={t('announce.published')}
          action={
            <Button variant='ghost' onClick={() => setPublished(null)}>
              {t('announcement.dismiss')}
            </Button>
          }
        >
          {published.emailRunId && <span>{t('announce.publishedEmail')}</span>}
        </Notice>
      )}

      <div className={styles.workspace}>
        <form
          className={styles.form}
          noValidate
          onSubmit={event => {
            event.preventDefault();
            setShowErrors(true);
            if (valid) setConfirming(true);
          }}
        >
          <FormSection title={t('announce.section.what')}>
            <Field
              label={t('announce.category')}
              required
              hint={t('announce.category.hint')}
              error={
                visible.category && !state.customCategory
                  ? t('announce.category.error')
                  : undefined
              }
            >
              {({ id, describedBy, invalid }) =>
                categories.length > 0 ? (
                  <Select
                    id={id}
                    aria-describedby={describedBy}
                    invalid={invalid}
                    value={categoryValue}
                    onChange={event =>
                      event.target.value === CUSTOM
                        ? update({ customCategory: true, category: '' })
                        : update({
                            customCategory: false,
                            category: event.target.value,
                          })
                    }
                  >
                    <option value='' disabled>
                      {t('announce.category.placeholder')}
                    </option>
                    {categories.map(c => (
                      <option key={c.code} value={c.code}>
                        {c.label}
                      </option>
                    ))}
                    <option value={CUSTOM}>
                      {t('announce.category.custom')}
                    </option>
                  </Select>
                ) : (
                  <TextInput
                    id={id}
                    aria-describedby={describedBy}
                    invalid={invalid}
                    value={state.category}
                    spellCheck={false}
                    placeholder='platform-release'
                    onChange={event => update({ category: event.target.value })}
                  />
                )
              }
            </Field>
            {state.customCategory && categories.length > 0 && (
              <Field
                label={t('announce.category.customCode')}
                required
                error={
                  visible.category ? t('announce.category.error') : undefined
                }
              >
                {({ id, describedBy, invalid }) => (
                  <TextInput
                    id={id}
                    aria-describedby={describedBy}
                    invalid={invalid}
                    value={state.category}
                    spellCheck={false}
                    onChange={event => update({ category: event.target.value })}
                  />
                )}
              </Field>
            )}
            <TemplateFields
              value={state}
              onChange={next => update(next)}
              templates={catalogue}
              errors={visible}
            />
          </FormSection>

          <FormSection title={t('announce.section.who')}>
            <Segmented
              name='nk-audience'
              value={state.audienceType}
              options={[
                { value: 'EVERYONE', label: t('announce.audience.EVERYONE') },
                { value: 'ROLE', label: t('announce.audience.ROLE') },
              ]}
              onChange={audienceType => update({ audienceType })}
            />
            {state.audienceType === 'ROLE' && (
              <Field
                label={t('announce.role')}
                required
                error={visible.audience ? t('announce.role.error') : undefined}
              >
                {({ id, describedBy, invalid }) =>
                  admin.roles.length > 0 ? (
                    <Select
                      id={id}
                      aria-describedby={describedBy}
                      invalid={invalid}
                      value={state.audienceValue}
                      onChange={event =>
                        update({ audienceValue: event.target.value })
                      }
                    >
                      <option value='' disabled>
                        {t('announce.role.placeholder')}
                      </option>
                      {admin.roles.map(r => (
                        <option key={r.code} value={r.code}>
                          {r.label}
                        </option>
                      ))}
                    </Select>
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

          <FormSection title={t('announce.section.when')}>
            <FieldSet legend={t('announce.from')}>
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
            </FieldSet>
            <div className={styles.grid2}>
              {!state.fromNow && (
                <Field
                  label={t('announce.from.at')}
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
            <div
              className={styles.confirm}
              role='alertdialog'
              aria-modal='false'
            >
              <strong>{t('announce.confirm.title')}</strong>
              <span>
                {state.audienceType === 'EVERYONE'
                  ? t('announce.confirm.everyone')
                  : t('announce.confirm.role', { role: roleLabel })}{' '}
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
          templateKey={templateKeyOf(draft)}
          channels={['IN_APP']}
          locales={state.template?.channels ?? {}}
          variables={variablesOf(draft)}
        />
      </div>

      {showPublished && <PublishedAnnouncements />}
    </div>
  );
}

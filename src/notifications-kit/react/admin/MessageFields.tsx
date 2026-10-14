import { useRef } from 'react';

import type { ContentErrors, MessageContent, VariablePair } from '../../core';
import { MAX_SUBJECT_LENGTH } from '../../core';
import { useNotificationsContext } from '../context';
import type { Translate } from '../messages';
import { Button, IconButton } from '../primitives';
import styles from './admin.module.css';
import { Field, Notice, Segmented, TextInput } from './forms';
import { htmlToText } from './richtext';
import { RichTextEditor } from './RichTextEditor';

export const EMPTY_FREEFORM: MessageContent = {
  mode: 'freeform',
  subject: '',
  bodyHtml: '',
  bodyText: '',
};

export const EMPTY_TEMPLATE: MessageContent = {
  mode: 'template',
  templateKey: '',
  variables: [{ name: '', value: '' }],
};

/** The starting content: the editor when the deployment has the free-form
 *  template, a template key otherwise. */
export function initialContent(freeformTemplateKey: string | undefined) {
  return freeformTemplateKey ? EMPTY_FREEFORM : EMPTY_TEMPLATE;
}

interface MessageFieldsProps {
  value: MessageContent;
  onChange: (next: MessageContent) => void;
  errors: ContentErrors;
}

/**
 * "Own text / Service template". Mounted in the section header; remembers
 * what was typed in the other mode, so switching back loses nothing.
 * Renders nothing without a free-form template or with `serviceTemplates`
 * off (the default).
 */
export function MessageModeSwitch({
  value,
  onChange,
}: {
  value: MessageContent;
  onChange: (next: MessageContent) => void;
}) {
  const { t, admin } = useNotificationsContext();
  const other = useRef<Partial<Record<MessageContent['mode'], MessageContent>>>(
    {}
  );
  if (!admin.freeformTemplateKey || !admin.serviceTemplates) return null;
  const switchMode = (mode: MessageContent['mode']) => {
    if (mode === value.mode) return;
    other.current[value.mode] = value;
    onChange(
      other.current[mode] ??
        (mode === 'freeform' ? EMPTY_FREEFORM : EMPTY_TEMPLATE)
    );
  };
  return (
    <Segmented
      name='nk-message-mode'
      label={t('compose.section.message')}
      value={value.mode}
      options={[
        { value: 'freeform', label: t('message.mode.freeform') },
        { value: 'template', label: t('message.mode.template') },
      ]}
      onChange={switchMode}
    />
  );
}

/** What the message says: text in the editor, or a service template by key. */
export function MessageFields({ value, onChange, errors }: MessageFieldsProps) {
  const { t, admin } = useNotificationsContext();
  const canWrite = Boolean(admin.freeformTemplateKey);
  return (
    <div className={styles.stack}>
      {value.mode === 'freeform' ? (
        canWrite ? (
          <FreeformFields
            value={value}
            onChange={onChange}
            errors={errors}
            t={t}
          />
        ) : (
          <Notice tone='warning' title={t('message.unavailable')} />
        )
      ) : (
        <TemplateKeyFields
          value={value}
          onChange={onChange}
          errors={errors}
          t={t}
        />
      )}
    </div>
  );
}

function FreeformFields({
  value,
  onChange,
  errors,
  t,
}: {
  value: Extract<MessageContent, { mode: 'freeform' }>;
  onChange: (next: MessageContent) => void;
  errors: ContentErrors;
  t: Translate;
}) {
  return (
    <>
      <Field
        label={t('message.subject')}
        required
        error={
          errors.subject === 'tooLong'
            ? t('message.subject.tooLong', { max: MAX_SUBJECT_LENGTH })
            : errors.subject
              ? t('admin.required')
              : undefined
        }
      >
        {({ id, describedBy, invalid }) => (
          <TextInput
            id={id}
            aria-describedby={describedBy}
            invalid={invalid}
            value={value.subject}
            maxLength={MAX_SUBJECT_LENGTH + 20}
            placeholder={t('message.subject.placeholder')}
            onChange={event =>
              onChange({ ...value, subject: event.target.value })
            }
          />
        )}
      </Field>
      <Field
        label={t('message.body')}
        required
        hint={t('message.body.hint')}
        error={
          errors.body === 'required' ? t('message.body.required') : undefined
        }
      >
        {({ id, describedBy, invalid }) => (
          <RichTextEditor
            id={id}
            describedBy={describedBy}
            invalid={invalid}
            value={value.bodyHtml}
            placeholder={t('message.body.placeholder')}
            ariaLabel={t('message.body')}
            onChange={bodyHtml =>
              onChange({ ...value, bodyHtml, bodyText: htmlToText(bodyHtml) })
            }
          />
        )}
      </Field>
    </>
  );
}

function TemplateKeyFields({
  value,
  onChange,
  errors,
  t,
}: {
  value: Extract<MessageContent, { mode: 'template' }>;
  onChange: (next: MessageContent) => void;
  errors: ContentErrors;
  t: Translate;
}) {
  const edit = (index: number, patch: Partial<VariablePair>) =>
    onChange({
      ...value,
      variables: value.variables.map((p, i) =>
        i === index ? { ...p, ...patch } : p
      ),
    });
  const keyError =
    errors.templateKey === 'pattern'
      ? t('template.error.pattern')
      : errors.templateKey === 'tooLong'
        ? t('template.error.tooLong')
        : errors.templateKey
          ? t('template.error.required')
          : undefined;
  const variablesError =
    errors.variables === 'duplicate'
      ? t('template.error.duplicate')
      : errors.variables === 'unnamed'
        ? t('template.error.unnamed')
        : undefined;

  return (
    <>
      <Field
        label={t('template.key')}
        required
        hint={t('template.keyHint')}
        error={keyError}
      >
        {({ id, describedBy, invalid }) => (
          <TextInput
            id={id}
            aria-describedby={describedBy}
            invalid={invalid}
            value={value.templateKey}
            spellCheck={false}
            autoComplete='off'
            placeholder='order.status-changed'
            onChange={event =>
              onChange({ ...value, templateKey: event.target.value })
            }
          />
        )}
      </Field>
      <div className={styles.stack}>
        <div className={styles.labelRow}>
          <span className={styles.label}>{t('template.variables')}</span>
          <span className={styles.fieldHint}>
            {t('template.variablesHint')}
          </span>
        </div>
        {value.variables.map((pair, index) => (
          <div key={index} className={styles.pairRow}>
            <TextInput
              aria-label={t('template.variableName')}
              placeholder={t('template.variableName')}
              value={pair.name}
              spellCheck={false}
              onChange={event => edit(index, { name: event.target.value })}
            />
            <TextInput
              aria-label={t('template.variableValue')}
              placeholder={t('template.variableValue')}
              value={pair.value}
              onChange={event => edit(index, { value: event.target.value })}
            />
            <IconButton
              icon='close'
              small
              label={t('template.removeVariable')}
              onClick={() =>
                onChange({
                  ...value,
                  variables: value.variables.filter((_, i) => i !== index),
                })
              }
            />
          </div>
        ))}
        {variablesError && (
          <span className={styles.fieldError} role='alert'>
            {variablesError}
          </span>
        )}
        <div>
          <Button
            variant='ghost'
            icon='plus'
            onClick={() =>
              onChange({
                ...value,
                variables: [...value.variables, { name: '', value: '' }],
              })
            }
          >
            {t('template.addVariable')}
          </Button>
        </div>
      </div>
    </>
  );
}

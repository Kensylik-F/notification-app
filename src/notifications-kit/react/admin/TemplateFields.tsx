import { channelsOf } from '../../core';
import type { Channel, TemplateDescriptor, VariablePair } from '../../core';
import { useNotificationsContext } from '../context';
import type { Translate } from '../messages';
import { Button, IconButton } from '../primitives';
import styles from './admin.module.css';
import { Field, Select, TextInput } from './forms';

export interface TemplateState {
  template: TemplateDescriptor | null;
  /** "Another key" is chosen: the key and the variables are typed by hand. */
  customMode: boolean;
  customTemplateKey: string;
  variables: Record<string, string>;
  customVariables: VariablePair[];
}

export const EMPTY_TEMPLATE_STATE: TemplateState = {
  template: null,
  customMode: false,
  customTemplateKey: '',
  variables: {},
  customVariables: [],
};

const CUSTOM = '__custom__';

export function templateLabel(
  template: TemplateDescriptor,
  labels: Readonly<Record<string, string>>
): string {
  const label = labels[template.key];
  return label ? `${label} (${template.key})` : template.key;
}

export function channelList(channels: readonly Channel[], t: Translate) {
  return channels.map(c => t(`channel.${c}`)).join(', ');
}

/** Languages of a template across its channels, de-duplicated. */
export function localesOf(template: TemplateDescriptor | null): string[] {
  if (!template) return [];
  return [...new Set(Object.values(template.channels).flat())].sort();
}

interface TemplateFieldsProps {
  value: TemplateState;
  onChange: (next: TemplateState) => void;
  templates: readonly TemplateDescriptor[];
  errors: { template?: string; variables?: string };
  /** Offer "another key" for templates the catalogue does not know yet. */
  allowCustom?: boolean;
}

/** Template choice and its variables. */
export function TemplateFields({
  value,
  onChange,
  templates,
  errors,
  allowCustom = true,
}: TemplateFieldsProps) {
  const { t, admin } = useNotificationsContext();
  const selected = value.customMode ? CUSTOM : (value.template?.key ?? '');

  const pick = (key: string) => {
    if (key === CUSTOM) {
      onChange({ ...value, template: null, customMode: true, variables: {} });
      return;
    }
    const template = templates.find(item => item.key === key) ?? null;
    // Keep what was typed for variables the new template also has.
    const variables: Record<string, string> = {};
    for (const variable of template?.variables ?? []) {
      const kept = value.variables[variable.name];
      if (kept !== undefined) variables[variable.name] = kept;
    }
    onChange({ ...value, template, customMode: false, variables });
  };

  const templateError =
    errors.template === 'pattern'
      ? t('template.error.pattern')
      : errors.template
        ? t('template.error.required')
        : undefined;

  const missing = new Set(
    errors.variables && value.template
      ? value.template.variables
          .filter(v => v.required && !(value.variables[v.name] ?? '').trim())
          .map(v => v.name)
      : []
  );

  const channels = value.template ? channelsOf(value.template) : [];
  const locales = localesOf(value.template);

  return (
    <div className={styles.stack}>
      <Field
        label={t('template.label')}
        required
        error={!value.customMode ? templateError : undefined}
        hint={
          value.template
            ? t('template.summary', {
                channels: channelList(channels, t),
                locales: locales.join(', '),
              })
            : t('template.hint')
        }
      >
        {({ id, describedBy, invalid }) => (
          <Select
            id={id}
            aria-describedby={describedBy}
            invalid={invalid}
            value={selected}
            onChange={event => pick(event.target.value)}
          >
            <option value='' disabled>
              {t('template.placeholder')}
            </option>
            {templates.map(template => (
              <option key={template.key} value={template.key}>
                {templateLabel(template, admin.templateLabels)}
              </option>
            ))}
            {allowCustom && (
              <option value={CUSTOM}>{t('template.custom')}</option>
            )}
          </Select>
        )}
      </Field>

      {value.customMode && (
        <Field
          label={t('template.customKey')}
          required
          error={templateError}
          hint={t('template.customKeyHint')}
        >
          {({ id, describedBy, invalid }) => (
            <TextInput
              id={id}
              aria-describedby={describedBy}
              invalid={invalid}
              value={value.customTemplateKey}
              spellCheck={false}
              autoComplete='off'
              placeholder='order.status-changed'
              onChange={event =>
                onChange({ ...value, customTemplateKey: event.target.value })
              }
            />
          )}
        </Field>
      )}

      {value.template && value.template.variables.length > 0 && (
        <div className={styles.grid2}>
          {value.template.variables.map(variable => (
            <Field
              key={variable.name}
              label={admin.variableLabels[variable.name] ?? variable.name}
              required={variable.required}
              error={
                missing.has(variable.name) ? t('admin.required') : undefined
              }
            >
              {({ id, describedBy, invalid }) => (
                <TextInput
                  id={id}
                  aria-describedby={describedBy}
                  invalid={invalid}
                  value={value.variables[variable.name] ?? ''}
                  onChange={event =>
                    onChange({
                      ...value,
                      variables: {
                        ...value.variables,
                        [variable.name]: event.target.value,
                      },
                    })
                  }
                />
              )}
            </Field>
          ))}
        </div>
      )}

      {value.customMode && (
        <CustomVariables
          pairs={value.customVariables}
          onChange={customVariables => onChange({ ...value, customVariables })}
          t={t}
        />
      )}
    </div>
  );
}

function CustomVariables({
  pairs,
  onChange,
  t,
}: {
  pairs: VariablePair[];
  onChange: (pairs: VariablePair[]) => void;
  t: Translate;
}) {
  const edit = (index: number, patch: Partial<VariablePair>) =>
    onChange(pairs.map((p, i) => (i === index ? { ...p, ...patch } : p)));
  return (
    <div className={styles.stack}>
      <span className={styles.label}>{t('template.customVariables')}</span>
      {pairs.map((pair, index) => (
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
            onClick={() => onChange(pairs.filter((_, i) => i !== index))}
          />
        </div>
      ))}
      <div>
        <Button
          variant='ghost'
          icon='plus'
          onClick={() => onChange([...pairs, { name: '', value: '' }])}
        >
          {t('template.addVariable')}
        </Button>
      </div>
    </div>
  );
}

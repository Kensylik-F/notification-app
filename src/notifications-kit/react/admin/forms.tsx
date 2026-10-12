/**
 * Native form controls styled with the kit's variables. Native on purpose:
 * keyboard, autofill, mobile pickers and screen readers work without code.
 */
import { useId, useRef, useState } from 'react';
import type {
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from 'react';

import { useIndicator } from '../motion';
import { Icon, cx } from '../primitives';
import type { IconName } from '../primitives';
import styles from './admin.module.css';

interface FieldProps {
  label: ReactNode;
  /** Shown under the control while there is no error. */
  hint?: ReactNode;
  error?: ReactNode;
  required?: boolean;
  /** Receives the ids to wire to the control. */
  children: (ids: {
    id: string;
    describedBy: string | undefined;
    invalid: boolean;
  }) => ReactNode;
  className?: string;
}

export function Field({
  label,
  hint,
  error,
  required,
  children,
  className,
}: FieldProps) {
  const id = useId();
  const noteId = `${id}-note`;
  const note = error || hint;
  return (
    <div className={cx(styles.field, className)}>
      <label className={styles.label} htmlFor={id}>
        {label}
        {required && (
          <span className={styles.requiredMark} aria-hidden='true'>
            {' '}
            *
          </span>
        )}
      </label>
      {children({
        id,
        describedBy: note ? noteId : undefined,
        invalid: Boolean(error),
      })}
      {note && (
        <span
          id={noteId}
          className={error ? styles.fieldError : styles.fieldHint}
          role={error ? 'alert' : undefined}
        >
          {note}
        </span>
      )}
    </div>
  );
}

/** A group of controls with one caption (radio sets, checkbox chips). */
export function FieldSet({
  legend,
  hint,
  error,
  children,
  className,
}: {
  legend: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <fieldset className={cx(styles.fieldset, className)}>
      <legend className={styles.label}>{legend}</legend>
      {children}
      {(error || hint) && (
        <span
          className={error ? styles.fieldError : styles.fieldHint}
          role={error ? 'alert' : undefined}
        >
          {error || hint}
        </span>
      )}
    </fieldset>
  );
}

export function TextInput({
  className,
  invalid,
  ...rest
}: InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }) {
  return (
    <input
      className={cx(styles.input, className)}
      aria-invalid={invalid || undefined}
      {...rest}
    />
  );
}

export function TextArea({
  className,
  invalid,
  ...rest
}: TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }) {
  return (
    <textarea
      className={cx(styles.input, styles.textarea, className)}
      aria-invalid={invalid || undefined}
      {...rest}
    />
  );
}

export function Select({
  className,
  invalid,
  children,
  ...rest
}: SelectHTMLAttributes<HTMLSelectElement> & { invalid?: boolean }) {
  return (
    <select
      className={cx(styles.input, styles.select, className)}
      aria-invalid={invalid || undefined}
      {...rest}
    >
      {children}
    </select>
  );
}

export interface ChoiceOption<T extends string> {
  value: T;
  label: ReactNode;
  disabled?: boolean;
}

/** One of a few: a segmented row of radio buttons with a sliding thumb. */
export function Segmented<T extends string>({
  name,
  value,
  options,
  onChange,
  label,
}: {
  /** Prefix of the radio group name; the group is unique per instance. */
  name?: string;
  value: T;
  options: readonly ChoiceOption<T>[];
  onChange: (value: T) => void;
  /** Accessible name of the group. */
  label?: string;
}) {
  // Two forms on one page must not share a radio group.
  const group = `${name ?? 'nk-choice'}-${useId()}`;
  const ref = useRef<HTMLDivElement>(null);
  const box = useIndicator(ref, '[data-checked="true"]', [
    value,
    options.length,
  ]);
  return (
    <div
      ref={ref}
      className={styles.segmented}
      role='radiogroup'
      aria-label={label}
    >
      {box && (
        <span
          className={styles.segmentThumb}
          aria-hidden='true'
          style={{
            width: box.width,
            height: box.height,
            transform: `translate(${box.left}px, ${box.top}px)`,
          }}
        />
      )}
      {options.map(option => (
        <label
          key={option.value}
          className={styles.segment}
          data-checked={option.value === value}
          data-disabled={option.disabled || undefined}
        >
          <input
            type='radio'
            name={group}
            value={option.value}
            checked={option.value === value}
            disabled={option.disabled}
            onChange={() => onChange(option.value)}
          />
          <span>{option.label}</span>
        </label>
      ))}
    </div>
  );
}

export interface TileOption<T extends string> extends ChoiceOption<T> {
  icon: IconName;
}

/** Several of a few, as tiles with an icon and a check mark (channels). */
export function CheckTiles<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: readonly T[];
  options: readonly TileOption<T>[];
  onChange: (value: T[]) => void;
  label?: string;
}) {
  return (
    <div className={styles.tiles} role='group' aria-label={label}>
      {options.map(option => {
        const checked = value.includes(option.value);
        return (
          <label
            key={option.value}
            className={styles.tile}
            data-checked={checked}
            data-disabled={option.disabled || undefined}
          >
            <input
              type='checkbox'
              checked={checked}
              disabled={option.disabled}
              onChange={() =>
                onChange(
                  checked
                    ? value.filter(v => v !== option.value)
                    : [...value, option.value]
                )
              }
            />
            <span className={styles.tileTop}>
              <span className={styles.tileIcon}>
                <Icon name={option.icon} size={20} />
              </span>
              <span className={styles.tileCheck} aria-hidden='true'>
                <Icon name='check' size={12} weight={3.5} />
              </span>
            </span>
            <span className={styles.tileLabel}>{option.label}</span>
          </label>
        );
      })}
    </div>
  );
}

/** Several of a few: checkbox chips. */
export function CheckChips<T extends string>({
  value,
  options,
  onChange,
}: {
  value: readonly T[];
  options: readonly ChoiceOption<T>[];
  onChange: (value: T[]) => void;
}) {
  return (
    <div className={styles.chips}>
      {options.map(option => {
        const checked = value.includes(option.value);
        return (
          <label
            key={option.value}
            className={styles.chip}
            data-checked={checked}
            data-disabled={option.disabled || undefined}
          >
            <input
              type='checkbox'
              checked={checked}
              disabled={option.disabled}
              onChange={() =>
                onChange(
                  checked
                    ? value.filter(v => v !== option.value)
                    : [...value, option.value]
                )
              }
            />
            <span>{option.label}</span>
          </label>
        );
      })}
    </div>
  );
}

/** A titled block of a form; `aside` sits at the right of the title. */
export function FormSection({
  title,
  children,
  aside,
}: {
  title: ReactNode;
  children: ReactNode;
  aside?: ReactNode;
}) {
  return (
    <section className={styles.section}>
      <header className={styles.sectionHeader}>
        <h3 className={styles.sectionTitle}>{title}</h3>
        {aside}
      </header>
      <div className={styles.sectionBody}>{children}</div>
    </section>
  );
}

/** A link-like toggle that unfolds more fields, with the height animated. */
export function Disclosure({
  summary,
  children,
}: {
  summary: ReactNode;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <div className={styles.disclosure} data-open={open}>
      <button
        type='button'
        className={styles.disclosureButton}
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen(v => !v)}
      >
        {summary}
        <Icon name='chevron' size={12} weight={2.4} />
      </button>
      <div id={id} className={styles.disclosureBody} aria-hidden={!open}>
        <div className={styles.disclosureInner}>{children}</div>
      </div>
    </div>
  );
}

/** A short coloured message: success, warning, error. */
export function Notice({
  tone = 'info',
  title,
  children,
  action,
}: {
  tone?: 'info' | 'success' | 'warning' | 'error';
  title?: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div
      className={styles.notice}
      data-tone={tone}
      role={tone === 'error' ? 'alert' : 'status'}
    >
      <div className={styles.noticeText}>
        {title && <strong className={styles.noticeTitle}>{title}</strong>}
        {children}
      </div>
      {action}
    </div>
  );
}

// ----------------------------------------------------------- date and time

const pad = (n: number) => String(n).padStart(2, '0');

/** `Date` → the value of `<input type="datetime-local">`, in local time. */
export function toLocalInput(date: Date): string {
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

/** `<input type="date">` value → the ISO instant of that local midnight
 *  (`endOfDay` - of the last millisecond of that day). */
export function localDateToIso(value: string, endOfDay = false): string {
  if (!value) return '';
  const [y, m, d] = value.split('-').map(Number);
  if (!y || !m || !d) return '';
  const date = endOfDay
    ? new Date(y, m - 1, d, 23, 59, 59, 999)
    : new Date(y, m - 1, d);
  return date.toISOString();
}

/** After a failed submit: bring the first marked field into view, once the
 *  errors have rendered. */
export function revealFirstError(root: HTMLElement | null) {
  requestAnimationFrame(() => {
    const target = root?.querySelector<HTMLElement>(
      '[aria-invalid="true"], [data-invalid="true"], [role="alert"]'
    );
    target?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  });
}

/**
 * A select and a combobox drawn by the kit, so the open list looks like the
 * rest of the page instead of the operating system's menu.
 */
import { useEffect, useId, useRef, useState } from 'react';
import type { KeyboardEvent, ReactNode, RefObject } from 'react';

import { Icon, cx } from '../primitives';
import styles from './admin.module.css';

export interface DropdownOption<T extends string = string> {
  value: T;
  label: ReactNode;
  /** Second line under the label. */
  hint?: ReactNode;
}

function useOutside(
  open: boolean,
  ref: RefObject<HTMLElement | null>,
  close: () => void
) {
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) close();
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open, ref, close]);
}

function OptionList<T extends string>({
  id,
  options,
  active,
  selected,
  onPick,
  onHover,
  empty,
}: {
  id: string;
  options: readonly DropdownOption<T>[];
  active: number;
  selected?: T;
  onPick: (value: T) => void;
  onHover: (index: number) => void;
  empty?: ReactNode;
}) {
  return (
    <ul id={id} role='listbox' className={styles.menu}>
      {options.map((option, index) => (
        <li
          key={option.value}
          id={`${id}-${index}`}
          role='option'
          aria-selected={option.value === selected}
          data-active={index === active || undefined}
          className={styles.menuItem}
          onPointerDown={event => {
            event.preventDefault();
            onPick(option.value);
          }}
          onPointerEnter={() => onHover(index)}
        >
          <span className={styles.menuLabel}>{option.label}</span>
          {option.hint && (
            <span className={styles.menuHint}>{option.hint}</span>
          )}
          {option.value === selected && (
            <span className={styles.menuCheck} aria-hidden='true'>
              ✓
            </span>
          )}
        </li>
      ))}
      {options.length === 0 && empty && (
        <li className={styles.menuEmpty} aria-disabled='true'>
          {empty}
        </li>
      )}
    </ul>
  );
}

interface DropdownProps<T extends string> {
  value: T | '';
  options: readonly DropdownOption<T>[];
  onChange: (value: T) => void;
  placeholder?: ReactNode;
  id?: string;
  invalid?: boolean;
  describedBy?: string;
  disabled?: boolean;
  className?: string;
}

/** One of a list. Keyboard: arrows, Enter, Escape, Home/End. */
export function Dropdown<T extends string>({
  value,
  options,
  onChange,
  placeholder,
  id,
  invalid,
  describedBy,
  disabled,
  className,
}: DropdownProps<T>) {
  const [open, setOpen] = useState(false);
  const selectedIndex = options.findIndex(o => o.value === value);
  const [active, setActive] = useState(Math.max(0, selectedIndex));
  const rootRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const close = useRef(() => setOpen(false)).current;
  useOutside(open, rootRef, close);

  const pick = (next: T) => {
    onChange(next);
    setOpen(false);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return;
    const last = options.length - 1;
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        if (!open) {
          setActive(Math.max(0, selectedIndex));
          setOpen(true);
        } else setActive(i => Math.min(last, i + 1));
        break;
      case 'ArrowUp':
        event.preventDefault();
        if (open) setActive(i => Math.max(0, i - 1));
        break;
      case 'Home':
        if (open) setActive(0);
        break;
      case 'End':
        if (open) setActive(last);
        break;
      case 'Enter':
      case ' ':
        event.preventDefault();
        if (open && options[active]) pick(options[active].value);
        else {
          setActive(Math.max(0, selectedIndex));
          setOpen(true);
        }
        break;
      case 'Escape':
        if (open) {
          event.preventDefault();
          setOpen(false);
        }
        break;
      case 'Tab':
        setOpen(false);
        break;
    }
  };

  const selected = options[selectedIndex];

  return (
    <div ref={rootRef} className={cx(styles.dropdown, className)}>
      <button
        type='button'
        id={id}
        className={cx(styles.input, styles.dropdownButton)}
        role='combobox'
        aria-haspopup='listbox'
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={open ? `${listId}-${active}` : undefined}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        disabled={disabled}
        onClick={() => {
          setActive(Math.max(0, selectedIndex));
          setOpen(v => !v);
        }}
        onKeyDown={onKeyDown}
      >
        <span
          className={cx(styles.dropdownValue, !selected && styles.placeholder)}
        >
          {selected ? selected.label : placeholder}
        </span>
        <span className={styles.dropdownChevron} data-open={open || undefined}>
          <Icon name='chevron' small />
        </span>
      </button>
      {open && (
        <div className={styles.popover}>
          <OptionList
            id={listId}
            options={options}
            active={active}
            selected={value || undefined}
            onPick={pick}
            onHover={setActive}
          />
        </div>
      )}
    </div>
  );
}

interface ComboboxProps {
  value: string;
  onChange: (value: string) => void;
  /** Suggestions; typing filters them by value and label. */
  options: readonly DropdownOption[];
  placeholder?: string;
  id?: string;
  invalid?: boolean;
  describedBy?: string;
}

/** Free text with suggestions (e.g. a category code). */
export function Combobox({
  value,
  onChange,
  options,
  placeholder,
  id,
  invalid,
  describedBy,
}: ComboboxProps) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const close = useRef(() => setOpen(false)).current;
  useOutside(open, rootRef, close);

  const query = value.trim().toLowerCase();
  const matches = options.filter(o => {
    if (!query) return true;
    const label = typeof o.label === 'string' ? o.label : '';
    return (
      o.value.toLowerCase().includes(query) ||
      label.toLowerCase().includes(query)
    );
  });
  const shown = open && matches.length > 0;
  const known = options.find(o => o.value === value.trim());

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (!open) setOpen(true);
      else setActive(i => Math.min(matches.length - 1, i + 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive(i => Math.max(0, i - 1));
    } else if (event.key === 'Enter' && shown && matches[active]) {
      event.preventDefault();
      onChange(matches[active].value);
      setOpen(false);
    } else if (event.key === 'Escape') {
      setOpen(false);
    }
  };

  return (
    <div ref={rootRef} className={styles.dropdown}>
      <input
        id={id}
        className={styles.input}
        value={value}
        placeholder={placeholder}
        role='combobox'
        aria-autocomplete='list'
        aria-expanded={shown}
        aria-controls={listId}
        aria-activedescendant={shown ? `${listId}-${active}` : undefined}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        autoComplete='off'
        spellCheck={false}
        onChange={event => {
          onChange(event.target.value);
          setActive(0);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={onKeyDown}
        data-labelled={known ? true : undefined}
      />
      {known && (
        <span className={styles.comboLabel} aria-hidden='true'>
          {known.label}
        </span>
      )}
      {shown && (
        <div className={styles.popover}>
          <OptionList
            id={listId}
            options={matches}
            active={active}
            selected={value.trim()}
            onPick={next => {
              onChange(next);
              setOpen(false);
            }}
            onHover={setActive}
          />
        </div>
      )}
    </div>
  );
}

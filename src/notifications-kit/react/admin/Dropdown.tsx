/**
 * A select and a combobox drawn by the kit, so the open list looks like the
 * rest of the page instead of the operating system's menu.
 */
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent, ReactNode, RefObject } from 'react';
import { createPortal } from 'react-dom';

import { Icon, cx } from '../primitives';
import kitStyles from '../styles.module.css';
import styles from './admin.module.css';

export interface DropdownOption<T extends string = string> {
  value: T;
  label: ReactNode;
  /** Second line under the label. */
  hint?: ReactNode;
}

function useOutside(
  open: boolean,
  refs: readonly RefObject<HTMLElement | null>[],
  close: () => void
) {
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!refs.some(ref => ref.current?.contains(target))) close();
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open, refs, close]);
}

const LIST_MAX_HEIGHT = 280;
const LIST_GAP = 4;
const VIEWPORT_MARGIN = 8;

/** Fixed position under the field, or above it when there is no room. */
function placeUnder(anchor: HTMLElement): CSSProperties {
  const box = anchor.getBoundingClientRect();
  const below = window.innerHeight - box.bottom - LIST_GAP - VIEWPORT_MARGIN;
  const above = box.top - LIST_GAP - VIEWPORT_MARGIN;
  const up = below < Math.min(LIST_MAX_HEIGHT, 160) && above > below;
  const room = Math.max(120, up ? above : below);
  return {
    position: 'fixed',
    left: box.left,
    width: box.width,
    maxHeight: Math.min(LIST_MAX_HEIGHT, room),
    ...(up
      ? { bottom: window.innerHeight - box.top + LIST_GAP }
      : { top: box.bottom + LIST_GAP }),
  };
}

/**
 * The open list, portalled to <body>. Inside the form it lived in the
 * field's stacking context: a later section (or a host card with its own
 * stacking context) was painted over it, showed through it and took its
 * clicks. On <body> nothing on the page can cover or clip it.
 */
function FloatingList({
  anchorRef,
  listRef,
  children,
}: {
  anchorRef: RefObject<HTMLElement>;
  listRef: RefObject<HTMLDivElement>;
  children: ReactNode;
}) {
  const [style, setStyle] = useState<CSSProperties | null>(null);

  useLayoutEffect(() => {
    const place = () => {
      if (anchorRef.current) setStyle(placeUnder(anchorRef.current));
    };
    place();
    const onScroll = (event: Event) => {
      // Scrolling the list itself does not move the field.
      if (listRef.current?.contains(event.target as Node)) return;
      place();
    };
    window.addEventListener('resize', place);
    // Capture: a scroll inside any container can move the field.
    window.addEventListener('scroll', onScroll, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [anchorRef, listRef]);

  if (typeof document === 'undefined') return null;
  return createPortal(
    <div
      ref={listRef}
      className={cx(kitStyles.root, styles.root, styles.popover)}
      style={style ?? { position: 'fixed', visibility: 'hidden' }}
      // Keeps focus in the field: a combobox closes on blur.
      onPointerDown={event => event.preventDefault()}
    >
      {children}
    </div>,
    document.body
  );
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
  const listRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const close = useRef(() => setOpen(false)).current;
  const insideRefs = useRef([rootRef, listRef]).current;
  useOutside(open, insideRefs, close);

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
        <FloatingList anchorRef={rootRef} listRef={listRef}>
          <OptionList
            id={listId}
            options={options}
            active={active}
            selected={value || undefined}
            onPick={pick}
            onHover={setActive}
          />
        </FloatingList>
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
  const listRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const close = useRef(() => setOpen(false)).current;
  const insideRefs = useRef([rootRef, listRef]).current;
  useOutside(open, insideRefs, close);

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
        onClick={() => setOpen(true)}
        data-chevron={options.length > 0 || undefined}
        onBlur={() => setOpen(false)}
        onKeyDown={onKeyDown}
        data-labelled={known ? true : undefined}
      />
      {known && (
        <span
          className={styles.comboLabel}
          data-with-chevron={options.length > 0 || undefined}
          aria-hidden='true'
        >
          {known.label}
        </span>
      )}
      {options.length > 0 && (
        <span className={styles.comboChevron} aria-hidden='true'>
          <Icon name='chevron' small />
        </span>
      )}
      {shown && (
        <FloatingList anchorRef={rootRef} listRef={listRef}>
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
        </FloatingList>
      )}
    </div>
  );
}

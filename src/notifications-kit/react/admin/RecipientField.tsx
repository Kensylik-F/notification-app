import { useEffect, useId, useRef, useState } from 'react';
import type { ClipboardEvent, KeyboardEvent } from 'react';

import { MAX_RECIPIENTS, recipientFromInput } from '../../core';
import type { RecipientDraft } from '../../core';
import { useNotificationsContext } from '../context';
import { Button, IconButton, Spinner } from '../primitives';
import styles from './admin.module.css';

interface RecipientFieldProps {
  value: RecipientDraft[];
  onChange: (next: RecipientDraft[]) => void;
  error?: string;
}

const SEARCH_DELAY_MS = 300;
const MIN_QUERY = 2;

function addUnique(
  list: RecipientDraft[],
  more: RecipientDraft[]
): RecipientDraft[] {
  const known = new Set(list.map(r => r.id));
  const next = [...list];
  for (const r of more) {
    if (known.has(r.id)) continue;
    known.add(r.id);
    next.push(r);
  }
  return next;
}

/**
 * People to send to. With the host's `searchRecipients` it suggests people
 * as you type; anything else typed is taken as an e-mail address or a user
 * id. A pasted list (commas, semicolons, new lines) is split into entries.
 */
export function RecipientField({
  value,
  onChange,
  error,
}: RecipientFieldProps) {
  const { t, admin } = useNotificationsContext();
  const search = admin.searchRecipients;
  const [text, setText] = useState('');
  const [suggestions, setSuggestions] = useState<RecipientDraft[]>([]);
  const [searching, setSearching] = useState(false);
  const [active, setActive] = useState(0);
  const [open, setOpen] = useState(false);
  const inputId = useId();
  const listId = `${inputId}-list`;
  const noteId = `${inputId}-note`;
  const boxRef = useRef<HTMLDivElement>(null);

  const query = text.trim();

  useEffect(() => {
    if (!search || query.length < MIN_QUERY) {
      setSuggestions([]);
      setSearching(false);
      return;
    }
    const controller = new AbortController();
    setSearching(true);
    const timer = setTimeout(() => {
      search(query, controller.signal)
        .then(found => {
          if (controller.signal.aborted) return;
          setSuggestions(found.slice(0, 8));
          setActive(0);
        })
        .catch(() => {
          if (!controller.signal.aborted) setSuggestions([]);
        })
        .finally(() => {
          if (!controller.signal.aborted) setSearching(false);
        });
    }, SEARCH_DELAY_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [search, query]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!boxRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  const add = (more: RecipientDraft[]) => {
    onChange(addUnique(value, more));
    setText('');
    setSuggestions([]);
    setOpen(false);
  };

  const addTyped = () => {
    const draft = recipientFromInput(text);
    if (draft) add([draft]);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    const shown = open && suggestions.length > 0;
    if (event.key === 'ArrowDown' && shown) {
      event.preventDefault();
      setActive(i => (i + 1) % suggestions.length);
    } else if (event.key === 'ArrowUp' && shown) {
      event.preventDefault();
      setActive(i => (i - 1 + suggestions.length) % suggestions.length);
    } else if (
      event.key === 'Enter' ||
      event.key === ',' ||
      event.key === ';'
    ) {
      if (!query) return;
      event.preventDefault();
      const picked = shown ? suggestions[active] : undefined;
      if (picked && event.key === 'Enter') add([picked]);
      else addTyped();
    } else if (event.key === 'Escape') {
      setOpen(false);
    } else if (event.key === 'Backspace' && !text && value.length > 0) {
      onChange(value.slice(0, -1));
    }
  };

  const onPaste = (event: ClipboardEvent<HTMLInputElement>) => {
    const pasted = event.clipboardData.getData('text');
    const parts = pasted
      .split(/[\n,;\t]+/)
      .map(p => p.trim())
      .filter(Boolean);
    if (parts.length < 2) return;
    event.preventDefault();
    add(
      parts
        .map(recipientFromInput)
        .filter((r): r is RecipientDraft => r !== null)
    );
  };

  const remove = (id: string) => onChange(value.filter(r => r.id !== id));

  const errorText =
    error === 'tooMany'
      ? t('recipients.error.tooMany', { max: MAX_RECIPIENTS })
      : error
        ? t('recipients.error.required')
        : undefined;

  const showList = open && query.length >= MIN_QUERY && Boolean(search);

  return (
    <div className={styles.field} ref={boxRef}>
      <div className={styles.labelRow}>
        <label className={styles.label} htmlFor={inputId}>
          {t('recipients.label')}
          <span className={styles.requiredMark} aria-hidden='true'>
            {' '}
            *
          </span>
        </label>
        <span
          className={styles.counter}
          data-over={value.length > MAX_RECIPIENTS}
        >
          {t('recipients.count', { count: value.length, max: MAX_RECIPIENTS })}
        </span>
      </div>
      <div
        className={styles.recipientBox}
        data-invalid={Boolean(errorText) || undefined}
        onClick={() => document.getElementById(inputId)?.focus()}
      >
        {value.map(r => (
          <span key={r.id} className={styles.token} title={r.hint ?? r.label}>
            <span className={styles.tokenText}>{r.label}</span>
            <IconButton
              icon='close'
              small
              className={styles.tokenRemove}
              label={t('recipients.remove', { name: r.label })}
              onClick={event => {
                event.stopPropagation();
                remove(r.id);
              }}
            />
          </span>
        ))}
        <input
          id={inputId}
          className={styles.tokenInput}
          value={text}
          role={search ? 'combobox' : undefined}
          aria-expanded={search ? showList : undefined}
          aria-controls={search ? listId : undefined}
          aria-autocomplete={search ? 'list' : undefined}
          aria-activedescendant={
            showList && suggestions[active] ? `${listId}-${active}` : undefined
          }
          aria-describedby={noteId}
          aria-invalid={Boolean(errorText) || undefined}
          autoComplete='off'
          spellCheck={false}
          placeholder={
            value.length === 0
              ? search
                ? t('recipients.placeholderSearch')
                : t('recipients.placeholder')
              : undefined
          }
          onChange={event => {
            setText(event.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          onBlur={() => {
            // Typed text is not lost when the person tabs away.
            if (!search && query) addTyped();
          }}
        />
        {showList && (
          <div className={styles.suggestions} role='presentation'>
            {searching && suggestions.length === 0 ? (
              <span className={styles.suggestionNote}>
                <Spinner label={t('recipients.searching')} />
                {t('recipients.searching')}
              </span>
            ) : (
              <ul id={listId} role='listbox' className={styles.suggestionList}>
                {suggestions.map((r, index) => (
                  <li
                    key={r.id}
                    id={`${listId}-${index}`}
                    role='option'
                    aria-selected={index === active}
                    className={styles.suggestion}
                    onPointerDown={event => {
                      event.preventDefault();
                      add([r]);
                    }}
                    onPointerEnter={() => setActive(index)}
                  >
                    <span>{r.label}</span>
                    {r.hint && (
                      <span className={styles.suggestionHint}>{r.hint}</span>
                    )}
                  </li>
                ))}
                {suggestions.length === 0 && (
                  <li className={styles.suggestionNote} aria-disabled='true'>
                    {t('recipients.noMatches')}
                  </li>
                )}
              </ul>
            )}
          </div>
        )}
      </div>
      <div className={styles.labelRow}>
        <span
          id={noteId}
          className={errorText ? styles.fieldError : styles.fieldHint}
          role={errorText ? 'alert' : undefined}
        >
          {errorText ?? t('recipients.hint')}
        </span>
        {value.length > 3 && (
          <Button variant='ghost' onClick={() => onChange([])}>
            {t('recipients.clear')}
          </Button>
        )}
      </div>
    </div>
  );
}

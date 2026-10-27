/**
 * What the announcement screens share: the views a category class stands
 * for, their labels, the in-page preview, the preview language.
 */
import { useState } from 'react';

import type { AudienceType, CategoryClass, MessageContent } from '../../core';
import { useNotificationsContext } from '../context';
import type { AnnouncementPresentation } from '../presentation';
import { useKitPreview } from '../preview';
import styles from './admin.module.css';
import { FieldSet, Segmented } from './forms';
import {
  previewAnnouncementEntry,
  useFetchPreview,
  usePreviewRequest,
} from './Preview';

export const CLASSES: CategoryClass[] = [
  'TRANSACTIONAL',
  'PLATFORM',
  'MARKETING',
];

export function useLabels() {
  const { admin, t } = useNotificationsContext();
  return {
    category: (code: string) =>
      admin.categories.find(c => c.code === code)?.label ?? code,
    role: (code: string | null | undefined) =>
      admin.roles.find(r => r.code === code)?.label ?? code ?? '',
    audience: (type: AudienceType | null | undefined, value?: string | null) =>
      type === 'ROLE'
        ? `${t('announce.audience.ROLE')}: ${
            admin.roles.find(r => r.code === value)?.label ?? value ?? ''
          }`
        : t('announce.audience.EVERYONE'),
  };
}

/** How the host shows an announcement of this category: by the class the
 *  host knows for it (`admin.categories`), else as one without a class. */
export function usePresentationOf() {
  const { resolvePresentation, admin } = useNotificationsContext();
  const classOf = (category: string): CategoryClass | null => {
    const code = category.trim();
    const own = CLASSES.find(cls => admin.announcementCategories[cls] === code);
    return (
      own ?? admin.categories.find(c => c.code === code)?.categoryClass ?? null
    );
  };
  const presentationOf = (category: string): AnnouncementPresentation =>
    resolvePresentation({
      id: 'probe',
      category: category.trim() || null,
      categoryClass: classOf(category),
      locale: null,
      subject: null,
      bodyText: null,
      bodyHtml: null,
      publishedAt: null,
      visibleFrom: null,
      visibleUntil: null,
      dismissed: false,
    });
  presentationOf.known = (category: string) => classOf(category) !== null;
  presentationOf.classOf = classOf;
  /** How the cabinet shows an announcement of this class. */
  presentationOf.ofClass = (categoryClass: CategoryClass) =>
    resolvePresentation({
      id: 'probe',
      category: null,
      categoryClass,
      locale: null,
      subject: null,
      bodyText: null,
      bodyHtml: null,
      publishedAt: null,
      visibleFrom: null,
      visibleUntil: null,
      dismissed: false,
    });
  return presentationOf;
}

/**
 * Plays an announcement out on this page, where and how it would show:
 * the service renders it for the in-app channel, the kit puts it among the
 * overlays (the deck, a dialog or a strip) marked as a preview.
 */
export function useAnnouncementPreview(
  content: MessageContent,
  previewLocale?: string
) {
  const [, setKitPreview] = useKitPreview();
  const fetchPreview = useFetchPreview();
  const requestFor = usePreviewRequest(content, previewLocale);
  const presentationOf = usePresentationOf();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [none, setNone] = useState(false);

  const run = async (category: string, visibleUntil: string | null) => {
    const request = requestFor('IN_APP');
    if (!request) return;
    setBusy(true);
    setError(null);
    setNone(false);
    try {
      const result = await fetchPreview(request);
      const until = visibleUntil ? new Date(visibleUntil) : null;
      const entry = previewAnnouncementEntry(result, {
        category: category.trim() || null,
        categoryClass: presentationOf.classOf(category),
        visibleUntil:
          until && !Number.isNaN(until.getTime()) ? until.toISOString() : null,
      });
      const presentation = presentationOf(category);
      if (presentation === 'none') setNone(true);
      else setKitPreview({ kind: 'announcement', entry, presentation });
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  };

  return {
    run,
    busy,
    error,
    none,
    clear: () => {
      setError(null);
      setNone(false);
    },
  };
}

export const PRESENTATION_ICON: Record<
  Exclude<AnnouncementPresentation, 'none'>,
  JSX.Element
> = {
  corner: (
    <svg
      width='28'
      height='20'
      viewBox='0 0 28 20'
      fill='none'
      aria-hidden='true'
    >
      <rect x='.5' y='.5' width='27' height='19' rx='3' stroke='currentColor' />
      <rect x='15' y='3' width='10' height='6' rx='1.5' fill='currentColor' />
    </svg>
  ),
  modal: (
    <svg
      width='28'
      height='20'
      viewBox='0 0 28 20'
      fill='none'
      aria-hidden='true'
    >
      <rect x='.5' y='.5' width='27' height='19' rx='3' stroke='currentColor' />
      <rect x='8' y='5' width='12' height='10' rx='1.5' fill='currentColor' />
    </svg>
  ),
  toast: (
    <svg
      width='28'
      height='20'
      viewBox='0 0 28 20'
      fill='none'
      aria-hidden='true'
    >
      <rect x='.5' y='.5' width='27' height='19' rx='3' stroke='currentColor' />
      <rect x='5' y='3' width='18' height='4' rx='1.5' fill='currentColor' />
    </svg>
  ),
};

/**
 * "How to show": one tile per category class. A click picks the category
 * of that class from `admin.announcementCategories` (`custom-transitions`,
 * `custom-notice`, `custom-marketing` by default); there is no separate
 * category field.
 */
export function ViewPicker({
  category,
  onChange,
  error,
}: {
  category: string;
  onChange: (category: string) => void;
  error?: string;
}) {
  const { t, admin } = useNotificationsContext();
  const presentationOf = usePresentationOf();
  const labels = useLabels();
  const categoryOfClass = (cls: CategoryClass) =>
    admin.announcementCategories[cls] || undefined;
  const picked = category.trim();
  const pickedClass = presentationOf.classOf(picked);

  return (
    <>
      <FieldSet legend={t('announce.view')} error={error}>
        <div
          className={styles.views}
          role='radiogroup'
          aria-label={t('announce.view')}
          aria-invalid={error ? true : undefined}
        >
          {CLASSES.map(cls => {
            const kind = presentationOf.ofClass(cls);
            const code = categoryOfClass(cls);
            const active = pickedClass === cls;
            return (
              <button
                key={cls}
                type='button'
                role='radio'
                aria-checked={active}
                className={styles.view}
                data-active={active || undefined}
                disabled={!code}
                title={code ? undefined : t('announce.view.noCategory')}
                onClick={() => code && onChange(code)}
              >
                {kind !== 'none' && PRESENTATION_ICON[kind]}
                <span className={styles.viewText}>
                  <span className={styles.viewTitle}>
                    {kind === 'none'
                      ? t('announce.presentation.noneShort')
                      : t(`presentation.${kind}`)}
                  </span>
                  <span className={styles.viewClass}>
                    {t(`categoryClass.${cls}`)}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </FieldSet>
      {picked && (
        <p className={styles.viewCategory}>
          {t('announce.category')}: <strong>{labels.category(picked)}</strong>{' '}
          <code>{picked}</code>
        </p>
      )}
    </>
  );
}

/** The languages the service renders an announcement in; the switch picks
 *  which one the preview shows. Publishing renders all of them. */
export function usePreviewLocale() {
  const { admin, locale } = useNotificationsContext();
  const own = locale.slice(0, 2).toLowerCase();
  return useState(
    admin.locales.includes(own) ? own : (admin.locales[0] ?? own)
  );
}

export function PreviewLocaleSwitch({
  value,
  onChange,
}: {
  value: string;
  onChange: (locale: string) => void;
}) {
  const { t, admin } = useNotificationsContext();
  if (admin.locales.length < 2) return null;
  return (
    <div className={styles.localeSwitch}>
      <span className={styles.muted}>{t('announce.locale')}</span>
      <Segmented
        name='nk-preview-locale'
        label={t('announce.locale')}
        value={value}
        options={admin.locales.map(code => ({
          value: code,
          label: code.toUpperCase(),
        }))}
        onChange={onChange}
      />
    </div>
  );
}

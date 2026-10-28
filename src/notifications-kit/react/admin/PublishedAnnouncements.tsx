/**
 * Published announcements, each with "Edit".
 *
 * The service has no "everything published" list for a publisher. The list
 * joins what there is: the announcements published from this browser
 * (with the request that was sent), the ones the service shows the caller
 * now, and the ones the caller closed here.
 */
import { useEffect, useState } from 'react';

import type { AnnouncementEntry, CategoryClass } from '../../core';
import { useNotificationsContext } from '../context';
import { formatDateTime } from '../format';
import { useAnnouncements, useDismissedAnnouncements } from '../hooks';
import { Button, Dialog, Spinner, cx, useDomId } from '../primitives';
import styles from './admin.module.css';
import { AnnouncementEditor, useEditTarget } from './AnnouncementEditor';
import {
  PRESENTATION_ICON,
  useLabels,
  usePresentationOf,
} from './announceShared';
import { Notice } from './forms';
import type { PublishedRecord } from './publishedJournal';
import { readPublished, subscribePublished } from './publishedJournal';

type Status = 'scheduled' | 'active' | 'ended';

interface Row {
  id: string;
  subject: string | null;
  category: string | null;
  categoryClass: CategoryClass | null;
  audience: string | null;
  visibleFrom: string | null;
  visibleUntil: string | null;
  publishedAt: string | null;
  entry?: AnnouncementEntry;
}

export function usePublishedRecords(): PublishedRecord[] {
  const { storageScope } = useNotificationsContext();
  const [records, setRecords] = useState(() =>
    typeof window === 'undefined' ? [] : readPublished(storageScope)
  );
  useEffect(() => {
    setRecords(readPublished(storageScope));
    return subscribePublished(() => setRecords(readPublished(storageScope)));
  }, [storageScope]);
  return records;
}

function statusOf(row: Row, now: number): Status {
  const from = row.visibleFrom ? Date.parse(row.visibleFrom) : NaN;
  const until = row.visibleUntil ? Date.parse(row.visibleUntil) : NaN;
  if (!Number.isNaN(from) && from > now) return 'scheduled';
  if (!Number.isNaN(until) && until <= now) return 'ended';
  return 'active';
}

function fromEntry(entry: AnnouncementEntry): Row {
  return {
    id: entry.id,
    subject: entry.subject,
    category: entry.category,
    categoryClass: entry.categoryClass,
    audience: null,
    visibleFrom: entry.visibleFrom,
    visibleUntil: entry.visibleUntil,
    publishedAt: entry.publishedAt,
    entry,
  };
}

export interface PublishedAnnouncementsProps {
  /** Opens the editor of this announcement (e.g. from `?edit=<id>`). */
  editId?: string | null;
  /** The editor was closed. */
  onEditClose?: () => void;
}

export function PublishedAnnouncements({
  editId,
  onEditClose,
}: PublishedAnnouncementsProps) {
  const { t, locale, admin, features } = useNotificationsContext();
  const labels = useLabels();
  const presentationOf = usePresentationOf();
  const records = usePublishedRecords();
  const active = useAnnouncements();
  const closed = useDismissedAnnouncements();
  const [editing, setEditing] = useState<string | null>(editId ?? null);
  const [saved, setSaved] = useState<{ id: string; removed: boolean } | null>(
    null
  );

  useEffect(() => {
    if (editId) setEditing(editId);
  }, [editId]);

  if (!features.publishing || !admin.permissions.announce) return null;

  const rows = new Map<string, Row>();
  for (const record of records) {
    const a = record.announcement;
    const variables = record.request.variables ?? {};
    const freeform =
      admin.freeformTemplateKey &&
      record.request.templateKey === admin.freeformTemplateKey;
    rows.set(record.id, {
      id: record.id,
      subject: freeform
        ? String(variables.subject ?? '') || null
        : record.request.templateKey,
      category: record.request.category,
      categoryClass:
        a.categoryClass ??
        presentationOf.classOf(record.request.category) ??
        null,
      audience: labels.audience(
        record.request.audienceType,
        record.request.audienceValue
      ),
      visibleFrom: a.visibleFrom ?? record.request.visibleFrom ?? null,
      visibleUntil: a.visibleUntil ?? record.request.visibleUntil,
      publishedAt: a.publishedAt ?? record.publishedAt,
    });
  }
  for (const { entry } of closed) {
    const known = rows.get(entry.id);
    rows.set(
      entry.id,
      known ? { ...known, entry, subject: entry.subject } : fromEntry(entry)
    );
  }
  for (const entry of active.data?.items ?? []) {
    const known = rows.get(entry.id);
    // The service's current text wins over anything remembered.
    rows.set(
      entry.id,
      known ? { ...known, entry, subject: entry.subject } : fromEntry(entry)
    );
  }
  const now = Date.now();
  const list = [...rows.values()].sort(
    (a, b) =>
      (b.publishedAt ? Date.parse(b.publishedAt) : 0) -
      (a.publishedAt ? Date.parse(a.publishedAt) : 0)
  );
  const editingRow = editing ? rows.get(editing) : undefined;

  return (
    <div className={cx(styles.root, styles.stack, styles.published)}>
      {saved && (
        <Notice
          tone='success'
          title={saved.removed ? t('edit.removed') : t('edit.saved')}
        >
          {list.find(r => r.id === saved.id)?.subject ?? null}
        </Notice>
      )}
      {active.isPending && list.length === 0 ? (
        <div className={styles.inlineRow}>
          <Spinner label={t('published.title')} />
        </div>
      ) : list.length === 0 ? (
        <p className={styles.muted}>
          {active.isError ? t('published.error') : t('published.empty')}
        </p>
      ) : (
        <ul className={styles.publishedList}>
          {list.map(row => {
            const status = statusOf(row, now);
            const kind = row.categoryClass
              ? presentationOf.ofClass(row.categoryClass)
              : 'none';
            const from = formatDateTime(
              row.visibleFrom ?? row.publishedAt,
              locale
            );
            const until = formatDateTime(row.visibleUntil, locale);
            return (
              <li key={row.id} className={styles.publishedRow}>
                <span className={styles.publishedIcon} aria-hidden='true'>
                  {kind !== 'none' && PRESENTATION_ICON[kind]}
                </span>
                <span className={styles.publishedMain}>
                  <span className={styles.publishedTop}>
                    <span className={styles.publishedTitle}>
                      {row.subject ?? t('announcement.untitled')}
                    </span>
                    <span
                      className={styles.publishedStatus}
                      data-status={status}
                    >
                      {t(`published.status.${status}`)}
                    </span>
                  </span>
                  <span className={styles.publishedMeta}>
                    {[
                      kind !== 'none' ? t(`presentation.${kind}`) : null,
                      row.category ? labels.category(row.category) : null,
                      row.audience,
                      t('announce.window', {
                        from: from ?? '—',
                        until: until ?? '—',
                      }),
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </span>
                <Button
                  size='sm'
                  icon='edit'
                  onClick={() => {
                    setSaved(null);
                    setEditing(row.id);
                  }}
                >
                  {t('published.edit')}
                </Button>
              </li>
            );
          })}
        </ul>
      )}

      {editing && (
        <EditDialog
          id={editing}
          hint={editingRow?.entry ?? editingRow ?? undefined}
          onClose={() => {
            setEditing(null);
            onEditClose?.();
          }}
          onSaved={result => {
            setSaved({ id: editing, ...result });
            setEditing(null);
            onEditClose?.();
          }}
        />
      )}
    </div>
  );
}

/** The editor of one published announcement, in a dialog. Usable on its
 *  own, e.g. from the announcement reader. */
export function EditDialog({
  id,
  hint,
  onClose,
  onSaved,
}: {
  id: string;
  hint?: Partial<AnnouncementEntry>;
  onClose: () => void;
  onSaved: (result: { removed: boolean }) => void;
}) {
  const { t } = useNotificationsContext();
  const titleId = useDomId('nk-edit');
  const { loading, target } = useEditTarget(id, hint);
  return (
    <Dialog open onClose={onClose} labelledBy={titleId} width={760}>
      <div className={styles.editDialog}>
        <h2 id={titleId} className={styles.confirmTitle}>
          {t('edit.title')}
        </h2>
        <p className={styles.muted}>{t('edit.fixed')}</p>
        {loading || !target ? (
          <div className={styles.inlineRow}>
            <Spinner label={t('edit.loading')} />
            <span className={styles.muted}>{t('edit.loading')}</span>
          </div>
        ) : (
          <AnnouncementEditor
            target={target}
            onCancel={onClose}
            onDone={(_, result) => onSaved(result)}
          />
        )}
      </div>
    </Dialog>
  );
}

import type { ReactNode } from 'react';

import { isNotificationsError } from '../../core';
import type { Translate } from '../messages';
import { Notice } from './forms';

/** What to tell a person about a failed call. The service localises
 *  `detail` by Accept-Language, so it is shown as is when present. */
export function describeError(
  error: unknown,
  t: Translate
): { title: string; note?: string } {
  if (!isNotificationsError(error)) return { title: t('admin.error.generic') };
  const trace = error.traceId
    ? t('error.traceId', { traceId: error.traceId })
    : undefined;
  if (error.kind === 'network') return { title: t('admin.error.network') };
  if (error.kind === 'contract') {
    return { title: t('admin.error.contract'), note: trace };
  }
  if (error.status === 401 || error.status === 403) {
    return {
      title: t('admin.error.forbidden'),
      note: [error.detail, trace].filter(Boolean).join(' · ') || undefined,
    };
  }
  return {
    title: error.detail || error.title || t('admin.error.generic'),
    note: trace,
  };
}

export function ErrorNotice({
  error,
  t,
  action,
}: {
  error: unknown;
  t: Translate;
  action?: ReactNode;
}) {
  const { title, note } = describeError(error, t);
  return (
    <Notice tone='error' title={title} action={action}>
      {note && <span>{note}</span>}
    </Notice>
  );
}

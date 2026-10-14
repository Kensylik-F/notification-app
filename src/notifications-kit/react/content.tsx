import type { ReactNode } from 'react';

import type { AnnouncementEntry, InboxEntry } from '../core';
import { useMemo } from 'react';

import { cleanForDisplay, htmlToText } from './admin/richtext';
import { useNotificationsContext } from './context';
import { HtmlFrame, cx } from './primitives';
import styles from './styles.module.css';

/** Short text of a message for a card or a list row: the text twin, else
 *  the HTML reduced to text. */
export function plainText(entry: {
  bodyText: string | null;
  bodyHtml: string | null;
}): string | null {
  const text = entry.bodyText?.trim();
  if (text) return text;
  if (!entry.bodyHtml || typeof DOMParser === 'undefined') return null;
  return htmlToText(entry.bodyHtml).trim() || null;
}

/** A card shows two or three lines; anything longer, or any formatting,
 *  is worth opening. */
export function hasMore(entry: {
  bodyText: string | null;
  bodyHtml: string | null;
}): boolean {
  if (
    entry.bodyHtml &&
    /<(ul|ol|a|h\d|table|img|blockquote)\b/i.test(entry.bodyHtml)
  ) {
    return true;
  }
  return (plainText(entry)?.length ?? 0) > 140;
}

/**
 * The full body: the host's sanitising renderer, else the isolated frame,
 * else the text, else `empty`.
 */
export function MessageBody({
  source,
  title,
  empty,
  className,
  onFollow,
}: {
  source: InboxEntry | AnnouncementEntry;
  title: string;
  empty?: ReactNode;
  className?: string;
  /** A link into the cabinet was followed (the host's `navigate`): close
   *  whatever holds the message. */
  onFollow?: () => void;
}) {
  const { renderHtml, navigate, t } = useNotificationsContext();
  const html = useMemo(
    () => (source.bodyHtml ? cleanForDisplay(source.bodyHtml) : null),
    [source.bodyHtml]
  );
  if (source.bodyHtml && html !== null) {
    return (
      <div className={cx(styles.body, className)}>
        {renderHtml ? (
          renderHtml(source.bodyHtml, source)
        ) : (
          <HtmlFrame
            html={html}
            title={title}
            onInternalLink={
              navigate
                ? path => {
                    onFollow?.();
                    navigate(path);
                  }
                : undefined
            }
          />
        )}
      </div>
    );
  }
  if (source.bodyText) {
    return (
      <p className={cx(styles.body, styles.bodyText, className)}>
        {source.bodyText}
      </p>
    );
  }
  return (
    <p className={cx(styles.stateNote, className)}>
      {empty ?? t('item.noBody')}
    </p>
  );
}

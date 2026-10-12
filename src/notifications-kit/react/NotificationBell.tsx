import { useEffect, useId, useRef, useState } from 'react';

import type { InboxEntry } from '../core';
import { useNotificationsContext } from './context';
import { useUnreadCount } from './hooks';
import { InboxList, MarkAllReadButton } from './InboxPanel';
import { Button, IconButton, cx } from './primitives';
import styles from './styles.module.css';

export interface NotificationBellProps {
  /** Rows in the dropdown. Default: 5. */
  limit?: number;
  /** Opens one notification. The dropdown closes first. */
  onOpenItem?: (entry: InboxEntry) => void;
  /** Opens the full inbox. Without it the footer link is not rendered. */
  onOpenAll?: () => void;
  /** Which edge of the button the dropdown aligns to. Default: `'end'`. */
  align?: 'start' | 'end';
  className?: string;
}

const formatCount = (count: number) => (count > 99 ? '99+' : String(count));

/** The header bell: unread badge and a dropdown with the latest rows. */
export function NotificationBell({
  limit = 5,
  onOpenItem,
  onOpenAll,
  align = 'end',
  className,
}: NotificationBellProps) {
  const { t } = useNotificationsContext();
  const { data: unread = 0 } = useUnreadCount();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      buttonRef.current?.focus();
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const label =
    unread > 0 ? t('bell.labelWithCount', { count: unread }) : t('bell.label');

  return (
    <div ref={rootRef} className={cx(styles.root, styles.bell, className)}>
      <IconButton
        ref={buttonRef}
        icon='bell'
        label={label}
        aria-haspopup='dialog'
        aria-expanded={open}
        onClick={() => setOpen(value => !value)}
      >
        {unread > 0 && (
          <span className={styles.badge} aria-hidden='true'>
            {formatCount(unread)}
          </span>
        )}
      </IconButton>
      {open && (
        <div
          className={cx(
            styles.popover,
            align === 'start' && styles.popoverAlignStart
          )}
          role='dialog'
          aria-labelledby={titleId}
        >
          <div className={styles.popoverHeader}>
            <h2 id={titleId} className={styles.popoverTitle}>
              {t('bell.title')}
            </h2>
            <MarkAllReadButton />
          </div>
          <div className={styles.popoverBody}>
            <InboxList
              limit={limit}
              dismissible={false}
              onOpenItem={
                onOpenItem
                  ? entry => {
                      setOpen(false);
                      onOpenItem(entry);
                    }
                  : undefined
              }
            />
          </div>
          {onOpenAll && (
            <div className={styles.popoverFooter}>
              <span />
              <Button
                variant='ghost'
                onClick={() => {
                  setOpen(false);
                  onOpenAll();
                }}
              >
                {t('bell.openAll')}
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import type { CSSProperties, RefObject } from 'react';
import { createPortal } from 'react-dom';

import type { InboxEntry } from '../core';
import { useNotificationsContext } from './context';
import { useUnreadCount } from './hooks';
import { InboxList, MarkAllReadButton } from './InboxPanel';
import { Button, IconButton, cx } from './primitives';
import styles from './styles.module.css';

export interface NotificationBellProps {
  /** Rows in the dropdown. Default: 5. */
  limit?: number;
  /** Adds "Open separately" to an expanded row. The dropdown closes first. */
  onOpenItem?: (entry: InboxEntry) => void;
  /** Opens the full inbox. Without it the footer link is not rendered. */
  onOpenAll?: () => void;
  /**
   * The element whose bottom-right corner the dropdown hangs from - usually
   * the page header, so the dropdown lines up with the header's edge rather
   * than with the button. Without it the dropdown hangs from the button.
   */
  anchorRef?: RefObject<HTMLElement | null>;
  /** Gap between the anchor's right edge and the dropdown, px. Default: 16. */
  anchorInset?: number;
  /** Which edge of the button the dropdown aligns to when there is no
   *  `anchorRef`. Default: `'end'`. */
  align?: 'start' | 'end';
  className?: string;
}

const formatCount = (count: number) => (count > 99 ? '99+' : String(count));

const GAP = 8;
const VIEWPORT_MARGIN = 16;

/** Fixed position under the anchor (or the button), kept inside the window. */
function placement(
  anchor: HTMLElement,
  button: HTMLElement,
  inset: number,
  align: 'start' | 'end',
  fromAnchor: boolean
): CSSProperties {
  const viewportWidth = document.documentElement.clientWidth;
  const viewportHeight = window.innerHeight;
  const anchorBox = anchor.getBoundingClientRect();
  const buttonBox = button.getBoundingClientRect();
  // Below whichever is lower: the header, or the button inside it.
  const top = Math.max(anchorBox.bottom, buttonBox.bottom) + GAP;
  const maxHeight = Math.max(160, viewportHeight - top - VIEWPORT_MARGIN);

  if (fromAnchor || align === 'end') {
    const edge = fromAnchor ? anchorBox.right - inset : buttonBox.right;
    const right = Math.max(VIEWPORT_MARGIN, viewportWidth - edge);
    return { top, right, maxHeight };
  }
  const left = Math.max(VIEWPORT_MARGIN, buttonBox.left);
  return { top, left, maxHeight };
}

/** The header bell: unread badge and a dropdown with the latest rows. */
export function NotificationBell({
  limit = 5,
  onOpenItem,
  onOpenAll,
  anchorRef,
  anchorInset = 16,
  align = 'end',
  className,
}: NotificationBellProps) {
  const { t } = useNotificationsContext();
  const { data: unread = 0 } = useUnreadCount();
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<CSSProperties | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();

  const place = useCallback(() => {
    const button = buttonRef.current;
    if (!button) return;
    const anchor = anchorRef?.current ?? button;
    setPosition(
      placement(anchor, button, anchorInset, align, Boolean(anchorRef?.current))
    );
  }, [anchorRef, anchorInset, align]);

  useLayoutEffect(() => {
    if (!open) return;
    place();
    window.addEventListener('resize', place);
    // Capture: a scroll inside any container can move the header.
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open, place]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (rootRef.current?.contains(target)) return;
      if (popoverRef.current?.contains(target)) return;
      setOpen(false);
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

  const close = () => setOpen(false);
  const label =
    unread > 0 ? t('bell.labelWithCount', { count: unread }) : t('bell.label');

  // Portalled to <body>: a header with `overflow: hidden`, a transform or its
  // own stacking context cannot clip or bury the dropdown.
  const popover =
    open && position
      ? createPortal(
          <div
            ref={popoverRef}
            className={cx(styles.root, styles.popover)}
            style={position}
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
                        close();
                        onOpenItem(entry);
                      }
                    : undefined
                }
              />
            </div>
            {onOpenAll && (
              <div className={styles.popoverFooter}>
                <Button
                  variant='ghost'
                  onClick={() => {
                    close();
                    onOpenAll();
                  }}
                >
                  {t('bell.openAll')}
                </Button>
              </div>
            )}
          </div>,
          document.body
        )
      : null;

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
      {popover}
    </div>
  );
}

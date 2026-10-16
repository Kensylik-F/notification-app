import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';

import { cx } from '../primitives';
import kitStyles from '../styles.module.css';
import styles from './admin.module.css';

/**
 * The form's bottom bar: summary, preview, submit.
 *
 * Without `container` it sticks to the bottom of whatever scrolls the page.
 * With `container` (the host's footer slot, e.g. the page shell's footer) it
 * renders there: a section of its own under the scrolling content, so the
 * form never shows through or under it.
 */
export function ActionBar({
  container,
  children,
}: {
  container?: HTMLElement | null;
  children: ReactNode;
}) {
  if (container) {
    return createPortal(
      <div
        className={cx(
          kitStyles.root,
          styles.root,
          styles.actionBar,
          styles.actionBarDocked
        )}
      >
        {children}
      </div>,
      container
    );
  }
  return <div className={styles.actionBar}>{children}</div>;
}

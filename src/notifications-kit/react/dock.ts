import { useEffect, useState } from 'react';
import type { RefObject } from 'react';

/** Where the top-right column and the top strips start. */
export interface OverlayFrame {
  /** px from the top of the window. */
  top: number;
  /** px from the right edge of the window. */
  right: number;
}

const GAP = 12;
const INSET = 16;

function measure(header: Element | null | undefined): OverlayFrame {
  if (!header) return { top: INSET, right: INSET };
  const box = header.getBoundingClientRect();
  const width = document.documentElement.clientWidth;
  // Under the header, lined up with its right edge (as the bell's list is).
  return {
    top: Math.max(INSET, Math.round(box.bottom + GAP)),
    right: Math.max(INSET, Math.round(width - box.right + INSET)),
  };
}

/**
 * Overlays sit over the whole page, in the top-right corner of the window -
 * just under the page header when its ref is given, so they never cover the
 * header itself. Follows resizes and scrolling.
 */
export function useOverlayFrame(
  headerRef: RefObject<Element | null> | undefined
): OverlayFrame | null {
  const [frame, setFrame] = useState<OverlayFrame | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    let pending = 0;
    const update = () => {
      pending = 0;
      const next = measure(headerRef?.current);
      setFrame(prev =>
        prev && prev.top === next.top && prev.right === next.right ? prev : next
      );
    };
    const schedule = () => {
      if (!pending) pending = window.requestAnimationFrame(update);
    };
    update();
    window.addEventListener('resize', schedule);
    window.addEventListener('scroll', schedule, true);
    const header = headerRef?.current;
    const observer =
      header && typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver(schedule)
        : null;
    if (header) observer?.observe(header);
    return () => {
      window.cancelAnimationFrame(pending);
      window.removeEventListener('resize', schedule);
      window.removeEventListener('scroll', schedule, true);
      observer?.disconnect();
    };
  }, [headerRef]);

  return frame;
}

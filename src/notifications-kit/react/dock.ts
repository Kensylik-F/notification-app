import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';

/** Put this attribute on the page's work area and the overlays dock to it. */
export const DEFAULT_ANCHOR_SELECTOR = '[data-notifications-anchor]';

export interface DockRect {
  top: number;
  left: number;
  width: number;
  height: number;
  /** Room taken at the bottom of the box by a registered obstacle (a form's
   *  action bar): the corner overlays sit above it. */
  bottomInset: number;
}

// ------------------------------------------------------------- obstacles

const obstacles = new Set<Element>();
const listeners = new Set<() => void>();
const notify = () => listeners.forEach(listener => listener());

/**
 * Marks an element the corner overlays must not cover - the sticky bar
 * with a form's buttons. While it is near the bottom of the work area the
 * deck and the cards move up above it.
 */
export function useDockObstacle(ref: RefObject<Element | null>) {
  const registered = useRef<Element | null>(null);
  const observer = useRef<ResizeObserver | null>(null);

  // Checked on every commit: the form may swap its bar for a result screen
  // and back without the ref object changing.
  useLayoutEffect(() => {
    const el = ref.current;
    if (el === registered.current) return;
    if (registered.current) {
      observer.current?.unobserve(registered.current);
      obstacles.delete(registered.current);
    }
    registered.current = el;
    if (el) {
      obstacles.add(el);
      if (!observer.current && typeof ResizeObserver !== 'undefined') {
        observer.current = new ResizeObserver(notify);
      }
      observer.current?.observe(el);
    }
    notify();
  });

  useEffect(
    () => () => {
      observer.current?.disconnect();
      if (registered.current) obstacles.delete(registered.current);
      registered.current = null;
      notify();
    },
    []
  );
}

function insetFor(box: {
  top: number;
  left: number;
  width: number;
  height: number;
}) {
  const bottom = box.top + box.height;
  const right = box.left + box.width;
  let inset = 0;
  obstacles.forEach(el => {
    const r = el.getBoundingClientRect();
    if (r.height === 0 || r.width === 0) return;
    // Only what sits on the lower edge and under the corner matters.
    if (r.bottom < bottom - 8 || r.top >= bottom) return;
    if (r.right < right - 420 || r.left > right) return;
    inset = Math.max(inset, bottom - r.top);
  });
  return Math.round(inset);
}

function viewport() {
  return {
    top: 0,
    left: 0,
    width: document.documentElement.clientWidth,
    height: window.innerHeight,
  };
}

function measure(anchor: Element | null): DockRect {
  const view = viewport();
  let box = view;
  if (anchor) {
    const r = anchor.getBoundingClientRect();
    const top = Math.max(r.top, 0);
    const left = Math.max(r.left, 0);
    const right = Math.min(r.right, view.width);
    const bottom = Math.min(r.bottom, view.height);
    // An anchor that is hidden or scrolled away is no place to dock.
    if (right - left >= 240 && bottom - top >= 160) {
      box = { top, left, width: right - left, height: bottom - top };
    }
  }
  return { ...box, bottomInset: insetFor(box) };
}

const same = (a: DockRect, b: DockRect) =>
  a.top === b.top &&
  a.left === b.left &&
  a.width === b.width &&
  a.height === b.height &&
  a.bottomInset === b.bottomInset;

/**
 * The box the overlays live in: the anchor element (the page's work area,
 * next to the navigation and any side panel), clipped to the window - or the
 * window itself when there is no anchor. Follows resizes, scrolling and the
 * anchor appearing or moving on navigation.
 */
export function useDock(
  anchorRef: RefObject<Element | null> | undefined,
  selector: string
): DockRect | null {
  const [rect, setRect] = useState<DockRect | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    let frame = 0;
    let observed: Element | null = null;
    const observer =
      typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver(() => schedule())
        : null;

    const update = () => {
      frame = 0;
      const anchor =
        anchorRef?.current ??
        (selector ? document.querySelector(selector) : null);
      if (anchor !== observed) {
        if (observed) observer?.unobserve(observed);
        if (anchor) observer?.observe(anchor);
        observed = anchor;
      }
      const next = measure(anchor);
      setRect(prev => (prev && same(prev, next) ? prev : next));
    };
    const schedule = () => {
      if (!frame) frame = window.requestAnimationFrame(update);
    };

    update();
    listeners.add(schedule);
    window.addEventListener('resize', schedule);
    window.addEventListener('scroll', schedule, true);
    // Navigation can swap the anchor without any resize or scroll.
    const poll = window.setInterval(schedule, 1000);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('resize', schedule);
      window.removeEventListener('scroll', schedule, true);
      window.clearInterval(poll);
      listeners.delete(schedule);
      observer?.disconnect();
    };
  }, [anchorRef, selector]);

  return rect;
}

/**
 * Motion helpers. Everything here is a no-op under
 * `prefers-reduced-motion: reduce`, and nothing waits on an animation to
 * finish before the data changes for longer than `LEAVE_MS`.
 */
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import type { RefObject } from 'react';

/** How long a leaving element plays its exit before it is removed. */
export const LEAVE_MS = 220;
/** Layout moves (a stack fanning out, rows closing a gap). */
export const MOVE_MS = 380;
export const EASE_OUT = 'cubic-bezier(0.2, 0.9, 0.25, 1)';

interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

export function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/**
 * FLIP for elements marked `data-flip="<id>"` inside `ref`. Call `capture()`
 * right before a state change that moves them; after the next commit each
 * marked element glides from where it was to where it is now (and to
 * whatever transform its CSS now gives it). Elements without a captured
 * position are left to their own enter animation.
 */
export function useFlip(
  ref: RefObject<HTMLElement | null>,
  options: {
    /** Measure against the container rather than the window, so that
     *  scrolling between two commits is not taken for movement. */
    relative?: boolean;
  } = {}
) {
  const snapshot = useRef<Map<string, Box> | null>(null);
  const relative = options.relative ?? false;

  const capture = useCallback(() => {
    const root = ref.current;
    if (!root || prefersReducedMotion()) return;
    const origin = relative ? root.getBoundingClientRect() : null;
    const rects = new Map<string, Box>();
    root.querySelectorAll<HTMLElement>('[data-flip]').forEach(el => {
      const id = el.dataset.flip;
      if (!id) return;
      const r = el.getBoundingClientRect();
      rects.set(id, {
        left: r.left - (origin?.left ?? 0),
        top: r.top - (origin?.top ?? 0),
        width: r.width,
        height: r.height,
      });
    });
    snapshot.current = rects;
  }, [ref, relative]);

  useLayoutEffect(() => {
    const before = snapshot.current;
    const root = ref.current;
    if (!before || !root) return;
    snapshot.current = null;
    const origin = relative ? root.getBoundingClientRect() : null;
    root.querySelectorAll<HTMLElement>('[data-flip]').forEach(el => {
      const saved = el.dataset.flip ? before.get(el.dataset.flip) : undefined;
      const old = saved && {
        left: saved.left + (origin?.left ?? 0),
        top: saved.top + (origin?.top ?? 0),
        width: saved.width,
        height: saved.height,
      };
      if (!old || typeof el.animate !== 'function') return;
      el.getAnimations?.().forEach(animation => animation.cancel());
      // The box without any transform, and the transform CSS now wants.
      const inline = el.style.transform;
      el.style.transform = 'none';
      const box = el.getBoundingClientRect();
      el.style.transform = inline;
      const target = getComputedStyle(el).transform;
      if (box.width === 0 || box.height === 0) return;
      const dx = old.left - box.left;
      const dy = old.top - box.top;
      const sx = old.width / box.width;
      const sy = old.height / box.height;
      if (
        Math.abs(dx) < 0.5 &&
        Math.abs(dy) < 0.5 &&
        Math.abs(sx - 1) < 0.005 &&
        Math.abs(sy - 1) < 0.005
      ) {
        return;
      }
      el.animate(
        [
          {
            transformOrigin: '0 0',
            transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`,
          },
          {
            transformOrigin: '0 0',
            transform: target === 'none' ? 'none' : target,
          },
        ],
        { duration: MOVE_MS, easing: EASE_OUT }
      );
    });
  });

  return { capture };
}

/**
 * Ids that are on their way out: `leave(id, done)` marks the id, and after
 * the exit animation calls `done` (which usually changes the data so the
 * element goes away). With reduced motion `done` runs at once.
 */
export function useLeaving() {
  const [leaving, setLeaving] = useState<ReadonlySet<string>>(new Set());
  const timers = useRef(new Map<string, number>());

  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach(timer => window.clearTimeout(timer));
  }, []);

  const leave = useCallback(
    (id: string, done: () => void, delay = 0, duration = LEAVE_MS) => {
      if (prefersReducedMotion()) {
        done();
        return;
      }
      if (timers.current.has(id)) return;
      const start = () => setLeaving(prev => new Set(prev).add(id));
      const startTimer = window.setTimeout(start, delay);
      const doneTimer = window.setTimeout(() => {
        timers.current.delete(id);
        done();
        setLeaving(prev => {
          if (!prev.has(id)) return prev;
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      }, delay + duration);
      timers.current.set(id, doneTimer);
      if (delay === 0) {
        window.clearTimeout(startTimer);
        start();
      }
    },
    []
  );

  return { leaving, leave };
}

/** Offset box of the active item, for a sliding indicator. */
export interface IndicatorBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Position of a sliding indicator under the active item of a tab row or a
 * segmented control: the element matched by `selector` inside `ref`.
 */
export function useIndicator(
  ref: RefObject<HTMLElement | null>,
  selector: string,
  deps: readonly unknown[]
): IndicatorBox | undefined {
  const [box, setBox] = useState<IndicatorBox>();

  const measure = useCallback(() => {
    const root = ref.current;
    const active = root?.querySelector<HTMLElement>(selector);
    if (!root || !active) {
      setBox(undefined);
      return;
    }
    const next = {
      left: active.offsetLeft,
      top: active.offsetTop,
      width: active.offsetWidth,
      height: active.offsetHeight,
    };
    setBox(prev =>
      prev &&
      prev.left === next.left &&
      prev.top === next.top &&
      prev.width === next.width &&
      prev.height === next.height
        ? prev
        : next
    );
  }, [ref, selector]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useLayoutEffect(measure, [measure, ...deps]);

  useEffect(() => {
    const root = ref.current;
    if (!root || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    return () => observer.disconnect();
  }, [ref, measure]);

  return box;
}

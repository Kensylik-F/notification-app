import { useEffect, useRef } from 'react';

import type { InboxEntry } from '../core';
import { useInboxCommands } from './hooks';

/**
 * Tells the service which rows were shown in a list. "Seen" is its own
 * state in the contract - not the same as read - and is set once, so each
 * id is reported at most once per mount.
 */
export function useMarkSeenOnShow(
  entries: readonly InboxEntry[],
  active: boolean
) {
  const { markSeen } = useInboxCommands();
  const reported = useRef(new Set<string>());
  const mutate = markSeen.mutate;

  useEffect(() => {
    if (!active) return;
    for (const entry of entries) {
      if (entry.seen || reported.current.has(entry.id)) continue;
      reported.current.add(entry.id);
      mutate(entry.id);
    }
  }, [entries, active, mutate]);
}

import { useCallback, useSyncExternalStore } from 'react';

import { useNotificationsContext } from './context';
import type { KitPreview } from './previewStore';

export {
  PREVIEW_ID,
  type AnnouncementPreview,
  type InboxPreview,
  type KitPreview,
} from './previewStore';

/** The preview currently played out on the page, and a setter. */
export function useKitPreview(): [
  KitPreview | null,
  (preview: KitPreview | null) => void,
] {
  const { preview } = useNotificationsContext();
  const value = useSyncExternalStore(
    preview.subscribe,
    preview.get,
    preview.get
  );
  const set = useCallback(
    (next: KitPreview | null) => preview.set(next),
    [preview]
  );
  return [value, set];
}

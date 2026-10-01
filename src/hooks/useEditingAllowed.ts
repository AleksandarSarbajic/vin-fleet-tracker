'use client';

import { useSyncExternalStore } from 'react';
import { EDIT_MEDIA, editingAllowedNow } from '@/lib/editing';

/**
 * §12.94. Whether this screen is wide enough to edit, kept current as it
 * resizes or rotates.
 *
 * The server snapshot says yes: the server cannot know the width, and every
 * edit control appears only after a tap — by which time hydration has read
 * the real width — so nothing editable is ever painted on a phone.
 */
function subscribe(onChange: () => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return () => {};
  }
  const media = window.matchMedia(EDIT_MEDIA);
  media.addEventListener('change', onChange);
  return () => media.removeEventListener('change', onChange);
}

export function useEditingAllowed(): boolean {
  return useSyncExternalStore(subscribe, editingAllowedNow, () => true);
}

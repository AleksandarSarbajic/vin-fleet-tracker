import type { ReactNode } from 'react';
import { PageRise } from '@/components/PageRise';

/**
 * §12.149. Mounted anew on each change of page, which is the whole of its job. A layout
 * stays mounted across them, and a page has no way to know it was just arrived at.
 */
export default function Template({ children }: { children: ReactNode }) {
  return <PageRise>{children}</PageRise>;
}

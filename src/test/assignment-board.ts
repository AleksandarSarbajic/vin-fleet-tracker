import { createElement, type ComponentProps } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AssignmentBoard } from '@/components/assignments/AssignmentBoard';
import type { FleetResponse } from '@/hooks/useFleet';

type BoardProps = ComponentProps<typeof AssignmentBoard>;

/**
 * A fleet with no rows: no truck has a live row, so every Currently cell is
 * empty. For the suites that are not about Currently (§12.145), so what they
 * assert is what it was before the column.
 */
export const NO_FLEET: FleetResponse = {
  fleet: [],
  fetchedAt: '2026-10-28T12:00:00.000Z',
  feedStale: false,
  feedNewestAt: '2026-10-28T11:59:30.000Z',
};

/** One per test: the fleet query's cache must not carry over between tests. */
export function testQueryClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

/**
 * The board as the page mounts it: inside the app's query provider (the
 * fleet poll needs one), with the fleet the page loaded beside it.
 */
export function boardElement(
  client: QueryClient,
  props: Omit<BoardProps, 'initialFleet'> & { initialFleet?: FleetResponse },
) {
  return createElement(
    QueryClientProvider,
    { client },
    createElement(AssignmentBoard, { initialFleet: NO_FLEET, ...props }),
  );
}

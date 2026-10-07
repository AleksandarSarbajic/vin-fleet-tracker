/**
 * §12.117. The modal now posts a LOAD with its one stop. The component suites
 * were written against the flat single-stop body, and what they assert —
 * which wall time, which window, which answer — has not changed, only where
 * it sits. This reads a posted body back as that flat view: the load's keys
 * with its one stop's keys beside them.
 */
export function stopView(body: unknown): Record<string, unknown> {
  const { stops, ...load } = body as Record<string, unknown> & { stops?: unknown[] };
  if (!Array.isArray(stops)) return load;
  if (stops.length !== 1) throw new Error(`expected one stop, the modal sent ${stops.length}`);
  return { ...load, ...(stops[0] as Record<string, unknown>) };
}

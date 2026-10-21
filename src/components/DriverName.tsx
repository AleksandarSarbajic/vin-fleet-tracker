import { NO_ELD_LABEL, isEldBacked, type DriverSource } from '@/lib/driver';

/**
 * A driver's name, with the `No ELD` tag when there is no ELD behind them
 * (§12.35, §12.37).
 *
 * ONE component, used at every site a driver name renders, because the first
 * attempt tagged the one surface I happened to be editing and left six
 * others — including the assignment board, which is the screen the tag exists
 * for. The lesson is §12.21's: fixing the sites someone can see is how a bug
 * survives three sessions.
 *
 * The tag is provenance, not status, so it borrows no status colour and no
 * icon. What it tells a dispatcher is whether "no position" means expected or
 * broken.
 */
export function DriverName({
  name,
  source,
  samsaraDriverId,
  fallback = null,
  className,
  struck = false,
}: {
  name: string | null;
  source: DriverSource | null;
  samsaraDriverId: string | null;
  /** What to render instead when there is no driver at all. */
  fallback?: React.ReactNode;
  className?: string;
  /**
   * §12.133. The name (or the fallback) struck through, as §9.10 writes a
   * driver being replaced; the `No ELD` tag is NOT, because it is provenance,
   * not part of what changed.
   *
   * A prop, not a caller's wrapper: `line-through` on a wrapper does not
   * reach into this component's inline-flex box, so the confirm's "From" and
   * "Was" names were never struck while their plain-text fallbacks were.
   */
  struck?: boolean;
}) {
  if (name === null) {
    return struck ? <span className="line-through">{fallback}</span> : <>{fallback}</>;
  }

  // No driver row to judge means nothing to say — an absent source is not the
  // same as a driver without an ELD.
  const tagged = source !== null && !isEldBacked({ source, samsaraDriverId });

  return (
    <span className={`inline-flex items-baseline gap-1.5 ${className ?? ''}`}>
      <span className={struck ? 'truncate line-through' : 'truncate'}>{name}</span>
      {tagged ? <NoEldTag /> : null}
    </span>
  );
}

/** The tag alone, for the few places that lay the name out themselves. */
export function NoEldTag() {
  return (
    <span
      title="Added here, not in Samsara — there is no ELD behind this driver, so the truck's position comes from the vehicle only."
      className="shrink-0 border border-line-hair px-1 font-cond text-micro uppercase leading-[1.4] tracking-[.08em] text-text-muted"
    >
      {NO_ELD_LABEL}
    </span>
  );
}

/** True when this driver should carry the tag. The single predicate. */
export function needsNoEldTag(driver: {
  source: DriverSource | null;
  samsaraDriverId: string | null;
}): boolean {
  return driver.source !== null && !isEldBacked({ source: driver.source, samsaraDriverId: driver.samsaraDriverId });
}

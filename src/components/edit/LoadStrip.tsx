'use client';

import { LOAD_STATUSES, LOAD_STATUS_LABEL } from '@/lib/loads';
import type { BoardDriver } from '@/server/assignments';
import { DriverSelect } from '@/components/assignments/DriverSelect';
import { Field } from './Field';
import type { LoadStatus } from './load-form';

/**
 * §12.119. The load's own fields, once, above its stops: the truck, its
 * driver, the load number and status, and whether the truck is on the
 * console. Labels and help text are the one-stop modal's.
 */
export function LoadStrip({
  truckName,
  drivers,
  driverId,
  initialDriverId,
  currentDriverName,
  claimedBy,
  loadNumber,
  loadStatus,
  active,
  mayEdit,
  mayFlipActive,
  saving,
  lockedReason,
  loadNumberError,
  onDriver,
  onDriverCreated,
  onLoadNumber,
  onLoadStatus,
  onActive,
}: {
  truckName: string;
  drivers: BoardDriver[];
  driverId: string | null;
  initialDriverId: string | null;
  currentDriverName: string | null;
  claimedBy: Map<string, string>;
  loadNumber: string;
  loadStatus: LoadStatus;
  active: boolean;
  mayEdit: boolean;
  mayFlipActive: boolean;
  saving: boolean;
  lockedReason: string;
  loadNumberError: string | undefined;
  onDriver: (id: string | null) => void;
  onDriverCreated: () => void;
  onLoadNumber: (value: string) => void;
  onLoadStatus: (value: LoadStatus) => void;
  onActive: (value: boolean) => void;
}) {
  return (
    <fieldset
      disabled={!mayEdit}
      data-load-strip=""
      className="border-0 border-b border-line-hair p-0 px-4 py-3"
    >
      <legend className="sr-only">Load</legend>
      <div className="grid grid-cols-2 gap-x-3 gap-y-2.5 min-[1008px]:grid-cols-[110px_1.6fr_1.3fr_1.1fr]">
        <label className="block">
          <span className="mb-1 block text-small text-text-secondary">Truck no.</span>
          <p className="flex h-10 items-center font-sans text-data font-bold tabular-nums text-text">
            {truckName}
          </p>
        </label>
        <label className="block">
          <span className="mb-1 block text-small text-text-secondary">Assigned driver</span>
          <DriverSelect
            drivers={drivers}
            value={driverId}
            /**
             * Only when the truck has nobody. With a driver already assigned,
             * the modal was opened to change something else — most often the
             * appointment — and an open dropdown over the form is in the way.
             */
            autoFocus={initialDriverId === null}
            claimedBy={claimedBy}
            truckLabel={truckName}
            disabled={!mayEdit || saving}
            disabledReason={mayEdit ? undefined : lockedReason}
            onChange={onDriver}
            /**
             * §12.38. CREATE ONLY here — the modal's own save does the
             * assigning, with the preview token a reassignment needs, so
             * creating AND assigning server-side would write it twice.
             */
            assignToTruckId={null}
            onDriverCreated={onDriverCreated}
          />
          {/* Under the field, as the design has it: beside the label it ran
              into the next column at 960px. */}
          <span className="mt-1 block font-cond text-micro uppercase tracking-[.09em] text-status-risk-fg">
            Driver change requires confirm
          </span>
          <span className="mt-0.5 block text-small text-text-mutedOnOverlay">
            {currentDriverName
              ? `Current assignment: ${currentDriverName}.`
              : 'No driver on this truck.'}{' '}
            Type a surname to search all {drivers.length} drivers.
          </span>
        </label>
        {/* §12.21: never required. Broker paperwork does not always carry one. */}
        <Field
          label="Load number"
          value={loadNumber}
          onChange={onLoadNumber}
          error={loadNumberError}
          help="Any format the broker uses, or leave it blank (§12.21)"
        />
        <label className="block">
          <span className="mb-1 block text-small text-text-secondary">Load status</span>
          <select
            value={loadStatus}
            onChange={(e) => onLoadStatus(e.target.value as LoadStatus)}
            className="h-10 w-full border border-line-hair bg-surface-sunken px-2 text-body text-text"
          >
            {LOAD_STATUSES.map((status) => (
              <option key={status} value={status}>
                {LOAD_STATUS_LABEL[status]}
              </option>
            ))}
          </select>
        </label>
        <span
          title={mayFlipActive ? undefined : 'Only an admin may change this.'}
          className="col-span-full flex items-center gap-2 text-body text-text-secondary"
        >
          <input
            type="checkbox"
            checked={active}
            disabled={!mayFlipActive || saving}
            aria-label="Active — on the console"
            onChange={(e) => onActive(e.target.checked)}
          />
          On the console
        </span>
      </div>
    </fieldset>
  );
}

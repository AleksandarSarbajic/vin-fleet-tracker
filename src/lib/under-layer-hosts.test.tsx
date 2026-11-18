// @vitest-environment happy-dom
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BasemapToggle, ShowAllControl, TopControls } from '@/components/console/map/MapChrome';
import { ListToolbar } from '@/components/console/ListToolbar';
import { PhoneTiles } from '@/components/console/phone/PhoneTiles';
import { StopList } from '@/components/edit/StopList';
import { stopFormFrom } from '@/components/edit/load-form';
import { CommandPalette } from '@/components/overlay/CommandPalette';
import { OverlayProvider, useOverlay } from '@/components/overlay/OverlayLayer';
import { TruckListEditor } from '@/components/console/TruckListEditor';
import { ScopeMenu } from '@/components/console/SavedViews';
import { FilterChips } from '@/components/console/FilterChips';
import { TruckRow } from '@/components/console/TruckRow';
import { GROUND_HOST } from '@/lib/appear-motion';
import { fleetHealth, fleetRow } from '@/test/fleet-row';
import { ownsStackingContext } from './under-layer';

/**
 * §12.165, check (a). Every host a layer is drawn under, by name, rendered by its own component,
 * and found as the motion finds it: each must own a stacking context, as `layUnder` asks before it
 * draws (src/lib/under-layer.ts). The same predicate the refusal uses, so this fails here, by the
 * host's name, before the refusal could fire in a browser.
 *
 * What it reads is the class list React gives the element. jsdom applies no stylesheet, so a
 * computed `position` would read `static` everywhere; the classes are where the context is decided,
 * and Tailwind turns `relative` and `isolate` into `position: relative` and `isolation: isolate`,
 * one utility each. That they paint right in a real browser is `new-motion.spec.ts`'s slide check
 * (three segment hosts) and the desktop baselines; this is the guard that runs on every commit.
 *
 * When a new layer is drawn under a new host, add the host here. `under-layer.test.tsx` keeps the
 * layers themselves in the shared module.
 */

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const render = (node: ReactNode) => act(() => root.render(node));
const one = (selector: string): HTMLElement => {
  const found = document.body.querySelector<HTMLElement>(selector);
  if (!found) throw new Error(`nothing matches ${selector}`);
  return found;
};
const noop = () => {};
const queries = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });

function OpenPalette({ children }: { children: ReactNode }) {
  const { show } = useOverlay();
  return (
    <>
      <button type="button" data-open-palette onClick={() => show('palette')} />
      {children}
    </>
  );
}

const stops = [stopFormFrom(null, '2026-11-18T12:00:00.000Z', 'a'), stopFormFrom(null, '2026-11-18T12:00:00.000Z', 'b')];
const flags = stops.map(() => ({ next: false, arrived: false, departed: false, arrivalBlocked: null }));
const stopList = () =>
  render(
    <StopList
      stops={stops}
      flags={flags}
      selected={0}
      dirtyKeys={new Set()}
      errorKeys={new Set()}
      onSelect={noop}
      mayEdit
      addBlocked={null}
      onAdd={noop}
      motion={{ current: null }}
    />,
  );

const HOSTS: { name: string; layers: string; find: () => HTMLElement }[] = [
  {
    name: "the basemap toggle's box (MapChrome), where the map draws it beside Show all",
    layers: 'the segment slide (lib/segment-slide.ts)',
    find: () => {
      render(
        <TopControls>
          <ShowAllControl disabledReason={null} onShowAll={noop} />
          <BasemapToggle basemap="dark" onChange={noop} />
        </TopControls>,
      );
      return one('[role="group"][aria-label="Basemap"]');
    },
  },
  {
    name: 'the density control (ListToolbar)',
    layers: 'the segment slide (lib/segment-slide.ts)',
    find: () => {
      render(<ListToolbar density="comfortable" onDensity={noop} health={fleetHealth()} drift={0} onResort={noop} />);
      return one('[role="group"][aria-label="Row density"]');
    },
  },
  {
    name: "the phone's List and Map tabs (PhoneTiles)",
    layers: 'the segment slide (lib/segment-slide.ts)',
    find: () => {
      render(
        <PhoneTiles
          rows={[fleetRow()]}
          chips={new Set()}
          onToggle={noop}
          onReset={noop}
          onMore={noop}
          moreOpen={false}
          pane="list"
          onPane={noop}
        />,
      );
      return one('[role="tablist"][aria-label="Show"]');
    },
  },
  {
    name: "the stop tabs' box (StopList, [data-stop-tabs])",
    layers: "a removed stop's copy (edit/stop-motion.ts beforeRemove)",
    find: () => {
      stopList();
      return one('[data-stop-tabs]');
    },
  },
  {
    name: 'the stop tablist (StopList)',
    layers: "the chosen stop's slide (edit/stop-motion.ts stopChosen)",
    find: () => {
      stopList();
      return one('[role="tablist"][aria-label="Stops on this load"]');
    },
  },
  {
    name: "the palette's results (CommandPalette)",
    layers: "the cursor's slide (overlay/palette-cursor.ts)",
    find: () => {
      render(
        <OverlayProvider>
          <OpenPalette>
            <CommandPalette
              trucks={[]}
              views={[]}
              selectedLabel={null}
              selectedPinned={false}
              density="comfortable"
              onSelectTruck={noop}
              onApplyView={noop}
              onTogglePin={noop}
              onToggleDensity={noop}
            />
          </OpenPalette>
        </OverlayProvider>,
      );
      act(() => one('[data-open-palette]').click());
      return one('[role="listbox"][aria-label="Commands"]');
    },
  },
  {
    name: "a truck list's chips (TruckListEditor)",
    layers: "a removed chip's copy (console/list-motion.ts)",
    find: () => {
      render(
        <QueryClientProvider client={queries()}>
          <TruckListEditor
            mode={{ kind: 'create', initialIds: ['t1'] }}
            fleet={[{ id: 't1', truckNumber: 101, samsaraName: 'Truck #101', active: true }]}
            checkedIds={[]}
            canEdit
            onClose={noop}
            onSaved={noop}
            onDeleted={noop}
          />
        </QueryClientProvider>,
      );
      return one('ul[aria-label="Trucks in this list"]');
    },
  },
  {
    name: "the saved views' rows (ScopeMenu, [data-view-rows])",
    layers: "a removed view's copy (console/list-motion.ts)",
    find: () => {
      render(
        <ScopeMenu
          views={[{ id: 'v1', name: 'Late trucks', query: '', chips: ['late'] }]}
          active={null}
          onApply={noop}
          onSave={() => null}
          onRemove={noop}
          onRename={() => null}
          canSaveCurrent
          scopeCount={1}
          fleetCount={1}
          viewCount={() => 1}
          onClear={noop}
        />,
      );
      act(() => one('[aria-haspopup="menu"]').click());
      return one('[data-view-rows]');
    },
  },
  {
    name: 'a filter chip while its look is on the way (FilterChips, as groundPop marks it)',
    layers: "the chip's look (lib/appear-motion.ts groundPop)",
    find: () => {
      render(<FilterChips rows={[fleetRow()]} selected={new Set()} onToggle={noop} onReset={noop} />);
      const chip = one('button[aria-pressed]');
      chip.setAttribute(GROUND_HOST, '');
      return chip;
    },
  },
  {
    name: 'a truck row (TruckRow)',
    layers: "the flash (UnderLayer), the saved row's glow (lib/appear-motion.ts savedGlow) and the press layer (globals.css)",
    find: () => {
      render(
        <TruckRow
          row={fleetRow()}
          fetchedAt="2026-11-18T12:00:00.000Z"
          feedStale={false}
          columns={8}
          density="comfortable"
          selected={false}
          checked={false}
          onCheck={noop}
          flash={null}
          reducedMotion={false}
          pinned={false}
          onPin={noop}
          query=""
          onSelect={noop}
          onEdit={noop}
        />,
      );
      return one('[data-row-id]');
    },
  },
];

describe('every host a layer is drawn under owns its stacking context', () => {
  it.each(HOSTS)('$name, under which: $layers', ({ name, find }) => {
    const el = find();
    expect(
      ownsStackingContext(el),
      `${name} has no stacking context of its own (class="${el.className}"): give it \`relative isolate\``,
    ).toBe(true);
  });
});

describe('the segment hosts are what the slide measures from', () => {
  it("the basemap toggle's own buttons are inside its box, marked", () => {
    const box = HOSTS[0]!.find();
    expect([...box.querySelectorAll('[data-segment]')].map((b) => b.getAttribute('data-segment'))).toEqual(
      expect.arrayContaining(['dark', 'satellite']),
    );
  });
});

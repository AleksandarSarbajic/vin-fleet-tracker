# Fleet Tracker — design spec

Plain-markdown extraction of `design/Fleet_Tracker_dc.html` (1,927 lines, four
turns). **From phase 1 onward, build from this file, not the HTML.**

## Authority and provenance

Later turns supersede earlier ones. Every value below is tagged with the
section it came from so it can be re-checked without re-reading the whole
document.

| Turn | Sections | Status |
|---|---|---|
| 4 | 4a, 4b, 4c | Highest authority — reassignment, derived zones, overrides |
| 3 | 3a–3f | Edit modal, draggable split, 30/60-truck consoles, corrected tokens, login, assets |
| 2 | 2a–2h | Console screens, degraded states, phone, **2g spec sheet (current)**, feedback set |
| 1 | 1a–1d | Status token palette, row variants, interaction states |

Turn 2 carries a "Partly superseded" banner. What turn 3 overrules in turn 2:

- `2c` modal → **`3a`** (stop-local time field, assignment group, generic field error)
- Fixed 644px map in `2a` / `2b` / `2d` → **`3b`** draggable split
- No-scroll promise → **`3c`** above-the-fold contract
- Selected-row ground → **`3e`**
- Single header clock → **`3c`** two-clock block
- Every zone label → **`4b`** (derived at render, never literal)

Everything else in turn 2 stands. **`2g` is the spec sheet and is current** —
its token block, type scale, layout table, truncation order and keyboard map
were updated in place.

## The four corrections

Applied throughout this document. The design HTML still shows the uncorrected
version; this file is the corrected one.

1. **No HOS anywhere.** Deleted: the "HOS drive left 4h 10m" row in the `2b`
   detail panel, "HOS left" in the `2f` phone panel, "HOS 11h 00m" and "off
   duty until Tue 06:00" in the `3a` driver picker, and the HOS clause in the
   At risk rule (`1a` preamble). The driver picker shows current truck
   assignment and the `active` flag only.
2. **Column widths.** `4a` widened Status to 128px and `4b` widened Appt to
   128px. The real row takes **both**. The 22px comes out of the two flexible
   columns; truncation order re-checked below.
3. **DST dates.** `4b`'s caption quotes 2026 transition dates (8 Mar, 29 Mar,
   1 Nov) on a screen labelled 2027-01-19. Every DST boundary is derived in
   code and in tests. No date in this file is a boundary to paste.
4. **Override expiry default.** `4c` defaults to "End of dispatch day", which
   is ~20 hours when set just after midnight. Default is **`+4h`**; End of
   day, Until appt and Custom remain as the other options.

---

# 1. Token palette

Source: `2g` theme extension (verbatim), `1a` measured ratios, `3e`
corrections. **Lift these into `tailwind.config.ts`; never retype a hex into
a component.**

## 1.1 Dark theme (default — this is what QA signs off)

### Surfaces

| Token | Value | Use |
|---|---|---|
| `surface.sunken` | `#0f1215` | Map ground, login page ground, input fills |
| `surface.base` | `#15181b` | App body, detail panel, cards |
| `surface.raised` | `#1d2126` | Header bar, column header, row hover, footers |
| `surface.overlay` | `#252a30` | Modals, toasts, popovers, active segment |

### Lines

| Token | Value |
|---|---|
| `line.hair` | `rgb(255 255 255 / .13)` |
| `line.soft` | `rgb(255 255 255 / .08)` |

`line.hair` is panel and header borders; `line.soft` is row separators.

### Text

| Token | Value | Ratio on `surface.base` |
|---|---|---|
| `text.DEFAULT` | `#e9ebed` | **14.9:1** |
| `text.secondary` | `#a9b0b6` | **8.1:1** |
| `text.muted` | `#858d94` | **5.3:1** |
| `text.inverse` | `#15181b` | — (ink on accent fills) |
| `text.mutedOnSelected` | `#949ca4` | **5.76:1** on `row.selected` — see 1.3 |

### Rows

| Token | Value |
|---|---|
| `row.hover` | `#1d2126` |
| `row.selected` | `#1b222b` |

### Brand and accent

| Token | Value | Ratio on `surface.base` | Rule |
|---|---|---|---|
| `brand.navy` | `#0d2b6b` | **1.3:1** | Unusable as UI ink on dark. Light theme and print only. |
| `brand.cyan` | `#29b6d8` | **7.5:1** | The mark itself and the login card. **Nowhere else.** |
| `accent.DEFAULT` | `#94bce3` | **9.0:1** | Every interactive element, focus ring, selection rail |
| `accent.hover` | `#b5d3ef` | — | |
| `accent.press` | `#749dc4` | — | |

No brand colour touches red, amber or green (`1a` preamble).

### Radius and fonts

```
borderRadius: { DEFAULT: '0px', sm: '2px', md: '4px' }
fontFamily: {
  sans: ['Barlow', 'system-ui', 'sans-serif'],
  cond: ['Barlow Condensed', 'system-ui', 'sans-serif']
}
```

Square corners are the default. `sm`/`md` exist but are not used on any drawn
element.

## 1.2 Light theme — specified, not built

> **Deferred (§12.16).** Dark is the default and the only theme QA signs off.
> The remap below is recorded so it isn't lost, but it is **incomplete** — it
> has no values for `line.*`, `row.*`, `text.mutedOnSelected`,
> `status.neutral`, `status.tomorrow` or any status `bg`/`bd`, and no measured
> ratios. **Do not half-implement it.** Ship dark only until it is finished.

Same token names remapped, nothing else changes.

| Token | Light value |
|---|---|
| `surface.base` | `#f2f2f3` |
| `surface.raised` | `#e9e9ea` |
| `surface.overlay` | `#ffffff` |
| `text.DEFAULT` | `#1d1f20` |
| `text.secondary` | `#4b4f53` |
| `text.muted` | `#6a6f74` |
| `accent.DEFAULT` | `#416180` |
| `status.late.fg` | `#8e2c1d` |
| `status.risk.fg` | `#7a5310` |
| `status.ontime.fg` | `#12603a` |
| `status.arrived.fg` | `#2c455d` |

Status `fg` moves to the 700–800 step over 100-step tints. Dark is the
default.

## 1.3 Selected-row corrections (`3e`)

Both levers were needed; lifting the ground alone would have pushed light ink
further down.

| Pair | Was | Now | Ratio |
|---|---|---|---|
| Muted ink on selected | `#858d94` on `#222a33` | `#949ca4` on `#1b222b` | 4.31 → **5.76** |
| Primary ink on selected | `#e9ebed` on `#222a33` | `#e9ebed` on `#1b222b` | 12.14 → **13.41** |
| Worst status ink on selected | `#ff8a7a` on `#222a33` | `#ff8a7a` on `#1b222b` | 6.34 → **7.00** |

The selected ground moved **down** to `#1b222b` — marginally darker than
base, reading as recessed-and-active rather than lit, matching the inset
focus ring. `text.mutedOnSelected` (`#949ca4`) is used **only** inside a
selected row. The 3px steel rail and the status stripe are unchanged.

---

# 2. Type scale

Six sizes. Source: `2g`.

| Name | Size / leading | Family & weight | Use |
|---|---|---|---|
| Display | 22 / 1.1, `letter-spacing: .04em`, uppercase | cond 600 | Login, modal titles, empty-state headlines |
| Header | 15 / 1, `letter-spacing: .14em`, uppercase | cond 600 | App name, panel headers, buttons, chips |
| Data | 14, tabular | sans 700 | Truck numbers, times, the row's primary cell |
| Body | 12.5 / 1.45 | sans 400/500 | Every other row cell, detail values, notes |
| Small | 11.5 / 1.5 | sans 400 | Field labels, captions, secondary facts |
| Micro | 10.5, `letter-spacing: .11em`, uppercase | cond 600 | Column heads, group labels, legends only |

**Micro is 10.5px, not 9.5px** (`3e`) — the 9.5 step is gone from the file.
Map footer text, marker-key rows, the cluster caption and spec-sheet group
labels all moved with it.

`font-variant-numeric: tabular-nums` is set on `body` and **never turned
off** — truck numbers, times, ETAs, counts and mileages align down the
column.

Observed variants of the scale in use:

- Two-line row truck number: sans 700 **15**/1.2 (`1b`)
- Modal title: cond 600 **17**/1.1, `.06em` (`3a`, `4a`, `2h` boundary)
- Panel header strip: cond 600 **12**, `.1em` (`2a`, `3c`)
- Chip label: cond 600 **10.5**/1, `.08em` in rows; **11**/1, `.09em` in the
  `1a` reference chips; **11.5**/1, `.08em` in header filter chips

---

# 3. Layout and breakpoints

Reference viewport **1728 × 1040 logical** — where a 2560×1440 at 150% and a
MacBook 16 both land. Header is 56px; everything below it is the split.

| Width | Behaviour |
|---|---|
| **≥ 2200** | Ultrawide. Map grows to 980px; list keeps its 8 columns (Trailer and Broker are both cut — §12.20, §12.53). All header chips visible. |
| **1440–2199** | Reference layout. Header 56, then the `3b` draggable split — default 60/40 in the list's favour (at 1728: list 1037, map 685, handle 6). Map hard minimum 520px, list minimum 560px. Position persisted per dispatcher. **The map is never a fixed width.** |
| **1280–1439** | Split still draggable, range narrows to map 520–620. Driver column drops to **120px**; Position and Next stop share the remainder. **Below 900px of list width the row drops to six columns** (§12.17). |
| **1024–1279** | Below **1086** total the split is **disabled**: map collapses to a toggle, list runs full width. Toggle state persists per dispatcher. **The detail panel becomes a full-screen sheet over the list** (§12.12). |
| **< 1024** | Two-line rows (`1b`), map as a tab. |
| **< 480** | Phone stack (`2f`). |

1086 = list min 560 + handle 6 + map min 520.

## 3.1 Fold contract

There is **no no-scroll promise**. It only ever held at ≤20 trucks in a
1040px viewport — 21 rows at 44px is 924px of a 922px body.

The replacement contract:

- The list body scrolls with its **column header sticky inside the scroller**.
- Urgency sort keeps the problem set at the top.
- The **footer bar counts what is below the fold by status**, including the
  explicit `0 problems below the fold` when that is true.

Drawn examples: at 30 trucks, 21 rows above the fold in a 922px body —
`Showing 1–21 of 30` · `0 problems below the fold` · `9 below: 6 on time, 3
tomorrow` (`3c`). At 60 trucks with groups — `Showing 1–19 of 60 · 4 groups
open` · `0 problems below the fold` · `41 below: 5 arrived, 25 on time, 12
tomorrow` · `Collapse all` (`3d`).

## 3.2 Draggable split (`3b`)

| Aspect | Rule |
|---|---|
| Default | 60 / 40 in the list's favour |
| Limits | Map hard minimum 520px, list minimum 560px |
| Disable | Below 1086px total, split off, map becomes a toggle |
| Persist | `localStorage["ft.splitPct"]`, written **on release**, one decimal, per browser. Missing or unparseable → fall back to **60** |
| Keyboard | Handle is focusable; `←` `→` move it in **2%** steps; `Home` resets to 60 |
| Mouse | Double-click resets to 60/40 |
| While dragging | **No transition on the columns**; the map **defers its reflow to drag-end** so the pointer never lags. Row text re-truncates live. |

Handle: 6px hit area, 12px grab margin, `cursor: col-resize`. Grip is six 2px
dots stacked with 3px gaps.

| State | Handle |
|---|---|
| Default | `line.hair` ground, grip `#5d646b` |
| Hover | `accent` ground, grip `#15181b`, `col-resize` |
| Dragging | `accent` ground + 1px `accent.hover` outline |
| Focus | `line.hair` ground + 2px `accent` outline, offset 1 |

---

# 4. The truck row

## 4.1 Console row — single line, 44px (corrected)

The console grid, **with corrections 2 applied** (Appt 116 → 128, Status
118 → 128):

```
grid-template-columns: 3px 72px 148px minmax(0,1fr) minmax(0,1.25fr) 128px 100px 128px;
gap: 0 14px;
height: 44px;
padding-right: 16px;
border-bottom: 1px solid line.soft;
```

| # | Column | Width | Align | Type |
|---|---|---|---|---|
| 1 | Status stripe | 3px | — | `align-self: stretch`, full-bleed left edge |
| 2 | Truck | 72px | left | Data 14 / 700, tabular |
| 3 | Driver | 148px (120 at 1280–1439) | left | Body 12.5 / 400 |
| 4 | Position | `minmax(0,1fr)` | left | Body 12.5 / 500 |
| 5 | Next stop | `minmax(0,1.25fr)` | left | Body 12.5 / 400 |
| 6 | **Appt** | **128px** | right | Body 12.5 / 600, tabular |
| 7 | ETA | 100px | right | Body 12.5 / 500, tabular |
| 8 | **Status** | **128px** | right | chip, `justify-content: flex-end` |

Column header row: 28px, `surface.raised`, `line.hair` bottom, Micro labels
in `text.muted`, same grid. **Sticky inside the scroller** (`position:
sticky; top: 0; z-index: 2`).

### Width arithmetic at the reference viewport

At 1728 with the default 60/40 split, the list column is **1037px**.

```
fixed      3 + 72 + 148 + 128 + 100 + 128 = 579
gaps       7 × 14                         =  98
padding-right                             =  16
                                    total =  693
flexible   1037 − 693                     = 344
  Position  (1fr)    344 / 2.25           ≈ 153
  Next stop (1.25fr) 344 × 1.25 / 2.25    ≈ 191
```

Before the corrections the flexible pool was 366 (Position ≈ 163, Next stop
≈ 203). **The 22px comes out as ~10px from Position and ~12px from Next
stop**, which is the proportional split the brief calls for.

`3e` proves the five fixed columns hold their Micro labels with room to
spare at 10.5px; widening two of them only adds room. Barlow Condensed at
`.11em` is narrow enough that a 1px type step costs about 4px of label width.

> **Flag — see §13.3.** 693px of non-flexible width does not fit inside the
> 560px list minimum. See the open question on the narrow-list row variant.

### Narrow variant — six columns below 900px of list width (§12.17)

```
grid-template-columns: 3px 72px 148px minmax(0,1fr) 128px 128px;
gap: 0 14px;
height: 44px;            /* unchanged — never shrink to fit */
padding-right: 16px;
```

Status rail · Truck · Driver · **Next stop** · Appt · Status. **Position and
ETA are cut**, not squeezed: Position is carried by the detail panel and the
marker, and ETA is derived rather than entered.

Non-flexible width is **565px**, which fits the 560px list minimum with the
one flexible column taking the remainder. Type scale and row height are
identical to the eight-column row.

## 4.2 Column labels

`Truck` · `Driver` · `Position` · `Next stop` · `Appt` · `ETA` · `Status`

Two label variants exist:

- **`Appt · stop-local`** (`4b`) when the column is showing stop-local times —
  which is always, per §7.
- **`Position (frozen)`** (`2e`) in the offline header. It is the longest
  label in the set; it lives in a flexible column, holds down to the 1280
  breakpoint, then **abbreviates to `Position`** rather than ellipsising
  (`3e`).

## 4.3 Two-line row — 56px (`1b`)

For a narrow list panel beside the map.

```
grid-template-columns: 3px 78px minmax(0,1fr) 92px 96px;
gap: 0 12px;
min-height: 56px;
padding-right: 14px;
```

Column heads: `Truck` · `Position → next stop` · `Appt / ETA` · `Status`.

| Cell | Line 1 | Line 2 |
|---|---|---|
| Truck | number, sans 700 15/1.2, tabular | driver, sans 400 11.5/1.3, `text.secondary` |
| Position | position, sans 500 12.5/1.3, `text.DEFAULT` | `→ ` next stop, sans 400 11.5/1.3, `text.secondary` |
| Appt / ETA | appt, sans 600 12.5/1.3, tabular, right | `ETA hh:mm`, sans 500 11.5/1.3, status-coloured, right |

Hit target 56 > 40 minimum.

## 4.4 Phone row — 76px (`2f`)

```
grid-template-columns: 3px 1fr auto;
gap: 0 11px;
min-height: 76px;
padding-right: 12px;
```

Fields stacked: truck (sans 16, tabular) + driver on line 1; `position →
next stop` on line 2; `Appt hh:mm` and `ETA hh:mm` wrapping on line 3. Chip
24px right-aligned. **Status chip and truck number are the only things
guaranteed a fixed position.** Map is a tab, never a split — at 390px a split
gives you six trucks.

## 4.5 Interaction states (`1d`)

| State | Treatment |
|---|---|
| Default | `surface.base` ground |
| Hover | `row.hover` `#1d2126` |
| Selected | `row.selected` `#1b222b` + **3px `accent` left border**. Muted ink in the row switches to `text.mutedOnSelected`. |
| Focus-visible | `outline: 2px solid accent; outline-offset: -2px` (inset, so the scroll container doesn't clip it) |
| Loading | Skeleton blocks — `#252a30` for primary cells, `#1f2429` for secondary. Stripe `rgb(255 255 255 / .08)`. No shimmer. |
| Disabled | `opacity: .45`, stripe `rgb(255 255 255 / .14)`, driver reads `Unassigned`, next-stop cell reads `Out of service`, appt `— : —` |
| Error | Stripe keeps its status colour; the flexible cells collapse into one line: icon + `Load data failed to refresh · Retry` in `status.late.fg`, `Retry` in `accent` |

Selection is carried by ground + the 3px steel rail on the **left edge**, so
it never fights the status stripe, which is the inner 3px column. Under
`prefers-reduced-motion` the ground change is instant and the marker→row link
is a static highlight instead of a scroll.

---

# 5. Status system

Every state carries **hue + shape + icon + word**. Markers differ by *shape*
before they differ by hue; chips repeat the shape as an icon and **always
print the word**. Greyscale-safe by construction.

## 5.1 The eight states

Seven come from `1a`; **Unassigned** was added in turn 4 and reuses the
data-integrity neutral pair exactly (`#b3bac0` on `#262a2f`), separated from
No appt and Stale GPS by border style, icon and marker pattern — **no new
hue**.

| Status | fg | bg | border | Border style | Chip word |
|---|---|---|---|---|---|
| `LATE` | `#ff8a7a` | `#3a1f1c` | `#6b3129` | solid | `Late` |
| `STALE_GPS` | `#b3bac0` | `#262a2f` | `#6e767d` | **dotted** | `2h 40m` — elapsed, tabular, **one format everywhere, no `GPS` prefix**; the icon carries that (§12.11) |
| `UNASSIGNED` | `#b3bac0` | `#262a2f` | `#6e767d` | **solid** | `Unassigned` |
| `AT_RISK` | `#f2b23f` | `#3a2c15` | `#6b5224` | solid | `At risk` |
| `NO_APPT` | `#b3bac0` | `#262a2f` | `#6e767d` | **dashed** | `No appt` |
| `ARRIVED` | `#9cc4e8` | `#1c2a38` | `#37516b` | solid | `Arrived` |
| `ON_TIME` | `#5ed69b` | `#15301f` | `#27573a` | solid | `On time` |
| `TOMORROW` | `#858d94` | `transparent` | `rgb(255 255 255 / .14)` | solid, **weight 400** | `Tomorrow` |

Tailwind token names (`2g`): `status.late`, `status.risk`, `status.ontime`,
`status.tomorrow`, `status.arrived`, `status.neutral`. The three neutral
states (`STALE_GPS`, `UNASSIGNED`, `NO_APPT`) all resolve to
`status.neutral` and are told apart by border style, icon and marker
pattern — never by colour.

**`STALE_GPS` is only evaluated for a truck with a live appointment**
(§12.3). Samsara gateways report on ignition, so a legitimately parked truck
goes quiet for hours; a parked truck with no load resolves to `NO_APPT` and
**never** to `STALE_GPS`. `UNASSIGNED` is gated on a live appointment the
same way, which makes the three neutral states mutually exclusive by
construction.

## 5.2 Measured contrast (`1a`)

"Text" is `fg` on `surface.base`; "chip" is `fg` on its own chip `bg`.

| Status | Text | Chip |
|---|---|---|
| `LATE` | **7.8** | **6.6** |
| `AT_RISK` | **9.5** | **7.2** |
| `ON_TIME` | **9.8** | **7.9** |
| `TOMORROW` | **5.3** | — (no fill) |
| `ARRIVED` | **9.7** | **8.0** |
| `NO_APPT` | **9.1** | **7.4** |
| `STALE_GPS` | **9.1** | **7.4** |
| `UNASSIGNED` | **9.1** | **7.4** (same pair as above) |

Worst status ink on a selected row: `#ff8a7a` on `#1b222b` = **7.00** (`3e`).

**Every one of these was independently verified in the design document. Do
not re-derive them by hand.**

## 5.3 Markers

Marker shape is the primary channel. 26×26 viewBox, `stroke: surface.base`
`stroke-width: 1.5` on filled shapes.

| Status | Shape | Fill | Stroke |
|---|---|---|---|
| `LATE` | **Triangle**, point up | `#ff8a7a` | `#15181b` |
| `AT_RISK` | **Diamond** | `#f2b23f` | `#15181b` |
| `ON_TIME` | **Filled circle** r 7.5 | `#5ed69b` | `#15181b` |
| `TOMORROW` | **Hollow circle** r 7 | none | `#858d94` 1.5 |
| `ARRIVED` | **Square** 14×14 with a check | `#9cc4e8` | `#15181b`, check in `#15181b` |
| `NO_APPT` | **Dashed circle** r 7.2 + `?` glyph | `#262a2f` | `#b3bac0`, `stroke-dasharray: 3 2.6` |
| `STALE_GPS` | **Hatched circle** r 7.2 | 45° hatch pattern, 4px pitch, `#b3bac0` 1.4 | `#b3bac0`, `stroke-dasharray: 1.5 2.2` |
| `UNASSIGNED` | **Solid-outline circle** | `#262a2f` | `#b3bac0` solid 1px |

## 5.4 Chip icons

| Status | Icon |
|---|---|
| `LATE` | Warning triangle with `!` |
| `AT_RISK` | Clock (circle + hands) |
| `ON_TIME` | Circle + check |
| `TOMORROW` | Calendar |
| `ARRIVED` | Map pin + check |
| `NO_APPT` | Dashed circle + `?` |
| `STALE_GPS` | Broken/struck GPS link |
| `UNASSIGNED` | **Driver-slash** |
| *Forced (override)* | **Override glyph replaces the status icon** — see §9.5 |

Chip geometry in a row: `height: 21px; padding: 0 7px; gap: 4px`, icon 11px,
cond 600 10.5/1, `.08em`, uppercase, `border: 1px <style> <bd>`. Tomorrow's
chip is weight **400**. Stale GPS chips carry `tabular-nums` because they
print an elapsed time.

## 5.5 Row stripe (3px, column 1)

| Status | Stripe |
|---|---|
| `LATE` / `AT_RISK` / `ON_TIME` / `ARRIVED` | Solid `fg` |
| `TOMORROW` | `rgb(255 255 255 / .14)` |
| `NO_APPT` | `repeating-linear-gradient(180deg, #b3bac0 0 4px, transparent 4px 8px)` — **dashed** |
| `STALE_GPS` | `repeating-linear-gradient(180deg, #b3bac0 0 1.5px, transparent 1.5px 5px)` — **dotted** |
| `UNASSIGNED` | Solid `#b3bac0` |

## 5.6 Urgency sort order

Top to bottom, and it is also the `Status` union order in `lib/status.ts`:

```
LATE → STALE_GPS → UNASSIGNED → AT_RISK → NO_APPT → ARRIVED → ON_TIME → TOMORROW
```

Turn 4: a truck with a live appointment and nobody driving it sorts **third**,
after Late and Stale GPS, ahead of At risk. It cannot sit below twelve on-time
rows.

**Secondary sort within an urgency band: appointment time ascending, nulls
last** (§12.4).

**The list does not re-sort on refresh.** Order is computed on load, on filter
change, and on explicit user action only. Status colours, ETAs and positions
update **in place**; rows never move under a click. When the computed order
has drifted, a pill appears at the top of the scroller — `6 rows would
reorder` — and clicking it re-sorts. This is also what makes the `2h`
status-change toast safe: the row has already recoloured, but it has not
moved.

Other sorts offered in the list header (`2a`, `3c`): `Urgency` (default,
active) · `Appt time` · `Truck no.`

## 5.7 Urgency groups (above 40 trucks) — **specified, not built**

> **Build the flat list.** The real fleet is **23 active trucks of 34** (11
> are inactive — measured, see `docs/samsara.md` §3). That is the 20-truck
> layout: no group heads, no collapsed sections. This section stays specified
> so nothing is lost, and the code path stays unwritten until the fleet
> actually crosses 40. Virtualize the flat list regardless of size.

Above 40 trucks the flat list stops being readable and urgency becomes
explicit group heads (`3d`):

- Group head: **30px**, `#1a2027` ground, `line.hair` bottom, chevron +
  Micro-ish cond 600 11.5 `.11em` label in the group's `fg` + count in
  sans 600 11.5 `text.secondary`, tabular.
- Same sort, now labelled and collapsible. Click a group head to collapse.
- **On time and Tomorrow default to collapsed** once the fleet passes 40.
- Group heads **scroll with the rows**. Only the column header is sticky —
  two stacked sticky layers eat the fold.
- Footer gains `· N groups open` and a `Collapse all` control.

**Carried forward from §14.5, for when this is built:** the pinned block sits
above the first group header, pinned trucks are removed from their group
rather than duplicated, and the group count reads `Late 4 · +1 pinned`. The
removal half shipped with §14's feature 4 and applies to the flat list today;
the count wording has nothing to attach to until group heads exist.

## 5.8 Unassigned on the row (turn 4)

- The **driver cell** reads `Unassigned` in neutral ink (`#b3bac0`) with the
  driver-slash icon at 6px gap.
- The schedule chip is **replaced, not accompanied** — an ETA for a truck with
  no driver is fiction.
- Its **last computed ETA moves into the ETA cell as struck-through text**
  (`text-decoration: line-through`, `text.muted`).
- The row keeps a **marginally sunken ground `#1b1e21`**, so it reads as inert
  rather than urgent. It is a problem of allocation, not of time.

## 5.9 Offline rule — hard requirement

When the feed is stale, the client **withdraws schedule colour fleet-wide**:
every row drops to the stale treatment. A green row built on nine-minute-old
GPS is worse than no row.

**Appointment times stay full strength** — they come from our DB, not the
feed.

Drawn (`2e`): list body `opacity: .72`, every stripe switches to the dotted
stale gradient, every ETA cell reads `stale` in `text.muted`, every chip
becomes a dotted neutral chip carrying the elapsed age (`9m`). The `Position`
column head becomes `Position (frozen)`.

---

# 6. Truncation order and tooltips

## 6.1 As written in `2g`

| Rank | Column | Degradation | Tooltip |
|---|---|---|---|
| 1st | **Next stop** | dock/door detail drops, then the city ellipsises | full facility name, address, dock, stop-local appointment |
| 2nd | **Driver** | surname ellipsises, initial stays | full name, cell number |
| 3rd | **Position** | the `on site` suffix drops before the city does | highway, heading, GPS age |
| Never | **Truck number, appointment time, ETA, status chip** | fixed-width, always complete | — |

## 6.2 Re-checked against the actual column set (correction 2)

The ranking is the right *priority* — Next stop is the most expendable,
Position the least, Driver in between — but the mechanism needs stating
correctly, because only two of the three named columns actually respond to
the panel narrowing:

- **Next stop** is `minmax(0,1.25fr)` — flexible, shrinks continuously.
- **Position** is `minmax(0,1fr)` — also flexible, also shrinks continuously,
  and being the narrower of the two it reaches its content limit sooner in
  absolute pixels.
- **Driver** is **fixed at 148px**. It does not narrow with the panel at
  1440+. It ellipsises only when the name itself exceeds 148px, and it steps
  to **120px** once at the 1280–1439 breakpoint.

So the implementable ladder, in order, as the list panel narrows:

1. **Next stop** drops its dock/door detail (` · Dock 14`).
2. **Position** drops its ` · on site` suffix.
3. **Next stop** city ellipsises.
4. **Position** city ellipsises.
5. **Driver** steps 148 → 120px at the 1280 breakpoint and ellipsises the
   surname, keeping the initial.
6. **Never**: Truck, Appt, ETA, Status chip.

Below 900px of list width the ladder stops mattering: Position and ETA are
gone entirely (§12.17) and Next stop is the only flexible column left, so it
absorbs all of the narrowing on its own.

The two widened columns (Appt 128, Status 128) join Truck and ETA in the
never-truncate set — they are wider than before, so they are further from
their limits, not closer.

Tooltip on any truncated cell shows the full string plus stop-local time
(`1b`).

---

# 7. Timezones

**Every printed abbreviation is computed at render time** from the instant
plus the stop's IANA zone:

```ts
new Intl.DateTimeFormat(locale, { timeZone, timeZoneName: 'short' })
```

**Never stored as a literal, never concatenated, never hardcoded.** No
abbreviation, offset or label exists as a string anywhere in the design.

## 7.1 Which zone prints where

| Surface | Zone |
|---|---|
| **Appt column** | The **stop's** own zone. Column may be labelled `Appt · stop-local`. A single list carries MST, PST, EST and CST at once — this is the point of labelling every time, and the reason the column needed the extra 12px. |
| Header clock 1 | Dispatch zone (`America/Chicago`), sans 600 15/1.05 tabular + `CDT · DISPATCH` in cond 600 10.5 `.1em` `text.secondary` |
| Header clock 2 | Viewer's browser zone, sans 400 13/1.05 tabular `#949ca4` + `CET · YOU` in cond 400 10.5 `.1em` `text.muted` |
| Detail panel | Both — `Appointment` in dispatch-relative form and `Stop-local` as a second line naming the IANA zone in parentheses |
| Edit modal | **Stop-local is the field you type into**, abbreviation locked to the facility and shown inside the input. Dispatcher-local is a derived read-only line carrying both console clocks. |

## 7.2 DST — derive, never paste (correction 3)

`4b`'s caption quotes 2026 boundaries on a 2027 screen. Derive every boundary
in code and in tests. The **rules**, not the dates:

- **US**: forward on the **second Sunday of March**, back on the **first
  Sunday of November**, at 02:00 local.
- **EU**: forward on the **last Sunday of March**, back on the **last Sunday
  of October**, at 01:00 UTC.

Consequences to test, with every date derived:

| Window | Dispatch | Belgrade | Gap |
|---|---|---|---|
| Winter (both off DST) | CST (UTC−6) | CET (UTC+1) | **+7h** |
| Spring gap — US forward, EU not yet (**~3 weeks**) | CDT (UTC−5) | CET (UTC+1) | **+6h** |
| Summer (both on DST) | CDT (UTC−5) | CEST (UTC+2) | **+7h** |
| Autumn gap — EU back, US not yet (**~1 week**) | CDT (UTC−5) | CET (UTC+1) | **+6h** |

Also required: an appointment in `America/Phoenix` (no DST); the repeated
01:30 on the US fall-back date; midnight rollover of the `TOMORROW` rule in
the **dispatch** zone.

---

# 8. Keyboard, focus and motion

## 8.1 Keyboard map (`2g`, `3b`, `2c`)

| Key | Action |
|---|---|
| `/` | Focus search |
| `Esc` | Clears search, **then** clears selection. In a dirty modal, raises the discard confirm — never a silent close. |
| `↑` `↓` | Move row selection, map follows |
| `Enter` | **Open the edit modal.** Selection already shows the detail panel, so binding `Enter` to "detail" was redundant (§12.10). |
| `E` | Open edit (same as `Enter`) |
| `1`–`7` | Toggle the filter chips, in drawn order: `1` Late · `2` At risk · `3` On time · `4` Arrived · `5` Tomorrow · `6` Data issues · `7` Inactive. Chips are **multi-select** (§12.9). |
| `0` | Reset filters to All |
| `Cmd/Ctrl` + `Enter` | Save (edit modal) |
| `←` `→` | Move the split handle in 2% steps (when the handle has focus) |
| `Home` | Reset the split to 60 (when the handle has focus) |

Modal tab order (`2c`, still current): date → time → window → facility →
dock → override → note → Cancel → Save.

## 8.2 Focus

```
outline: 2px solid #94bce3;
outline-offset: 2px;   /* -2px inset inside scrollers */
```

**Never removed, never browser-default.** On a primary (accent-filled) button
the ring is `2px #e9ebed` at offset 2, since a steel ring on a steel fill
would not read (`2h`).

## 8.3 Motion

| Thing | Duration |
|---|---|
| Ground and selection changes | **120ms ease-out** |
| Map pan on selection | **150ms** |
| Everything else | **Nothing else animates** |

Under `prefers-reduced-motion`: **all of it becomes 0ms** and the map
**jumps rather than pans**. The marker→row link becomes a static highlight.
Skeletons have no shimmer, so reduced-motion changes nothing about them.

---

# 9. Screen behaviour

## 9.1 Header (56px)

`surface.raised` ground, `line.hair` bottom, `padding: 0 18px`, `gap: 0 18px`.

Grid: `auto 1px minmax(280px, 420px) 1fr auto` — mark+wordmark · divider ·
search · filter chips · status cluster. At 60 trucks the search shrinks to
`minmax(280px, 380px)` to give the chip row more room (`3d`).

- **Mark**: `mark-knockout.svg` at 30px tall + `Fleet Tracker` in Header type
  (cond 600 15/1, `.14em`, uppercase).
- **Divider**: 1px × 24px `line.hair`.
- **Search** (`2a`): 34px tall, `surface.base` fill, `line.hair` border,
  search icon, placeholder `Truck, driver, city, load…` in `text.muted`,
  and a `/` keycap badge on the right.
- **Filter chips**: 28px tall, `padding: 0 10px`, `gap: 6px` internal / `7px`
  between, cond 600 11.5/1 `.08em` uppercase, each with a tabular count in
  Barlow. `All` is the active-by-default chip: `surface.overlay` fill, `accent`
  border, count in `accent`. Each status chip uses its own `bd` as the border
  and its own `fg` as the ink, **unfilled** until selected; selecting fills it
  with `surface.overlay` (`2d`). Chip row is `flex-wrap: nowrap; overflow:
  hidden`.
- **Sync indicator**: 7px square dot + `Synced 12s ago` in sans 400 12,
  tabular, `text.secondary`. Dot is `status.ontime.fg` when healthy,
  `status.late.fg` when the feed is down, and the label becomes
  `Last sync 06:41 · 9m ago` in `status.late.fg` (`2e`).
- **Two clocks**: see §7.1. (Turn 2's single clock is superseded by `3c`.)
- **Avatar**: 30×30, 1px `line.hair` border, initials in cond 600 11
  `text.secondary`.

### Chip set

`All` · `Late` · `At risk` · `On time` · `Arrived` · `Tomorrow` ·
`Data issues` · **`Inactive`**. At 60 trucks `Data issues` abbreviates to
`Data` (`3d`). `Data issues` is the combined bucket for the three neutral
states.

**`Inactive` is added in v1** (§12.14). `trucks.active` is ours, not
Samsara's, and the stats feed returns every vehicle ever registered — some
dead since 2019. Without a way to see and flip inactive trucks, seeding is a
dead end. The chip filters to `active = false`; the flag is flipped by a
checkbox in the edit modal. No separate admin screen.

**Chips are multi-select** — each toggles independently, `0` resets to All
(§12.9).

**Counts are fleet-wide, not search-scoped** (§12.8). With a search narrowing
the list to 3 of 20, every chip still reads its full-fleet count. They show
what you would get if you cleared the search, which is the point of leaving
them visible.

## 9.2 List panel

Grid rows: `34px` panel header · list body · `30px` footer bar.

- **Panel header** (34px): `Fleet — N trucks · sorted by urgency` in cond 600
  12 `.1em` `text.secondary`, and on the right either the sort segment
  (`Urgency` / `Appt time` / `Truck no.`, active one on `surface.overlay`),
  or `1 selected · Esc to clear`, or at 60 trucks
  `Groups collapse — click a group head`.
- **Body**: scrolls, `min-height: 0`, column header sticky inside it.
  **Virtualize with TanStack Virtual regardless of current fleet size.**
- **Stale-sort pill**: when the computed order has drifted from the displayed
  order, a pill sits at the top of the scroller reading `N rows would
  reorder`. Clicking it re-sorts. See §5.6 — **the list never re-sorts on its
  own.**
- **Next stop** is the lowest `stops.sequence` with no `departed_at`. A truck
  holding two loads takes the **earliest deadline across both**, and the row
  shows the load number so it is clear which one (§12.13).
- **Footer bar** (30px): `#1a2027` ground, `line.hair` top, sans 400 11.5
  `text.secondary`. Left: `Showing 1–21 of 30`. Right: the below-the-fold
  counts, with `0 problems below the fold` in `status.ontime.fg` when true
  and the neutral breakdown in `text.muted`.

## 9.3 Map panel

- Mapbox **`dark-v11`** tiles.
- **Clustered — but the problem set never clusters** (§12.5). The problem set
  is `LATE`, `STALE_GPS`, `UNASSIGNED`, `AT_RISK`, `NO_APPT`. **Everything
  else clusters, Arrived included.** 30 trucks collapsing into clusters can
  never hide a late truck.
  *(This corrects `3d`'s caption, which said cluster counts were on-time and
  tomorrow only and left Arrived unaccounted for.)*
- Cluster bubble: square, `surface.raised` fill, 1px `accent` border, count in
  sans 600 tabular `text.DEFAULT`. Size scales with count — 34px at 5, 38px at
  7, 40px at 11, 42px at 14, 48px at 24.
- **No clustering above zoom 6**; clusters break apart as you zoom in past
  it. *(The document's `Clusters break below zoom 6` is backwards — §12.6.
  Confirm the exact zoom against real tiles before locking it.)*
- **Zoom control**: two stacked 32×32 buttons, `surface.raised`, `line.hair`
  border, top-right at 16/14px inset.
- **Marker key**: bottom-right, `rgba(21,24,27,.92)` ground, `line.hair`
  border, Micro heading `Marker key`, then one 11px row per shape — Late, At
  risk, On time, Arrived, Tomorrow, Data issue.
- **Map footer** (26px): `line.hair` top, Micro-step 10.5 `text.muted`. Left
  is contextual (`Positions from ELD · newest 12s ago`, or
  `Clusters break apart above zoom 6 · problem markers never cluster`, or
  `Cluster count excludes the problem set`). Right is always
  `© Mapbox · OpenStreetMap`.
- **Selection is two-way**: marker click scrolls and rails the row; row click
  pans the map. **120ms**, and nothing else moves.
- `headingDegrees` is 0 on stationary vehicles — **do not rotate the marker
  when `speedMilesPerHour` is 0**.

### Map popup (`2b`)

288px wide, `surface.raised`, 1px `accent` border.

- Header: `1147 · M. Kowalczyk` in sans 700 15 tabular + status chip (20px).
- Body: `auto 1fr` grid, `gap: 5px 12px`, sans 400 12 — `Position`, `Speed`
  (`62 mph · heading W`), `Next stop`, `Appt` (with stop-local in parens),
  `Projected` (status-coloured, with the delta), `GPS age`.
- Actions: `Edit load` (primary, 30px) and `Call driver` (secondary, 30px).

**The popup repeats every fact the detail panel shows** — nothing critical is
hover-only.

**`Call driver` is hidden when the driver's phone field is empty**, rather
than rendering a dead button. Samsara returns no driver phone numbers for
this org; the field is filled in by dispatchers.

## 9.4 Detail panel (`2b`)

Sits **under the map** in the right column when a row is selected. Panel
header 34px: `Truck 1147 — load VL-884213` in cond 600 12 `.1em`, with `Edit`
(primary, 26px) and `History` (secondary, 26px) on the right.

Body: two columns, `gap: 0 22px`, `padding: 14px`, `align-content: start`.
Each group has a Micro heading with a `line.soft` underline, then an
`auto 1fr` grid at `gap: 6px 12px`, sans 400 12, labels in `text.muted`.

**Schedule** — `Appointment` · `Stop-local` (naming the IANA zone) ·
`Projected` (status-coloured) · `Delta` (status-coloured, `+2h 35m`) ·
`Miles out`.
*The `HOS drive left` row is deleted (correction 1).*

**Load & contacts** — `Driver cell` · `Dispatcher` ·
`Last note` (timestamped, `text.secondary`).

## 9.5 Status override (`4c`)

Replaces the `3a` override block.

**Segmented control** — `Auto` · `Force late` · `Arrived` · `No appt`.
36px tall, `padding: 0 13px`, cond 600 11.5/1 `.08em` uppercase, 1px
`line.hair` dividers. Active segment is `accent` fill with `text.inverse`
ink; `Auto` at rest sits on `surface.overlay` in `text.muted`.

**Computed-status strip** — `surface.raised` ground, `line.hair` border,
`padding: 9px 11px`: an info icon + `Computed status, currently overridden`
in Small/`text.muted` on the left, the live computed chip on the right. The
engine keeps computing the real status the whole time.

**Reason — required.** A select, label carries `· required` in
`status.late.fg`. Options, in order:

| Label | Enum |
|---|---|
| Receiver confirmed detention | `RECEIVER_CONFIRMED_DETENTION` |
| Appointment rescheduled by broker | `APPT_RESCHEDULED_BY_BROKER` |
| ELD position wrong or missing | `ELD_POSITION_WRONG` |
| Driver reported delay by phone | `DRIVER_REPORTED_DELAY` |
| Other — note required | `OTHER` |

Free-text note behind `Other`, so overrides are **countable in review rather
than just readable**. **Save stays disabled until a reason is picked** — the
same disabled-Save rule as field errors.

**Expiry.** Two fields side by side: `Expires` (select) and `At` (derived,
read-only, tabular, `text.mutedOnSelected`-weight ink). Below them a row of
26px preset chips.

> **Correction 4:** the default is **`+4h`**, not "End of dispatch day".
> End of day set just after midnight is ~20 hours and defeats the purpose.
> Preset order: **`+4h` (default, selected)** · `End of day` · `Until appt` ·
> `Custom`. The selected chip is `surface.overlay` with an `accent` border.

**There is no `never` option.** `expires_at` is mandatory. Expiry is
evaluated **on read**, not by a scheduled job: at expiry the row **silently**
returns to its computed status and the override moves into history — **no
toast**, because nothing was decided by a person at that moment.

### Forced status on the row

A forced chip **keeps the status colour**, **swaps the status icon for the
override glyph**, and **appends ` · forced`** → `Late · forced`.

The list still sorts and reads by urgency, while a reviewer can see at a
glance which reds are decisions rather than measurements. **The chip is the
only place the row changes** — the stripe and the sort are untouched.

### Detail-panel override block

1px `#6b5224` border (risk border), `surface.base` ground, `padding: 14px`.

Header: warning glyph + `Status forced by a dispatcher` in cond 600 12 `.11em`
`status.risk.fg`, with a `Clear now` button (22px, `line.hair` border) on the
right.

Rows, `auto 1fr` at `gap: 7px 14px`, sans 400 12.5:

| Label | Example | Ink |
|---|---|---|
| `Showing` | `Late — forced` | `status.late.fg` |
| `Computed` | `At risk — ETA 14:22 CDT, 8 min of slack` | `status.risk.fg` |
| `Reason` | `Receiver confirmed detention` | `text.DEFAULT` |
| `Set by` | `A. Kruk · Mon 03:48 CDT (24m ago)` | `text.DEFAULT`, relative part in `#949ca4` |
| `Expires` | `Mon 23:59 CDT (in 19h 47m)` | `text.DEFAULT`, relative part in `#949ca4`, tabular |

**Showing and Computed sit adjacent and both carry their own status colour**,
so the dispatcher can see exactly what they are hiding. The API must return
both plus the override metadata. **When the two agree, the block collapses to
a single line saying so.**

## 9.6 Search (`2d`)

- **Debounced 250ms**, across truck number, driver, load number, city, state,
  destination.
- Filters **list and map together**.
- **Never re-sorts — it only removes rows**, so positions stay where the
  dispatcher's muscle memory left them.
- URL reflects search and filters, so a dispatcher can send a colleague a link.
- Active field: `accent` border + 2px `accent` outline at offset 1, typed text
  in sans 500 13 `text.DEFAULT`, a 1px `accent` caret, an `N of M` count in
  `text.muted` tabular, and an 18px `×` clear button.
- **Result banner** (32px, `#1a2027`): `Matching "kan" in truck no., driver,
  position and next stop — 3 results` then `· map filtered to matches · Esc
  clears` in Small/`text.muted`, with `Esc` in `accent`.
- **Match highlight**: `background: #3d4a57`, ink `text.DEFAULT`. **A steel
  plate, not a yellow one — yellow is spoken for by At risk.**
- **US state names map to abbreviations in both directions** (§12.7), so
  `kansas` and `KS` both match `Wichita, KS`. This is what makes `2d`'s
  otherwise-impossible `KS` highlight on the query `kan` correct.
- Driver names match on **surname only** — as does the modal's driver picker.

## 9.7 Empty state — no results (`2e`)

Centred in the list body, `gap: 10px`: icon, then a Display-step headline
(cond 600 17/1.1 `.06em` uppercase) `No truck matches "petrov 42"`, then a
420px-max explanation in sans 400 12.5/1.5 `text.secondary` naming the actual
rule — `Driver names match on surname only, and truck numbers are four
digits. Try petrov or 1203.` — then `Clear search` (primary 34px).

**`Search all loads` is cut** — there is nothing behind it (§12.15).

The column header stays visible above it.

### Other empty states — build these in v1 (§12.14)

Same centred construction: icon, Display-step headline, a 420px-max
explanation that names the actual cause and the next action.

| Case | Headline | Body |
|---|---|---|
| **Zero active trucks** | `No active trucks` | Explains that `active` is set by position recency on seed and flipped by hand, and points at the `Inactive` chip. Action: `Show inactive trucks`. |
| **Truck with no load** | `No load assigned` | In the detail panel. Status reads `No appt`. Action: `Add load`. |
| **Nothing selected** | `Select a truck` | In the detail panel at rest. One line — `Pick a row, or click a marker.` No action button. |

## 9.8 Offline / sync failed (`2e`)

> Built in §12.53, two phases after §5.9's withdrawal it explains.

A **38px banner** below the header: `status.late.bg` ground,
`status.late.bd` border, warning icon, then in sans 500 12.5
`status.late.fg`:

> `Position feed unreachable since 06:41 CDT. Everything below is 9 minutes
> stale — do not quote an ETA from this screen.`

with `9 minutes stale` underlined at `text-underline-offset: 3px`. On the
right: a `Retry now` button (26px, 1px `status.late.fg` border, same ink) and
`auto-retry in 14s` in sans 400 11.5 `#d79b91`, tabular.

Then the fleet-wide stale treatment from §5.9.

## 9.9 Edit modal (`3a`)

720px wide, `surface.overlay` ground, 1px `rgb(255 255 255 / .18)` border,
`box-shadow: 0 16px 48px rgba(0,0,0,.55)`, over a `rgba(9,11,13,.62)` scrim.

**Title bar** — `Edit stop — truck 1147` in cond 600 17/1.1 `.06em`
uppercase, subtitle `Load VL-884213 · M. Kowalczyk` in Small/`text.muted`,
and an `Esc close` keycap hint on the right.

**Dirty banner** — `status.risk.bg` ground, `status.risk.bd` border,
`padding: 8px 16px`: `Unsaved changes — appointment time, assigned driver and
note.` Names the actual dirty fields.

Sections are separated by a Micro heading with a `line.soft` underline.

### Assignment

Grid `110px 1fr 150px` at `gap: 12px`. Header row carries
`Driver change requires confirm` on the right.

- `Truck no.` — read-only, sans 700 14, tabular
- `Assigned driver` — searchable select, open by default when focused
- ~~`Trailer`~~ — **cut (§12.53)**. No data model ever carried the column, and the slot is now §12.14's `Active` checkbox.

**Driver picker** (correction 1 — no HOS): `surface.raised` panel, `line.hair`
border. Each option shows the driver's name and **current truck assignment
only**, plus the status chip of the truck they are currently on:

```
R. Nowak — currently on truck 1088          [On time]
A. Nowakowski — unassigned
P. Nowacki — inactive                        unavailable
```

Availability comes from the `drivers.active` flag. *Deleted: `HOS 11h 00m`,
`off duty until Tue 06:00`.*

Below: `Current assignment: M. Kowalczyk since Mon 02:10 CDT. Type a surname
to search all N drivers.`

Also in this group: an **`Active` checkbox** bound to `trucks.active`
(§12.14), with helper text `Inactive trucks are hidden from the console and
counted under the Inactive chip.` This is the only place the flag is
editable — there is no admin screen.

### Appointment — as written on the rate confirmation

Grid `1fr 1fr 1fr`.

Above the grid, a two-segment **`APPT` / `FCFS`** toggle (§12.2), same
36px segmented-control chrome as the override block.

- `Date (stop-local)` — tabular
- `Time at the stop` — **this is the primary field.** The abbreviation is
  **locked to the facility** and shown as a badge inside the input
  (`surface.overlay`, `line.hair`, cond 600 11 `.09em`). A rate con reading
  14:30 gets typed as 14:30.
- `Window` — `±30 min`. **Hidden when the stop is `FCFS`** — an FCFS time is
  a facility cutoff, not a slot, so there is no window to set and
  `appointment_end_utc` stays null. The field label becomes
  `Cutoff at the facility`.

Below, read-only derived line: `Your clock (read-only): Mon 16 Sep, 14:30 CDT
· 21:30 CET` — both console clocks, `text.secondary`, tabular.

**Never accept a UTC instant for an appointment from the client.** The server
takes stop-local wall time + IANA zone and converts.

### Stop & load

Grid `1.6fr 1fr 1fr`.

- `Facility`
- `Dock / door` — helper text `Free text — as the broker wrote it`.
  **No door-list validation** (`2c`'s door-list check is removed, not moved).
- `Load number · required` — **non-empty and trimmed, nothing more.** No
  format validation. The field-error pattern demonstrates on the empty case:
  1px `status.late.fg` border, inline icon, and a one-line rule beneath —
  `Load number can't be empty. Any format the broker uses.`

### Status override & note

The `4c` block (§9.5), then `Dispatcher note · visible to the next shift` —
a 56px textarea, sans 400 13/1.5.

### Footer

`surface.raised` ground, `line.hair` top, `padding: 12px 16px`. Left carries
the consequence line when the driver changed: warning glyph + `Reassigns
truck 1147 from M. Kowalczyk to R. Nowak.` in sans 500 11.5
`status.risk.fg`. Right: `Cancel` (secondary 40px) and the primary 40px
button, whose label becomes **`Confirm reassign & save`** when the assignment
is dirty.

### Rules

- **Save disabled** while any field is invalid or an override lacks a reason.
  `opacity: .45`.
- Errors are **field-level** — under their own field, never a summary banner.
- `Esc` raises the **discard confirm**, not a silent close.
- `Cmd/Ctrl` + `Enter` saves.
- Focus trap; dirty-state guard.
- Zod schema shared client and server; **the server re-validates everything.**
- Optimistic update with rollback.
- **Nothing is sent to any driver.** No SMS, no notification of any kind.
- **Roles** (§12.14): a `viewer` sees every Edit, Save, `Clear now` and
  `Reassign` control **disabled with a tooltip naming the reason** — never
  hidden. Hidden controls make people think the app is broken. `dispatcher`
  and `admin` both get the full modal; only `admin` may flip `trucks.active`.
  The role is checked **server-side on every mutating route** regardless of
  what the UI showed.

## 9.10 Reassignment confirm (`4a`)

Triggered when the assigned driver changed. 620px modal, same chrome as the
edit modal, title `Confirm reassignment — two trucks affected` in cond 600
17/1.1.

**Both sides stated**, side by side in a 1px `line.hair` box, `1fr 1fr`, the
losing side on a `#1f2328` ground:

| Gaining truck | Losing truck |
|---|---|
| `1147` + `gains a driver` (Micro, `text.muted`) | `1088` + `loses its driver` (Micro, `#b3bac0`) |
| `From` — old driver, **struck through** | `Was` — old driver, **struck through** |
| `To` — new driver | `Becomes` — `Unassigned` in `#b3bac0` |
| `Next appt` — tabular | `Next appt` — tabular |
| `Status` — `Late — unchanged by this move` | `Status` — `On time → Unassigned` |

Then a sans 500 13/1.6 summary naming the consequence in plain words, with
the losing truck's exposure called out:

> `Reassigns 1147 from M. Kowalczyk to R. Nowak. Truck 1088 will have no
> driver and keeps a live appointment at 22:00 CDT, 17h 48m from now.`

Then a Small/`text.muted` note:

> `M. Kowalczyk becomes unassigned too and appears in the driver picker as
> available. Nothing is sent to either driver — notifications aren't built.`

Footer: `Reversible from truck 1088's history for the rest of the shift.` on
the left; `Cancel` and `Reassign both trucks` (primary) on the right.

### Behaviour

- **One DB transaction, one audit entry.** Gaining truck gets a new
  `assignments` row; the losing truck's assignment closes with an end
  timestamp. **Never a window where one truck holds the driver and the other
  still claims them.**
- **The dialog renders both sides from the server's own preview of the
  change**, not the client's guess.
- Reversible from the losing truck's history for the rest of the shift.

## 9.11 Feedback set (`2h`)

### Toasts

Bottom-left, **6s**, stack of **3 max**. `surface.overlay` ground, 1px
`line.hair` on three sides, **3px status-coloured left border**. Icon +
message in sans 500 12.5 `text.DEFAULT` + an action word in cond 600 11
`.08em` `accent`.

```
[green] Truck 1147 appointment moved to 16:00 CDT            Undo
[red]   Save failed — 1203 was edited by J. Weber 4s ago     Review
[amber] 1246 slipped to At risk — 13 min of slack left       Open
```

Status-change toasts are **opt-in per chip** and **never steal focus**. *A
toast is an echo, not the notification — the row and the marker have already
changed.*

### Skeleton

First load, 6 rows then real data. Two-tone static blocks: `#252a30` for
primary cells, `#1f2429` for secondary, stripe `rgb(255 255 255 / .07)`.
Heights 11–12px, widths vary per row so it doesn't read as a grid.
**No shimmer** — under reduced-motion nothing changes, because nothing moved.

**Built on the real 8-column grid**, not `2h`'s drawing. `2h` omits Next stop
and Status and uses the pre-correction Appt/Status widths; it is wrong
(§12.11). Use the §4.1 grid so the skeleton and the loaded row don't shift.

### Error boundary — panel-level, never whole-screen

1px `status.late.bd` border, `surface.base` ground, `padding: 20px`, blueprint
corner ticks in `rgba(255,138,122,.6)`.

Headline: icon + `Map failed to load` in cond 600 17/1.1 `.05em` uppercase.
Body in sans 400 12.5/1.55 `text.secondary`, and it must say **what still
works** and carry a **reference code**:

> `The truck list is unaffected and still live. Positions are shown as text in
> each row. Reference MAP-503 · 04:11:38 CDT when you call IT.`

Reference code in `ui-monospace` 11.5 `text.DEFAULT`. Actions: `Reload map`
(primary 36px) and `Copy error detail` (secondary 36px).

### Controls

40px tall, `padding: 0 15px`, cond 600 12.5/1 `.08em` uppercase, square.

| State | Treatment |
|---|---|
| Primary | `accent` fill, `text.inverse` ink |
| Hover | `accent.hover` `#b5d3ef` |
| Pressed | `accent.press` `#749dc4` |
| Focus | `accent` fill + `2px #e9ebed` outline at offset 2 |
| Disabled | `opacity: .45` |
| Saving | Secondary chrome + a 12px spinner (2px `rgba(233,235,237,.3)` ring, `#e9ebed` top) |
| Secondary | transparent fill, 1px `rgb(255 255 255 / .16)` border, `text.DEFAULT` ink |

Other observed heights: 46px (login), 36px (error boundary, segmented
control), 34px (empty state, search field), 30px (popup), 26px (panel header,
expiry presets), 22px (`Clear now`, sort segment).

## 9.12 Login (`3f`)

`surface.sunken` page ground with a 64px blueprint grid at
`rgba(148,188,227,.06)`. Card **420px**, `surface.base`, 1px
`rgb(255 255 255 / .14)`, `padding: 34px 32px`, blueprint corner ticks.

- `mark-knockout.svg` at **54px** tall, 22px bottom margin
- `Fleet Tracker` in Display (cond 600 22/1.1, `.05em`, uppercase)
- `Dispatch console. Authorised users only.` in sans 400 12.5/1.5
  `text.secondary`
- `Work email` and `Password` — **44px** inputs, `surface.sunken` fill, 1px
  `rgb(255 255 255 / .16)`, sans 500 13.5. Password has a reveal toggle.
- `Keep me signed in` checkbox (15px square) and a `Reset password` link in
  `accent`
- `Sign in` — 46px, `accent` fill, cond 600 13/1 `.1em`
- `Continue with Google Workspace` — 46px secondary
- Footer strip above a `line.soft` rule: `Vin Logistics Inc · dispatch` and
  `v0.1 · build YYYY.MM.DD` in Micro-step 10.5 `text.muted`, tabular

**The cyan appears in exactly two places in the whole product — the mark
itself and this login card.** Everywhere else the interactive colour is steel
`#94bce3`.

## 9.13 Phone (`2f`) — 390 × 844

**Full parity, not a cut-down.** Two stacks.

**List stack** — rows `44px / 52px / 40px / 1fr / 56px`:

- Header 44px: mark at 22px + `Fleet` (cond 600 12 `.12em`) on the left; sync
  dot + `12s · 04:12 CDT` on the right.
- Search 40px, full width, `padding: 0 14px`.
- Filter chips 30px, horizontally scrolling: `All` · `Late` · `Risk` ·
  `Issues` (abbreviated labels).
- Rows as §4.4.
- Bottom tab bar 56px, `surface.raised`, two tabs: `List` (active,
  `text.DEFAULT`) and `Map` (`text.muted`).

**Detail stack** — rows `44px / 1fr / 64px`:

- Header 44px: back chevron, `1147` (sans 700 16, tabular), driver name,
  status chip pushed right.
- 190px map strip, `surface.sunken`, 48px blueprint grid.
- Alert strip: `status.late.bg` / `.bd` box with
  `2h 35m late · ETA 17:05 CDT`.
- `Schedule` group, sans 400 13, `gap: 7px 12px`: `Appt` · `Stop-local` ·
  `Projected` · `Next stop` · `Position` · `GPS age`.
  *The `HOS left` row is deleted (correction 1).*
- `Last note` group, sans 400 13/1.5 `text.secondary`.
- Action bar 64px, `1fr 1fr` at `gap: 10px`: `Call driver` (primary 44px) and
  `Edit stop` (secondary 44px). **`Call driver` is hidden when the phone field
  is empty.**

---

# 10. Assets (`3f`)

Build against placeholders. Keep every reference in **one file** so swapping
them is a one-file change — only the `img src` values move, **no layout
moves**.

| File | Spec |
|---|---|
| `mark-knockout.svg` | Full lockup, single colour `#ffffff`, text converted to outlines, no embedded raster, no clip-paths. Tight viewBox with 2px optical padding. **Must stay legible at 24px tall.** |
| `mark-navy.svg` | Same geometry in `#0d2b6b`, for the light theme and print |
| `monogram.svg` | Mark element only, no wordmark, square viewBox. Favicon and avatar fall back to this. |
| `favicon.svg` | Monogram, square, drawn for 16px: one weight, no hairlines under 2px at that size |
| `favicon.ico` | 16 · 32 · 48px, for older browsers |
| `apple-touch-icon.png` | 180 × 180, opaque `#15181b` ground, monogram at 60% of the box |
| `icon-192.png` / `icon-512.png` | PWA set, opaque ground |
| `icon-maskable-512.png` | 512 × 512, monogram inside the centre 80% safe zone |

In-product sizes: header **30px** tall, login **54px** tall, favicon **32 and
16px** (monogram only — the wordmark is illegible at that size).

---

# 11. Non-negotiables restated

Carried from `CLAUDE.md` and `PROJECT_BRIEF.md` because they constrain what is
built here:

- **No hex in a component.** Semantic status out of the engine, token in the
  config, class in the component.
- **Browsers never call Samsara.** One worker polls; every client reads our DB.
- All instants stored UTC with a separate IANA zone string. Appointments are
  entered as stop-local wall time and converted server-side.
- Timezone abbreviations via `Intl.DateTimeFormat` at render time. Never
  stored, never concatenated, never hardcoded.
- Position strings come from Samsara's `gps.reverseGeo.formattedLocation`
  (shape: `"Maple Road, New Lenox, IL, 60451"`). **No geocoding service, no
  cache, no debounce layer.** The Position column renders city and state; the
  detail panel and tooltip get the full string.
- Never built: SMS or any driver notification · dock/door validation against a
  facility door list · load-number format validation · anything HOS-derived ·
  any external geocoding service.

---

# 12. Rulings

Decisions taken **2026-09-17**, after the phase-0 extraction. **These carry
brief-level authority and supersede both the design document and
`PROJECT_BRIEF.md` where they conflict.** Numbering follows the order the
questions were raised.

Sections 1–11 above have already been amended to match; each amendment points
back here.

## 12.1 Deadline, LATE and AT_RISK

The brief stacked a 30-minute grace on top of a ±30 window — 90 minutes of
slack measured from the start time. **The window *is* the grace.**

```ts
deadline = appointment_end_utc ?? appointment_start_utc
LATE     = projectedEta >  deadline
AT_RISK  = projectedEta >  deadline - 45min    // and not already LATE
```

No extra grace anywhere. A 14:00–15:00 window is late at **15:01**, which is
what a receiver means by it.

- `lateThresholdMinutes` is **retired** from the config object.
- `riskBufferMinutes` stays at **45**.
- "The appointment has passed with no arrival" needs no separate clause — a
  projected ETA past the deadline already produces `LATE`.

Supersedes the At-risk / Late rules in `1a` and in `PROJECT_BRIEF.md`.

## 12.2 FCFS is real, and gets a control

`appointment_type (FCFS|APPT)` stays in the schema. First-come-first-served is
how a large share of loads actually work.

- An **FCFS stop's time is a facility cutoff, not an appointment.**
- FCFS stops **can reach `LATE`** against that cutoff.
- FCFS stops **never reach `AT_RISK`.** There is no slot to miss, only doors
  that close.
- The modal's appointment group gets an **`APPT` / `FCFS` toggle**. Choosing
  FCFS **hides the `±` window control**, so `appointment_end_utc` stays null
  and the deadline coalesces to `appointment_start_utc`.

See §9.9.

## 12.3 Two stale thresholds, two numbers

| Key | Value | Scope |
|---|---|---|
| `feedStaleMinutes` | **5** | Fleet-wide. Poll is 30s, so ten missed cycles means the feed is down. Triggers `feedStale: true` and the §5.9 colour withdrawal. |
| `staleMinutes` | **45** | Per-truck. Drives the `STALE_GPS` status. |

**The trap:** verified Samsara data shows gateways report on ignition, so a
legitimately parked truck goes quiet for hours. **Only evaluate `STALE_GPS`
for a truck that has a live appointment.** A parked truck with no load
resolves to `NO_APPT` and never to `STALE_GPS`.

This makes `STALE_GPS`, `UNASSIGNED` (already gated on a live appointment) and
`NO_APPT` mutually exclusive by construction.

## 12.4 Sort stability — the list does not re-sort on refresh

Secondary sort within an urgency band: **appointment time ascending, nulls
last.**

The deeper rule: **sort order is computed on load, on filter change, and on
explicit user action only.** Status colours, ETAs and positions update **in
place**. Rows never move under a click.

When the computed order has drifted from the displayed order, a pill appears
at the top of the scroller — `N rows would reorder` — and clicking it
re-sorts. This also resolves the `2h` toast case: `1246 slipped to At risk`
recolours the row and the marker without moving anything.

See §5.6 and §9.2.

## 12.5 Problem set

```
problem set = LATE · STALE_GPS · UNASSIGNED · AT_RISK · NO_APPT
```

`ARRIVED`, `ON_TIME` and `TOMORROW` are **not** problems.

- **Footer bar** counts the problem set — that is what `0 problems below the
  fold` means.
- **Clustering**: the problem set **never clusters**. Everything else does,
  **Arrived included.**

This corrects `3d`'s caption, which said cluster counts were on-time and
tomorrow only and left Arrived unaccounted for.

## 12.6 Clustering zoom rule is backwards in the document

`3c`'s map footer reads `Clusters break below zoom 6`. Clusters break apart as
you zoom **in**, so the correct rule is **no clustering above zoom 6**.

Written into §9.3. **Confirm the exact zoom against real `dark-v11` tiles
before locking it** — 6 was chosen against a placeholder.

## 12.7 Search maps US state names to abbreviations

Both directions: `kansas` and `KS` both match `Wichita, KS`.

This is deliberate and is what makes `2d`'s otherwise-impossible `KS`
highlight on the query `kan` correct.

Driver names still match on **surname only**, in search and in the modal's
driver picker.

## 12.8 Filter chip counts are fleet-wide

Not search-scoped. With a search narrowing the list to 3 of 20, every chip
still reads its full-fleet count. **They show what you would get if you
cleared the search**, which is the point of leaving them visible.

## 12.9 Filter chips are multi-select

Each toggles independently. `0` resets to All.

## 12.10 `Enter` opens the edit modal

Selection already shows the detail panel, so binding `Enter` to "open detail"
was redundant. `Enter` and `E` both open edit.

Fixed in §8.1.

## 12.11 Format fixes

| Thing | Ruling |
|---|---|
| Arrived ETA cell | `In 10:58` becomes **`Arr 10:58`**, and it means `arrived_at`. |
| Stale chip | **One format everywhere: `2h 40m`.** No `GPS` prefix — the icon carries that. The `1a` reference chip's `GPS 2h 40m` is wrong. |
| Weekday prefix | Appears whenever the appointment is **not today in dispatch-local time** — `Tue 06:30 CDT`. Not tied to the `TOMORROW` status. |
| `2h` skeleton | **Wrong.** Drawn on 6 columns at pre-correction widths. Rebuild on the real §4.1 8-column grid so the skeleton and the loaded row don't shift. |

## 12.12 Detail panel below 1086px

Becomes a **full-screen sheet over the list**, dismissed by `Esc` or a back
control. It does not try to live under a collapsed map.

Resolves the undefined-height problem: at `< 1086` the map is a toggle, so
there is no map to sit beneath.

## 12.13 Next stop, and trucks holding two loads

**Next stop = the lowest `stops.sequence` with no `departed_at`.**

A truck holding two loads takes the **earliest deadline across both**, and the
row shows the load number so it is clear which one is driving the status.

### The two halves are not one rule (2026-09-22)

For six months the query was `order by appointment_start_utc asc nulls last,
sequence asc` — one flat sort over every open stop the truck holds. That
implements the second sentence and quietly breaks the first, because a sort by
appointment can reorder a single load's own legs.

Truck 124 is the case. One load, `12120569`:

| seq | stop | appointment |
|---|---|---|
| 1 | Joliet, IL | 2026-09-22 05:01 |
| 2 | Fargo, ND | 2026-09-20 23:30 |

The delivery is dated two days before the pickup, so Fargo won. The board
named Fargo as the next stop, the ETA was computed to Fargo, the map line drew
to Fargo, and the arrival sweep — which takes **one** candidate per truck —
watched Fargo, 700 miles away, while the truck worked Joliet. A Joliet arrival
was therefore **undetectable**, not merely late.

The worker demonstrated it on the restart. Six seconds after starting on the
fixed ordering:

```
17:08:38  worker starting
17:08:44  arrival detected  truck 124  arrivedAt 2026-09-22T17:02:20.206Z
```

The truck had reached Joliet at 17:02:20. The previous worker ran for four
hours over that period and never once named 124 as its nearest candidate,
because its candidate was Fargo.

The dates are bad data; a delivery appointment before its pickup is a typo.
But nothing prevents the typo, and the right answer under it is unchanged:
**stop 1 first.** An ordering that only works when the appointments are right
is not an ordering.

`NEXT_STOP_ORDER` in `src/server/next-stop.ts` is now the single definition,
used by all four queries that ask the question — the console row, the reassign
preview, the routing sweep and the arrival sweep. It ranks each **load** by
the earliest deadline it still has (a window `min` over the rows surviving the
`WHERE`, so a departed leg stops speaking for its load), then keeps that
load's legs in `sequence`. A tie is broken on `l.created_at, l.id`: without a
total order two loads' stops can interleave, which is the same failure again.

On the live fleet the change moves exactly one truck of nineteen — 124, from
Fargo back to Joliet.

## 12.14 Built in v1

Three things the design never drew that ship anyway.

### `Inactive` filter chip

**Forced by the Samsara data.** The stats feed returns every vehicle ever
registered — one response held fixes from seconds old to seven months old, and
trucks decommissioned since 2019 are still in it. `trucks.active` is **ours**,
seeded from position recency (a fix within 24h = active).

Without a way to see and flip inactive trucks, **seeding is a dead end**.

A chip plus a checkbox in the edit modal is enough. **No separate admin
screen.** See §9.1 and §9.9.

### Role treatment

A `viewer` sees every Edit, Save, `Clear now` and `Reassign` control
**disabled with a tooltip naming the reason — never hidden.** Hidden controls
make people think the app is broken.

`dispatcher` and `admin` both get the full modal; only `admin` may flip
`trucks.active`. The role is checked **server-side on every mutating route**
regardless of what the UI showed.

### Three more empty states

Zero active trucks · truck with no load · nothing selected in the detail
panel. Cheap, and all three will certainly occur. Specified in §9.7.

## 12.15 Deferred to v2

Recorded as **deferred, not missing** — each is referenced by the design but
deliberately out of v1 scope.

| Surface | Referenced by |
|---|---|
| **History** | `History` button in the `2b` detail panel; `4a`'s "reversible from truck 1088's history for the rest of the shift" |
| ~~**Toast preferences**~~ | **Superseded by §12.50** — the event set was narrowed until a preference had nothing to do. Not deferred; resolved. |
| **Audit log view** | `audit_log` is written on every edit; nothing reads it back |
| **Override review** | `4c`'s "reviewable at the end of a week"; `4c`'s own follow-up list offers the screen as unbuilt |

**`Search all loads` is cut outright** — there is nothing behind it. Removed
from the `2e` empty state (§9.7).

Until History ships, the `History` button in the detail panel and the
"reversible from history" line in the `4a` confirm dialog have nothing to open.
**Both need hiding, or the reassignment confirm will promise a reversal path
that does not exist.**

## 12.16 Light theme is deferred

Dark is what gets signed off. `2g`'s remap is **specified but unbuilt** and is
**incomplete** — no values for `line.*`, `row.*`, `text.mutedOnSelected`,
`status.neutral`, `status.tomorrow` or any status `bg`/`bd`, and no measured
ratios at all.

Marked as such in §1.2 so nobody half-implements it.

## 12.17 Narrow list: six columns, not eight

Resolves the §13.3 contradiction. The console row's non-flexible width is
**693px** against a **560px** list minimum, so the eight-column row cannot
fit in the narrow band.

**Below 900px of list width the row drops to six columns.** Cut **Position**
and **ETA**:

- **Position** is the least load-bearing column — the detail panel and the
  map marker both carry it.
- **ETA** is derived, not entered. It is the one number a dispatcher can
  reconstruct from Appt and Status.

| Kept | Cut |
|---|---|
| status rail (3px), Truck, Driver, Next stop, Appt, Status | Position, ETA |

**Do not shrink type or padding to fit eight.** A dispatcher at 4am reading a
9px row is the exact failure this design was built to avoid. The row keeps
its 44px height and the §2 type scale at every width.

### Where this actually bites

Only in the narrow band where the map and list are **both** visible. Below
**1086px** the map collapses entirely and the list gets the full window,
which is wider than 900px on any real screen — so the six-column row is a
band, not an endpoint.

### Arithmetic

```
non-flexible, 8 columns:  3 + 72 + 148 + 128 + 100 + 128 + (7 × 14) + 16 = 693
non-flexible, 6 columns:  3 + 72 + 148 + 128       + 128 + (5 × 14) + 16 = 565
```

At a 900px list that leaves **335px** for Next stop, against 191px at the
reference width — the one remaining flexible column gets more room, not
less, which is why cutting two columns reads as calmer rather than denser.

This supersedes the `1b` two-line row as the narrow-list answer. `1b` remains
the layout below 1024px viewport width, where the row goes two-line anyway.

## 12.18 `Unassigned` is said once, by the chip

**Supersedes the first clause of §5.8.** Truck 137 rendered `Unassigned` in
the Driver column AND an `Unassigned` status chip — the same word twice in a
44px row, 128px apart.

**The chip is the carrier.** The Driver cell shows the driver-slash icon and
an em dash; the word appears only in the chip.

Why that way round:

- The chip is load-bearing in four places at once — the urgency sort key, the
  filter-chip count, the marker key, and the footer's below-the-fold tally.
  The Driver cell is load-bearing in none of them.
- A Driver column that reads as *blank* is faster to scan down 23 rows than
  one repeating a word. The absence is the signal.
- It generalises. Once the real engine lands, a driverless truck with no live
  appointment is `NO_APPT`, not `UNASSIGNED` — that row still needs the
  Driver cell to say "no driver" without a status word to borrow. Making the
  chip the sole carrier is a rule that holds for both, rather than a special
  case for one status.

The rest of §5.8 stands unchanged: the schedule chip is replaced rather than
accompanied, the last computed ETA moves to the ETA cell struck through, and
the row keeps its marginally sunken ground.

## 12.19 The status placeholder, and what killed half of it

`lib/placeholder-fleet.ts` fabricated a status AND a driver name for phase 3.

**The driver half died in phase 4.** Drivers are real `assignments` rows now,
entered on the bulk assignment screen; Samsara returns `data: null` for
driver-vehicle assignments in this org, so there was never anything to sync.

**The status half dies in phase 5**, replaced by the engine in
`lib/status.ts`. Until then it is guarded rather than trusted:
`placeholder-guard.test.ts` asserts exactly one non-test importer
(`server/fleet.ts`, the seam the engine replaces), asserts no fabricated field
beyond status, and — deliberately — **fails when the module is deleted**,
naming itself as the next thing to remove. A guard that quietly passes over a
module that no longer exists reads as protection nobody is getting.


## 12.20 The stop field set

**Supersedes §9.9's "Stop & load" grid.** A stop is:

> street address · city · state · ZIP · stop type · load number · load status
> · dispatcher note

Three fields are **gone, columns included** — `stops.facility_name`,
`stops.dock_door`, `loads.broker`. Not hidden from the form: dropped, because
a column nothing writes is a column someone eventually reads and believes.

`address_line` and `zip` existed in the schema from phase 1 and had never been
surfaced. They are what a dispatcher actually reads off a rate confirmation.

**Consequence for §6.2.** The truncation ladder began "Next stop drops its
dock/door detail (` · Dock 14`)". That rung no longer exists. The cell is now
`City, ST`, plus the load number when the truck holds more than one open load
(§12.13); the street address and ZIP live in the tooltip, where they do not
compete with the city for a 191px column.

## 12.21 Load numbers are permanently optional

**Supersedes the phase-3 ruling that required them. Do not reintroduce the
constraint.**

Brokers do not always supply a number when the load is entered. A dispatcher
who cannot save without one **types something** — and an invented load number
is worse than an empty one, because it looks real to the next shift and to
anyone reconciling against the broker, and nothing downstream can tell it from
a real number. A required field that people work around by typing junk has
made the data worse, not better.

Stored as `NULL`, never `''`: two ways to say "not known yet" is one too many.
The not-blank check constraint stays, now meaning *if present, it has to be
something*, and whitespace alone is not something.

**The rule lives in three places and all three must agree:**

| Where | What it says |
|---|---|
| `loads.load_number` | nullable column, `loads_number_not_blank` allows NULL |
| `LoadNumber` in `lib/stop-edit.ts` | the ONE schema the modal checks with and the route re-parses |
| The modal | no required marker, no field error, Save stays enabled |

That list exists because the first attempt at this ruling got two of the three
and looked done: the column was nullable and the modal said optional, while
the shared Zod schema kept `.min(1)` and refused the save at the boundary. Any
renderer must also print an absent number as words — `Load null` reached the
modal header the same way, because one of two renderers was updated.

Covered by `stop-edit.test.ts`, which asserts the schema, the stored value and
the round trip back through the fleet query rather than the state of a button.

### The last two layers (third fix, and the one that finished it)

Two things survived every previous pass, both invisible from the modal.

**1. `.nullable()` without `.optional()`.** An API client that omitted the key
got `400 Required`. The modal always sends it, so only a client ever hit it —
which is why three sessions of testing through the UI never saw it. Now four
distinct inputs, and they do not all mean the same thing:

```
"LD-4417"   set it
""          clear it — the modal's empty box
null        clear it — the same intent, said explicitly
omitted     LEAVE IT ALONE
```

Omitted deliberately is **not** null. Writing a column the caller never
mentioned is §12.23's broker wipe exactly. The server spreads the key in
conditionally rather than relying on drizzle skipping `undefined` in `set()` —
that is drizzle's behaviour to change, not a contract of ours — and the audit
row logs what was *written*, not what was sent.

**2. The optimistic cache held a shape the server cannot produce.** The modal
patched the fleet row from `edit`, its own form object, rather than from
`parsed.data`:

```
             form (edit)      server (parsed.data)
loadNumber   ""               null
state        "il"             "IL"
```

Both renderers of the load number use `??`, which does not catch `''`, so a
cleared number rendered as blank space instead of "no number yet" until the
refetch corrected it. The `state` mismatch was worse in a quieter way: the row
simply changed case under the dispatcher a second later.

> **The cache must never hold a shape the server cannot produce.**

The fix is the patch reading `parsed.data`, not `??` being loosened to `||`.
Loosening the renderer would have made both symptoms disappear while leaving
two representations of the same value in play — and every future reader of
that cache would have had to know which one it held. ESLint then flagged
`edit` as an unnecessary dependency of `send`, which is the fix confirming
itself: the raw form shape no longer leaves the component.

### The audit that found the rest

Checking every other field in that patch, as the third fix should have:

| field | `''` became | `'  x  '` became |
|---|---|---|
| `loadNumber` | `null` | `'x'` |
| `addressLine` | **`''`** | `'x'` |
| `city` | **`''`** | `'x'` |
| `zip` | **`''`** | `'x'` |
| `dispatcherNote` | **`''`** | `'x'` |

Only `loadNumber` had the `'' -> null` transform. The modal hid it — its own
`trimmed()` nulls a blank before validating — but an API client posting
`{"city": ""}` stored an empty string in a column the modal could only ever
have nulled. The same defect one layer out, breaking the same `??` renderers
for the same reason.

All four now share **one** definition, `blankIsNull(max)`, because four copies
is how layers drift apart in the first place. `state` needs none of it:
`.length(2)` rejects a blank outright.

`lib/stop-edit.test.ts` pins the whole contract, including a test that asserts
*no* free-text field can store an empty string — so the next field added to
this schema is caught by a test rather than by a fourth session.

## 12.22 FCFS carries receiving hours

**Supersedes §12.2's last bullet**, which said an FCFS stop hides the window
control and leaves `appointment_end_utc` null. That left an FCFS stop with no
time at all and therefore no way to be late — the opposite of the intent.

An FCFS stop carries **receiving hours**: an earliest and a latest, both
stop-local wall time in the same IANA zone, entered as integer parts and
converted server-side exactly like an appointment. New stops default to
**07:00–15:00**, editable per stop.

**The columns are reused, not added to:**

| `appointment_type` | `appointment_start_utc` | `appointment_end_utc` |
|---|---|---|
| `APPT` | the appointment | `start + window`, or null for an exact time |
| `FCFS` | earliest receiving hour | **latest — the deadline** |

Reuse because the next-stop lateral already orders by
`appointment_start_utc asc nulls last`, and the earliest receiving hour is
exactly the right sort key for an FCFS stop, so that query needs no branch.
Separate columns would put a `coalesce` or a `CASE` in the fleet query, the
reassignment preview, the audit payload and the seed — four places that must
agree, to store two instants measured identically by identical code.

The phase-1 constraint `stops_fcfs_has_no_window` is replaced by
`stops_fcfs_has_window` (an FCFS stop with a start must have an end) and
`stops_fcfs_window_positive` (hours of zero length are a typo, not a facility).

### What the status engine does with it (phase 5)

- **`LATE` is measured against projected arrival, not the clock.** A truck
  whose ETA is 16:30 against a 15:00 close reads `LATE` from the moment that
  ETA is computed — at 09:00, while a dispatcher can still phone the
  receiver. It does not wait for 15:00 to pass. Identical in kind to an APPT
  stop; only the deadline differs.
- **`AT_RISK` never applies to FCFS**, exactly as §12.2 said. With receiving
  hours there is a deadline to miss, but there is still no slot to be at risk
  of missing.
- **`ARRIVED` wins once `arrived_at` is set**, whether or not the truck made
  the window. Lateness is then history rather than a live problem, and the row
  stops competing for attention at the top of the list.

### Overnight receiving — rejected for now, deliberately

A window whose latest hour is at or before its earliest (`22:00–06:00`) is
**refused with a field error**. Reading `06:00` as tomorrow would make a
transposed typo look valid, and day-spanning logic belongs with the status
engine rather than ahead of it.

**This is a known gap, not a settled rule.** Overnight receiving is real —
grocery and retail DCs routinely take trucks through the night, and this fleet
runs to receivers that do. When a dispatcher hits it, the fix is an explicit
**next-day control** on the latest hour, not a rethink of the model.


## 12.23 An edit writes only the fields the form owns

A save updates the columns its form renders. **Never a full-row replace.**

The rule exists because of a measured failure: the phase-4 edit modal had no
broker field, and saving a stop set `loads.broker` to null — the column
existed, the form did not render it, and the write listed it anyway. It is
visible in the audit log as `broker: "BROKER DEMO" -> null`, which is the only
reason it was ever noticed.

The same shape as §12.21's survival: **a rule present in some layers and
absent from others.** Both were invisible until someone exercised the path.

Tested where it can actually go wrong: `override.test.ts` saves and clears an
override and asserts every appointment column on the stop is byte-identical
before and after. The override lives in its own table, so touching the stop at
all would be the bug. `stop-edit.test.ts` does the same across an
address-only edit.

### Derived columns are not an exception to this

`stops.lat` / `lng` / `geocode_precision` are not form fields, and the save
writes them (§12.24). That is the rule working, not a hole in it: they are
**derived from four fields the form does own**, in the same save, from the
same input. A derived column belongs to whatever it was derived from.

What the rule still forbids is touching them when their inputs did not change
— so an appointment-time edit leaves every coordinate column alone, and
spends no geocoding call either.

## 12.24 Coordinates, and what happens when there are none

**Superseded in part.** This section used to record a gap: `LATE` and
`AT_RISK` are defined against projected ETA (§12.1), the projection needs
`stops.lat` / `stops.lng`, and nothing populated them. Measured at the time:
44 stops, 44 with an address, 28 with coordinates — and all 28 from the seed.
Not one dispatcher-entered stop had any, so the board could not warn anyone
about a problem until it had already happened.

The gap is closed. A **one-time forward geocode on stop save** fills the
columns. What remains of the old section is the degradation, which still
applies whenever an address cannot be located.

### Why this is not the geocoder the brief bans

The brief bans external geocoding, and it is right about what it was aimed at:
**per-position reverse geocoding**, a call per truck per poll — roughly 86,000
a day — to recompute a string Samsara already hands us free in
`gps.reverseGeo.formattedLocation`.

This is the other direction and a different order of magnitude.

| | the banned thing | this |
|---|---|---|
| direction | reverse (coords → text) | forward (text → coords) |
| trigger | every position, every poll | a stop save whose address changed |
| volume | ~86,000/day | 20–40/day, cached |
| purpose | replaces data we already have | supplies data we have never had |

One call per distinct address, ever, because the cache is keyed on the
normalised address and the same DC is entered over and over.

### The provider: US Census Bureau, not a commercial geocoder

`https://geocoding.geo.census.gov/geocoder/locations/address`, structured
input, `benchmark=Public_AR_Current`.

Chosen over Mapbox because the fleet is US-only and every stop is a US street
address, so Census coverage fits the whole problem. It needs **no API key and
no card**, and it carries **no storage restriction** — which removes the
permanent-vs-temporary licensing question entirely rather than paying
$5/1,000 to resolve it, and removes a spend-cap risk on an account with no
hard cap.

Structured input — `street`, `city`, `state`, `zip` as separate parameters,
never one concatenated string. Concatenating them just to make the provider
re-split them is where "1804 North Washington Street" becomes a match on
"Washington".

**The coverage tradeoff is real.** TIGER is weaker than a commercial geocoder
on very new industrial addresses, which are exactly the addresses a freight
company visits. Measured on the first backfill: `1400 Laraway Road, New Lenox
IL` — a real road — returns zero matches. **The no-ETA fallback is what
absorbs this**, and it is why that fallback was built before the provider was.

### The cutoff, and why it checks components itself

Census returns **no confidence value of any kind** on this endpoint. The
`exact` / `non_exact` match type belongs to the *batch* CSV API, not to
`locations/address`, which returns only `addressMatches[]` with
`matchedAddress`, `coordinates`, `tigerLine.side` and the segment's house
number range. There is nothing to map, so the signal is derived here.

Worse, and the reason this section exists: **Census silently ignores
components that disagree.** Both measured against the live service:

```
street=1804 North Washington Street  city=Grand Forks  state=TX
  → 1804 N WASHINGTON ST, GRAND FORKS, ND, 58203      ← wrong state, answered anyway

street=200 Center Street  city=Chicago  state=IL
  → 200 CENTER ST, WEST CHICAGO, IL, 60185            ← a different city
```

Mapbox's `match_code` gave component agreement for free. Here it is checked
in `outcomeFor` or it is not checked at all, and an unchecked match is exactly
the confident wrong number the cutoff exists to refuse.

| Rule | |
|---|---|
| `state` must agree | hard requirement |
| `city` **or** `zip` must agree | not both — see below |
| a second match >1 mi away | ambiguous, refused |
| no matches | refused |

**City or ZIP, not both**, because legitimate disagreement happens in each
direction: `5500 E 56th Ave, Denver CO 80216` correctly matches ZIP `80022`
(the typed ZIP was wrong), and a `St. Paul` / `SAINT PAUL` spelling differs
while the ZIP holds. Both disagreeing is the West Chicago case.

Erring toward refusal is deliberate: **a refusal costs an ETA, an acceptance
costs a wrong ETA**, and only one of those sends a dispatcher somewhere.

### Precision is single-valued under this provider

| Tier | Meaning | Written today |
|---|---|---|
| `street` | interpolated along the matched TIGER segment from its house-number range | **always** |
| `city` | a locality centroid | never |

The tier was named `rooftop` under Mapbox. Census **never returns a parcel
point** — every match is a street-segment interpolation — so the value was
renamed rather than left claiming an accuracy the data cannot back.

`city` is **unreachable**: Census rejects city-only input with HTTP 400 rather
than degrading to a centroid. The value is kept for a provider that can do
coarse matches, and this table exists so nobody reads a single-valued column
as a live signal. Confidence stores what the signal actually was —
`census:in-range` or `census:zip-differs` — not a grade borrowed from a
provider we no longer use.

### Attribution

The Census Bureau API Terms of Service require, verbatim:

> "This product uses the Census Bureau Data API but is not endorsed or
> certified by the Census Bureau."

The geocoder's own API documentation states no terms at all, and that ToS page
addresses `api.census.gov` while the geocoder is a different host — so the
scope is arguably ambiguous. **It is displayed anyway**, beside the Mapbox
credit in the map chrome. It costs one line; omitting it is a bet. Phase 3
already shipped without a required attribution once.

### Multiple results

The runner-up veto **survived the provider swap, simplified**. Census returns
no confidence, so the old "equally confident runner-up" precondition became
vacuous; the rule is now distance alone. It was kept rather than deleted
because it still fires on real responses: `1 Broadway, New York` returns two
matches 0.1 mi apart — one street, two ZIP segments — which passes, while two
genuinely different places do not.

### The ETA is anchored to the position, not the clock

`projectEta` departs from `recordedAtUtc`, not from `now`.

`now + travelTime` looks equivalent and is not. It means a truck whose feed
froze forty minutes ago has an ETA that slides forward forever: every read
re-promises a vehicle that has not moved, and the board stays quietly
optimistic about the one truck nobody can see.

Anchoring makes the drift **impossible rather than policed**. The ETA is a
pure function of (position, stop coordinates, config), so it cannot disagree
with its position — it *is* its position, moved forward by the distance left.
It changes when a fix lands and at no other time. And because `now` is not an
input, two renders a second apart produce the same string, which closes the
hydration-mismatch class at the source rather than patching it at the seam.

A frozen truck's ETA therefore sits in the past. That is the honest answer,
and `STALE_GPS` is already saying so.

### Miles

The distance is computed to produce the time, so showing it is a render
change, not new logic.

- **Popup**: `412 mi · ETA 14:18 CDT`, on the line under Next stop, where a
  dispatcher is already looking when they ask "can he still make it?"
- **Row**: the time alone — the column is 128px and already tight. Miles go
  in the tooltip.
- Rounded whole. `412 mi`, never `411.7 mi`: a straight line times a fudge
  factor does not have a decimal place in it. Under ten miles it reads
  `arriving`, because what matters by then is that he is basically there.

### When there are no coordinates — the degradation, unchanged

| The stop has | `LATE` | `AT_RISK` | The ETA cell reads |
|---|---|---|---|
| coordinates | projected ETA past the deadline | ETA within 45 min of it | the projected time |
| none | **the clock passing the deadline** | **never** | `no ETA`, with the reason |

`AT_RISK` does not fire without a projection: you cannot be at risk of missing
something nothing projected. An honest "he's late" beats a fabricated "he'll
be late".

**And it says WHICH kind of nothing.** `address-not-located` means somebody
should look at it; `no-address` means nobody has typed one yet. As a single
`no-coordinates` those read identically and the one needing attention hides
behind the one that does not. The popup prints the cause in full — `no ETA ·
address not located` — where there is room for it.

### A failed geocode is not a failed save

The stop saves with null coordinates and the board falls back to the clock,
exactly as it did before any of this existed. The modal shows a **warning**,
not an error: the dispatcher's work is saved and correct, and colouring it red
sends them hunting for a mistake they did not make. The modal stays open on a
warning, because a banner nobody sees is not a banner.

A re-typed address that stops resolving **clears** the old coordinates rather
than keeping them — stale coordinates project an ETA to the previous address.

### Where the call happens

Immediately **before** the transaction, never inside it. An HTTP round trip
inside an open transaction holds a pooler connection for as long as the vendor
takes to answer, which is how a slow third party becomes "the app is down".
Nothing is less atomic for it: the save still lands with the coordinates it
resolved or does not land at all, and the only cost of a rolled-back save is a
geocode already in the cache. Hard 2.5s timeout; a timeout is a warning.

### Caching and freshness

No storage terms to satisfy — that question died with the provider swap. The
TTL is now about **freshness**: TIGER gains addresses between releases, so a
miss today may resolve next month, and a hit can be superseded by a better
range.

**30 days on hits, 7 on misses.** Coordinates re-derive from an address we
already own, so expiry costs one free call per stop per month. Misses expire
sooner because a miss is usually a typo, and caching a typo for a month keeps
punishing the corrected version.

**Transient failures are never cached.** A timeout or a 5xx is a property of
the service, not of the address; caching "Census was down at 14:02" for a week
would keep a good address unlocatable long after it came back. This matters
more with a free government service that publishes no rate limit and no uptime
guarantee than it did with a paid one.

Measured on the first backfill: 16 stops needing coordinates produced **8
provider calls**, because the cache is keyed on the normalised address and the
same DC appears repeatedly.


## 12.25 Precedence is not urgency rank

The engine asks its questions in a different order from the one the list sorts
in, and they disagree in exactly one place. Written down because two orders
disagreeing looks like a bug to whoever reads the file next.

```
urgency rank   LATE · STALE_GPS · UNASSIGNED · AT_RISK · NO_APPT · ARRIVED · ON_TIME · TOMORROW
precedence     ARRIVED · NO_APPT · UNASSIGNED · STALE_GPS · LATE · AT_RISK · TOMORROW · ON_TIME
```

**UNASSIGNED is evaluated before STALE_GPS.** Rank puts STALE_GPS higher, but
an unassigned truck is usually parked, and a parked truck's gateway goes quiet
because Samsara reports on ignition (§12.3). Rank order would therefore label
exactly those trucks "Stale GPS" — the symptom, with the cause hidden. So
STALE_GPS applies only to trucks that HAVE a driver.

`ARRIVED` leads because arrival ends the question, and `NO_APPT` comes next
because everything below it needs an appointment to measure against.


---

## 12.26 Composed treatments are allowed to look odd

**Accepted, not fixed.**

While the feed is stale, an unassigned truck's ETA cell renders `stale`
*struck through*: the offline treatment (§5.9) and the unassigned treatment
(§5.8) compose literally, because both are true at once and each is drawn by
the rule that owns it.

It reads oddly. It is also rare — it needs a dead feed and an unassigned truck
in the same row — and cosmetic: both treatments are saying something correct.

The fix would be to special-case one inside the other, and that is how a
composition rule starts growing exceptions. Two treatments that compose
predictably are worth more than a set of pairwise special cases, because the
next pair does not need a decision. Left as it is, on purpose, so nobody
"fixes" it later and inherits the exception table.

## 12.27 Nobody ever wrote `arrived_at`

`stops.arrived_at` and `stops.departed_at` have been in the schema since
phase 1. **No code path ever set either one.**

The consequences were quiet and separate, which is why neither got noticed:

- `ARRIVED` requires `arrived_at`, so the status was **unreachable**. A truck
  parked at its receiver read ON TIME forever. The engine was correct; the
  state simply never arrived.
- §12.13's next stop is "the lowest sequence with no `departed_at`", so a
  truck never advanced to its second stop however far away it drove.

The design never said who would populate them. It described what they meant
and moved on, and every layer assumed some other layer was doing it. The only
rows that ever had a value were written by the demo seed — which made it look
populated in development, where anyone would have caught it.

### It could not have been built before the geocoder

Detection needs the stop's coordinates, and until §12.24 nothing had any. The
two gaps had the same root, and closing the first one is what made the second
one fixable.

### The rule

| | |
|---|---|
| **Arrived** | within the radius, speed 0, held for `confirmSeconds` |
| **Departed** | outside the radius, newest fix moving, held for `confirmSeconds` |
| **Never** | unset automatically — a truck that leaves and returns is a dispatcher's call |

**Radius: 0.25 mi. Measured, not guessed.** Truck 143 parked at its Grand
Forks receiver and sat at **0.119–0.135 mi** from the stop's coordinates for
seven minutes at 0 mph. That gap is real and has two causes: Census returns a
point interpolated along the street centreline from a house-number range
(§12.24), not a dock door; and trucks park in yards. Anything under 0.15 mi
would not have fired on the only real arrival available. 0.25 mi clears it
with about twice the margin while staying roughly three city blocks.

**Confirmation: 120 seconds.** The radius alone would fire on a truck at a red
light near the receiver — it is within range and not moving. What a red light
does not do is last two minutes. This feed delivers a fix every 5–8 seconds,
so the window is ~20 corroborating positions rather than two, and one bad fix
breaks the run rather than confirming it.

### The instant recorded is when it arrived, not when we noticed

`arrived_at` is the **oldest fix of the confirmed run** — the first stationary
position inside the radius — never the poll's clock and never the newest fix.
The confirmation window is how the worker became sure; it is not when the
truck got there. Recording the moment of noticing would put every arrival two
minutes late and make dwell time wrong for everyone downstream.

Same anchoring rule as the ETA (§12.24), for the same reason: **the position
is the fact, the poll is the observation.**

Verified on the live feed. Truck 143's arrival was written as `20:15:49Z`
after being detected at `20:31:29Z` — sixteen minutes earlier than the poll
that found it, because the truck had been parked that long.

### What it costs after an outage

Only the last 30 minutes of positions are considered. In steady state that is
invisible: the worker polls every 30 s and confirms an arrival about two
minutes after it happens, so the run's first fix is the true instant.

After an outage longer than the window it is not invisible — a truck that
parked three hours ago is recorded as arriving at the window's edge. The
worker cannot see further back than it looks. A bounded and stated inaccuracy,
and the reason the window is 30 minutes rather than 5.

> **This paragraph was false as written, from phase 5 until §12.41.**
>
> It claimed the window BOUNDED the inaccuracy. It did not. `confirmedRun`
> broke on the first fix that failed, so a run had to begin at the newest fix
> — the truck had to still be parked. Once it left, the dwell sat behind a
> moving fix and could never be found, however far back the window looked. The
> arrival was not late, it was **lost**.
>
> Truck 116 is the proof: 21 minutes at its receiver during a 34-minute worker
> stall (§12.39), and nothing recorded it. The window was irrelevant; the head
> of the list disqualified everything behind it.
>
> A spec line asserting a guarantee the code does not provide is its own
> defect — it is what stops anyone looking. The bound is real now (§12.41).

### The dispatcher still wins

The worker records facts; the override decides what the row shows. A live
`ARRIVED` override beats the engine whatever `arrived_at` says (§9.5), and a
forced status is unaffected by anything here. The worker is not consulted
about display and never clears a dispatcher's decision.

Every write — arrival and departure — puts a row in `audit_log` with
`actor_user_id` null, `source: "worker"`, and the radius and window that
convinced it, so a stop that changed state overnight can be explained, and the
threshold argued with, after the fact.

## 12.28 The override rides inside the save

A dispatcher who changes an appointment **and** forces a status is doing one
thing. It used to be two HTTP requests to two routes against two tables: the
stop save, then the override. Either could land without the other.

The failure is not hypothetical and it is not loud. The dispatcher sees an
error on a screen they are about to close; the next shift sees a board that
disagrees with what was intended and no indication why. At 4am the error
message is long gone and the row is all there is.

**One endpoint, one transaction, both writes or neither.** `StopEdit` carries
an optional `override` — `{ action: 'set', … }` or `{ action: 'clear' }` — and
`saveStopEdit` applies it inside the transaction that wrote the stop.

### It carries no `stopId`

The embedded form deliberately omits it. On a new load the stop does not exist
when the request is built, so the client could not supply one — and the server
knows the right answer anyway, because it just wrote the row. `OverrideInput`
keeps its `stopId` for the standalone route; the two share one field set and
one copy of the three validation rules, because §12.21 survived precisely by
having a rule in two places.

### Nested transactions are savepoints

`setOverride` and `clearOverride` open transactions of their own. Called from
inside the save they become savepoints, so an override that fails rolls the
stop write back with it. That is asserted directly: a save carrying an expiry
already in the past throws, and the dispatcher note it also carried is
**unchanged** afterwards — checked inside the transaction, where a partial
commit would be visible if one existed.

### `Clear now` stays its own request

The block's `Clear now` button is not part of a save. It is an immediate,
deliberate act with its own audit entry, and it is atomic by itself. Folding
it into the save would mean a dispatcher had to press Save to undo something
they had already decided to undo.

## 12.29 Three render-phase bugs, one shape

The console has now shipped three bugs that had nothing in common on the
surface and everything in common underneath. All three **worked visibly**.
All three passed typecheck, lint and the whole suite.

| # | Symptom | What was actually wrong |
|---|---|---|
| 1 | "Synced 2s ago" on the server, "4s" on the client | a render read `Date.now()` |
| 2 | First paint carried no fleet; the console refetched on mount | `useSearchParams` opted the subtree out of server rendering and discarded the `loadFleet()` prefetch |
| 3 | `Cannot update a component (Router) while rendering a different component (Console)` | `router.replace` called from inside a `setChips` updater |

**The shape: work that belongs to an event or to the server was performed
during render instead.** Render must be a pure function of props and state.
Reading the clock is not pure. Reading the URL bar is not pure. Writing the
URL is very much not pure.

### Why the third one hid so well

The offending line sat inside a `useCallback`, which reads as "this is a
handler". It was not the callback that ran at the wrong time — it was the
**updater it passed to React**:

```ts
setChips((current) => {
  const next = new Set(current);
  …
  syncUrl({ chips: [...next] });   // ← React calls this while RENDERING
  return next;
});
```

React invokes a functional updater during the render phase. Anything inside it
happens during render, however event-shaped the code around it looks. Wrapping
it in more `useCallback` cannot help, and neither can `setTimeout` — that only
moves the same wrong call somewhere harder to see.

**The rule: a state updater returns the next state and does nothing else.**
Compute what you need in the handler, then set state and cause effects there.
Reading current state directly in a handler is correct — a handler always sees
the last committed value. The functional form buys atomicity across several
updates in one tick, which a single click does not need.

### The same bug was in the split, silently

`Split` wrote `localStorage` from inside a `setPct` updater for exactly the
same reason — the pointer handlers close over a stale `pct`. React does not
warn about `localStorage`, so it never surfaced; it was double-writing under
StrictMode and nobody could tell. Fixed with a ref, which is the honest tool
for mutable state that is not render state.

### How it is caught now

`useChipFilters.test.tsx` asserts **exactly one URL write per click**, under
`StrictMode`.

That is the whole trick, and it needs no Router and no matching of React's
warning text. StrictMode deliberately double-invokes state updaters to flush
out side effects hiding in them. A pure updater runs twice and nothing
outside notices. An impure one writes the URL **twice per click**, which is a
call count. The test was written against the broken code first and failed with
`expected 1, got 2`.

### The other three URL writers, audited

| Writer | Verdict |
|---|---|
| `?truck=` selection | written only from event handlers — row click, marker click, arrow keys, Dismiss. Correct. |
| search field | a guarded effect on the **settled** debounced value. A genuine effect: it reacts to a value changing over time, not to a render. |
| split persistence | had the bug. Fixed. |

## 12.30 Three precision levels, and what each one is allowed to conclude

§12.24 chose Census and accepted a coverage tradeoff. This is that tradeoff
arriving, on the fleet's busiest lanes.

`26416 S Walton Dr, Elwood IL 60421` — the CenterPoint intermodal ramp —
returns **nothing** from Census. Not a wrong match: no match, at any house
number, and the bare street name too. TIGER does not carry new private
industrial-park roads, and Elwood, Joliet and Willow Springs are where these
lanes go. The stop projected no ETA, so LATE could only come from the clock,
which is how truck 143 read ON TIME for 67 minutes while missing its window.

### The levels

| | what it is | measured error | arrival | AT_RISK |
|---|---|---|---|---|
| `street` | house number matched inside a TIGER range | interpolation only | **yes** | **yes** |
| `block` | nearest probed block on the correct street | 0.16–0.78 mi | no | **yes** |
| `zip` | ZCTA centroid, vintage 2023 | median 2.14 mi, p90 5.51 mi | no | no |

`city` was retired. Census rejects city-only input with HTTP 400 rather than
returning a centroid, so the level was unreachable by construction and zero
rows ever carried it. **A level nothing can write is worse than no level,
because it reads as a case someone handled.**

### The chain, in order, and what it costs

1. **The address as typed.** One call. The common case ends here and pays
   nothing for the rest.
2. **Four probes on the same street**, at house numbers {200, 500, 1000,
   4000}, in parallel — four calls, one round trip, about 0.7 s measured.
   Only ever reached after a miss.
3. **The ZIP centroid.** Zero calls: a vendored static file, so the last
   resort cannot fail because someone else's service is down.

Only `no-results` falls through. A **refused** match — wrong state, wrong city
— stops the chain, because the dispatcher needs to see that error, not have a
centroid quietly stand in for it. That is how the Moorhead ND/MN typo was
caught, and it stays caught.

### Why the probe numbers are those four

Census requires a house number: a bare street name always returns zero
matches, measured. So street existence can only be established by trying
numbers. Probing ten across four known streets:

```
W Buckeye Rd, Phoenix         1, 50, 200, 500, 1000, 2000, 4000, 8000
N Washington St, Grand Forks  1, 50, 200, 500, 1000, 2000, 4000, 8000
Fulton Industrial Blvd SW     200, 1000, 4000
Laraway Rd, New Lenox         500
Walton Dr, Elwood             none — genuinely absent
```

{200, 500, 1000, 4000} is the smallest set that finds all four real streets
and still finds nothing on the absent one. One probe would have missed Fulton;
two would have been luck.

### Nearest block, not first hit — the measurement that set the design

Taking *any* probe hit puts you at an arbitrary point on a road that can be
**9.15 miles** long (W Buckeye Rd, measured), which is worse than the ZIP
centroid. Taking the probe **nearest the typed number** was checked against
the three addresses where a true coordinate existed:

```
4747 W Buckeye Rd               nearest probe 0.54 mi   ZIP centroid 2.45 mi
4400 Fulton Industrial Blvd SW  nearest probe 0.78 mi   ZIP centroid 2.95 mi
1804 N Washington St            nearest probe 0.16 mi   ZIP centroid 5.51 mi
```

Three to thirty times better. That is why `block` sits above `zip` — and why
it is not `street`: 0.78 mi is larger than the arrival radius.

### The two things a coarse coordinate must not be allowed to do

**Arrival detection runs on `street` and nothing else.** The radius is 0.25 mi
(§12.27). A 0.25 mi circle around a ZIP centroid is noise — trucks would be
marked ARRIVED four miles from the dock, and `arrived_at` is never unset
automatically, so nothing would take it back. A wrong arrival is not cosmetic:
it removes the stop from every urgency signal that would otherwise chase it.
Gated in the pure rule *and* in the worker's query.

**AT_RISK does not fire on `zip`.** The buffer is 45 minutes; a centroid is
3–8 minutes of ETA error. Small against the buffer, but AT_RISK is a claim
about the last 45 minutes specifically, and inside that window the error is a
meaningful share of what is being measured. "He might just miss it", computed
from a point four miles from the dock, is a guess wearing a number.

**LATE survives all three levels**, and that is the point of the whole
feature. At hours out, being past the deadline is robust to five miles of
error, and it is the fact a dispatcher has to act on.

### Said out loud, wherever the number appears

The row tooltip and the popup name the kind of number and its ±. A dispatcher
deciding whether to phone a receiver needs to know whether they are looking at
an address or an area, and a bare time makes those identical — the same
mistake as the em dash that hid "cannot project" behind "nothing entered".

### The cache knows which chain wrote it

`geocode_cache.provider` carries a CHAIN version, bumped when the chain
changes rather than only when the vendor does. Without it, every address that
had already missed would have sat in the cache as a miss with days of TTL
left, and the new fallback would not have run for any of them until the
following week. **A stale cache keeps working, at the old answer** — which is
the failure mode a cache has that a bug does not.

### Getting a real hit rate

`npm run geocode:probe -- <file>` takes a list of real destinations and
reports the split by level. It is read-only — no database connection at all,
and it writes nothing, not even cache rows — so it can be pointed at live lane
data without touching dispatch records.

## 12.31 The road factor was never measured

The brief said "straight line × 1.25 ÷ 52 mph" and phase 2 would swap in a
routing provider. The swap never happened, so **every LATE and AT_RISK
decision the board has ever made ran on an unmeasured constant.**

Measured, across our own lanes, against routed truck miles:

```
min 1.070   p25 1.180   median 1.259   p75 1.407   max 1.460
mean 1.282   sd 0.128
```

It is not a constant and it is not distance-related. Truck **116 at 74 mi is
1.070**; truck **140 at 63 mi is 1.454** — same length, opposite geometry. It
clusters by *corridor*: Fargo 1.07–1.18 (straight interstate), Joliet
1.25–1.55 (the last miles are local roads), Denver/SLC ~1.42 (mountains).

**No single factor rescues it, and tuning makes it worse:**

| factor | mean \|err\| | worst |
|---|---|---|
| 1.250 (the brief) | 41.4 mi — 48 min | 140 mi — 162 min |
| 1.282 (the mean) | 44.2 mi — 51 min | 112 mi — 129 min |
| 1.300 | 45.9 mi — 53 min | 96 mi — 110 min |

The mean error exceeded the 45-minute AT_RISK buffer it fed.

### The provider, and the tradeoff taken with eyes open

**Mapbox Directions**, `driving`, `overview=false` — distance and duration,
never geometry. Chosen over OpenRouteService on **vendor count**, not cost:
the account already exists and 100,000/month against ~516 calls/day is not
the constraint.

**Mapbox has no heavy-goods profile, so every route here is a car route.**
Measured against Valhalla's truck routing on our own lanes: **+3.0 mi mean,
+15.6 mi worst** (truck 122, Denver).

That is fine for deciding LATE and it is **not fine for reconciling against a
rate confirmation** — brokers pay truck miles and a car route reads short. So
the row and popup say `routed road miles` and the tooltip says it in full:
*"a routed road distance for a car, so it can read short of a truck-mile
figure on a rate confirmation."* If dispatchers start reporting that the miles
do not match their rate cons, that is the expected failure and not a bug.

`EtaProvider` is the containment. An HGV provider is one new file; the policy,
the cache, the budget and the engine all take miles and seconds.

### The cache teaches, it does not just remember

Each route yields `laneRatio = routedMiles / straightAtRoute` — **the measured
road factor for that corridor**. Between recomputes the estimate is
`straightNow × laneRatio`, so even the degraded path uses a number measured on
that lane rather than a global guess.

Recompute on: the stop's coordinates changed; the route is over 12 hours old;
or the straight-line distance moved by more than `max(10 mi, 15%)`.

```
max( 2 mi,  5%)   74 routes/lane   ~1,843 calls/day
max(10 mi, 15%)   21 routes/lane   ~  516 calls/day   <- chosen
max(25 mi, 25%)   11 routes/lane   ~  268 calls/day
```

Proportional, because a 15% error 600 miles out is irrelevant and a 15% error
20 miles out is not. For scale, 23 trucks polling every 30 s is **66,240 polls
a day**; routing per poll would be 66,240 calls.

Keyed on `stop_id`, which makes one invalidation free: when an appointment
reorders stops and the next stop becomes a different row, the lookup simply
lands elsewhere. In the **worker**, never in a render or a request path —
otherwise the first dispatcher to open the console pays for 23 routes.

### Snapping

The provider MOVES a waypoint to the nearest road and reports how far. That
distance is itself a quality signal, and it separates our precision levels
almost perfectly:

```
street-precision stops   1–8 m      (median 7)
ZIP centroids            379–402 m
```

Note at **100 m** — twelve times the worst real street stop, so it cannot
flag a good one, and well under the ZIP cluster, so it always flags those.
Refuse at **2 km**, just past `block` precision's measured 0.78 mi: if the
nearest road is further away than our worst deliberate approximation, the
route describes somewhere else.

**It compounds with coordinate precision.** Elwood is a ZIP centroid ±4.4 mi
routed from a point 379 m away, so the row reads **±4.6 mi** — a number that
admits its own construction.

### Duration, used and capped

`speed = min(routedMiles / routedHours, avgSpeedMph)`.

The route knows road classes, which a flat 52 mph does not — truck 147's
6.5-mile approach implied **36.2 mph** through Joliet, and that is real
information. But it is a *car* duration: the first live call implied **65.5
mph**, which no loaded truck sustains. Capping keeps the useful half.

**No break time is added.** HOS is on the brief's never-build list, so this is
a **driving-time** estimate and the tooltip says so — *"counts driving only —
no rest breaks."* A long lane will read optimistic against a driver who stops.
Inventing a break model would be worse than saying it.

### Spend

`routing_budget`, one row per UTC month, incremented **before** each call —
a call that times out still cost quota, and counting successes would let a
failing provider burn a month while the counter read zero. In the database,
not worker memory, so a crash loop cannot reset it. Over the ceiling (default
25,000, a quarter of the free tier) the board degrades to lane estimates. Plus
`MAX_PER_CYCLE = 8`, so a bad threshold costs 8 calls per 30 s rather than one
per truck.

No retry, ever. The next poll is 30 seconds away and a retry storm against a
metered API with no hard spend cap is the failure this exists to prevent.

### `route_samples`

Append-only, nothing reads it. Every route logged with its destination,
straight and routed miles, ratio, duration, implied speed and snap. After one
evening it already says:

```
Fargo, ND           n=4  avg 1.131  (1.067–1.171)
Atlanta, GA         n=3  avg 1.249  (1.244–1.255)
Denver, CO          n=3  avg 1.306  (1.084–1.419)
Joliet, IL          n=4  avg 1.420  (1.253–1.552)
```

That is the table that would let anyone sanity-check a provider swap, or spot
a corridor whose ratio moved because of construction.

### And the row now shows road miles

`milesRemaining` was the great-circle distance, which is not a number anyone
in freight uses — short by 7% to 46% depending on the lane. It is road miles
now, of whichever kind the basis names.

### ADDENDUM (§12.59): the car-vs-truck gap is concentrated, not general

The `+3.0 mi mean, +15.6 mi worst` above is the number that justified the
provider seam, and it was re-measured on our own lanes once the seam was
actually spent. The mean grew — HERE truck against HERE car is **+9.4 mi mean,
+44.1 mi worst** — but the more useful finding is the shape:

```
6 of 10 lanes   identical to the car route, within 0.5 mi
4 of 10 lanes   +23.6 mi mean, +44.1 mi worst
```

**Truck routing either agrees with car routing exactly or departs from it by
tens of miles.** It is not a small general improvement spread across every
lane; it is no improvement at all on most of them and a large one on a few.
Averaging the two modes produces a figure that describes no lane this company
runs — the same error the 1.25 road factor made, and the same shape as
§13.7's bimodal yard.

Two consequences worth holding on to:

- **The value is a property of the LANE, not of the fleet.** A swap justified
  by a mean would look disappointing on any single interstate run and
  suspiciously good on a handful of others. Either reading is wrong.
- **Nobody has established WHY those four diverge.** The likely cause is a
  weight, height, length or hazmat restriction forcing a real detour — which
  would mean the divergent lanes share a structural feature and are therefore
  predictable, not random. That is worth knowing: if the gap tracks a
  restriction we could name, it would also tell us which lanes deserve the
  truck dimensions §12.59 deliberately does not send.

**Not investigated, and not urgent.** Recorded here rather than in §13
because it is a note on a measurement already taken, not an open design
question. The four lanes were Phoenix (+44.1), Dallas (+43.4), Salt Lake City
(+5.8) and Minooka (+1.2); `npm run route:compare` reproduces the table.

## 12.32 Tests that read the state of the world

Four faults in one session, all the same shape — a test whose result depended
on what happened to be in the database rather than on its own setup:

| | what it read |
|---|---|
| the geocode cache | a real `geocode_cache` row the backfill had written, served instead of the mock |
| the retype fixture | a stale cache row from an earlier run |
| the assignment fixtures | `select … from drivers limit 1` — whoever was free at that moment |
| the `stop_routes` sweep | rows the live worker committed mid-test, visible under READ COMMITTED |

Every one was found by accident. None was found by the suite. Four in one
session means the fifth was already written and simply had not failed yet.

### Raising the isolation level would have made it worse

**This is the tempting wrong answer. Write it down, because the next person
will reach for it.**

`REPEATABLE READ` takes its snapshot at transaction start, so it hides rows
another process commits *during* the test — which fixes the sweep race and
nothing else. The other three read rows that were already committed before the
transaction opened, and no isolation level hides those; that is what a snapshot
is.

So it fixes one fault in four, and makes the remaining three *less* likely to
show, because the symptom is flakiness and flakiness is the only reason any of
them were noticed. The suite would get quieter and no more correct, and the
change would have been called done.

> **A fix that reduces flakiness without reducing wrongness is worse than no
> fix.** Flakiness is not the defect. It is the only evidence the defect is
> there.

The same test is worth applying to anything that makes a symptom
intermittent rather than absent: retries, sleeps, longer timeouts, wider
tolerances.

### What was built instead

A Postgres cluster that belongs to the checkout — `scripts/test-db.sh`,
`initdb` into `./.testdb` on port 55432, Postgres 17 to match Supabase's 17.6.
Not a service, not shared, `rm -rf` to destroy. The migrations apply to it
unmodified; `scripts/test-db-prelude.sql` supplies the Supabase platform
objects they reference (`anon`, `authenticated`, `service_role`, `auth.users`)
and is the only place local diverges from production.

The database swap alone does not clear the bar, because a test could still
read rows another test left. Four guards do:

1. **Production credentials do not exist in the process.** `vitest.setup.ts`
   overwrites `DATABASE_URL` with the local cluster and *deletes* `DIRECT_URL`,
   both Supabase keys, the Samsara token and both Mapbox tokens. Deleted, not
   blanked — an empty string is a value a `??` will keep. There is no string
   left to reach production with. If `TEST_DATABASE_URL` is pointed at
   production the suite refuses to start, compared by host and database name
   rather than by string, because the two Supabase URLs differ only in port.
2. **The database starts empty**, truncated once per run by `globalSetup`.
   This is the guard that converts the fault into a failure:
   `select … limit 1` returns nothing and the fixture throws where it stands.
3. **`afterEach` names a test that commits**, empties the tables so the next
   test is not blamed, and fails the one that leaked.
4. **A fetch guard** rejects any call to a host that is not loopback. The
   geocode fault was a live HTTP call reached through a cache row; guard 2
   removes the row, this removes the call.

`src/test/guards.test.ts` asserts all four are in force, so removing one fails
the suite rather than quietly restoring the conditions for the bug.

### The guard that ran too late — the canonical example

Guard 1 was written into `vitest.setup.ts`. **`globalSetup` runs before the
test workers, and `setupFiles` runs inside them.** So the truncate had already
happened by the time the guard refused.

It was verified. The verification was pointing `TEST_DATABASE_URL` at
production and showing that the suite refused to run:

```
Error: TEST_DATABASE_URL points at the same database as DATABASE_URL
(aws-1-eu-west-1.pooler.supabase.com/postgres). … Refusing to run.
```

That output is real. It is also what a database being truncated looks like,
because the refusal printed *after* `globalSetup` had emptied every table in
`public`. **The act of verifying the guard is what destroyed the data** — the
production database, not the demo rows: every load, stop, assignment, override,
the geocode cache, the audit log, and the `profiles` row the owner logs in with.

Proven rather than deduced, afterwards, with a `canary` database holding three
rows: point `TEST_DATABASE_URL` at it, run the suite, three rows become zero.

This is the shape of **every** bug in this session, and it is worth naming
because it keeps coming back wearing different clothes:

| § | rule present in | absent from |
|---|---|---|
| 12.21 | the modal's validation | the shared schema, then the server re-parse |
| 12.28 | the stop save's transaction | the override write beside it |
| 12.29 | the click handler | the render path that also wrote the URL |
| 12.31 | the config's road factor | the lane it was applied to |
| 12.32 | `vitest.setup.ts` | `globalSetup`, which runs first |

**A rule enforced in one layer and absent from the layer that acts first is
not a rule.** It is documentation that reads like a rule, and it is more
dangerous than no rule at all, because it produces evidence of safety.

The refusal now lives in `src/test/url.ts` — a module with no side effects,
because importing `globalSetup` re-ran its `dotenv` call and restored the very
credentials guard 1 deletes — and `globalSetup` calls it before it opens a
connection. It also refuses any non-loopback host outright, which does not
depend on `DATABASE_URL` being set correctly by anyone.

### What the inventory actually contained

The guards were expected to fail six fixtures. They failed **53 tests across
six files**, in two classes:

- **39** — `truck!.id` on an empty result. The `limit 1` fixtures, failing as
  designed.
- **9** — `expected 0 to be greater than 0`. Tests whose *assertions* counted
  rows production happened to have.

The second class was not on the list and could not have been found by grep.
And it under-counts: three more tests in `fleet-query.test.ts` and two in
`worker/routing.test.ts` did not fail at all, because they iterate
`for (const row of rows)` and an empty database makes them **vacuous**. The
column-type test claimed to check forty column types while skipping every
null, and against production most were null most of the time. It now builds a
row with all forty populated and pins the null set to `['arrived_at']`, so a
fixture that stops populating a column fails instead of quietly stopping
checking it. `caps how many routes one poll may spend` asserted
`routed <= 8` against a fleet that had to hold more than eight routable lanes
for the assertion to mean anything; it builds twelve and asserts `routed === 8`.

### What it cost and what it bought

The fixtures had accumulated scaffolding whose only purpose was surviving a
shared database — ordered `limit`s so the planner could not change which truck
a test got, `freeUp()` ending open assignments the fixture had no right to,
and two suites deliberately taking opposite ends of the fleet so they would
not lock the same rows. All of it deleted.

`fileParallelism: false` went with it. It was there because `applyReassignment`
takes a fleet-wide `select … for update`, which serialises any two suites
touching assignments; that lock is per database and each test's rows are now
its own. Confirmed green across ten consecutive runs.

```
before   2m 26s   one file at a time, against eu-west-1
after       3.4s   parallel, against localhost
```

### The gap, and the gate that covers it

A local cluster cannot exercise the real Supabase pooler, and `prepare: false`
in `createPooledDb` is the setting whose absence fails only under concurrency,
in production. `npm run preflight` is therefore a **required step before
deploy**, not a note: it checks that `DATABASE_URL` is `:6543`, that the real
fleet query still returns the shape the row type claims, that the session
pooler is reachable, and that `prepare: false` is still load-bearing.

### The first version of that gate was worse than no gate

It asserted that `prepare: true` **stalls**, and passed only while it did.

```
prepare:true    1 connection,  2 statements   returns
prepare:true    5 connections, 20 statements  stalls (5 of 5)
prepare:true   10 connections, 20 statements  inconsistent
prepare:false   5 connections, 20 statements  ok
```

Three things were wrong with it, and only the first was obvious:

1. **Its green light depended on a vendor bug persisting.** When Supabase
   fixes Supavisor the gate goes red on a perfectly healthy system, and the
   obvious way to make it green again is to delete the `prepare: false` it
   exists to protect. A gate that trains people to remove the thing it guards
   is worse than no gate.
2. It cost **twelve seconds of every run waiting for something to fail**.
3. It could not tell *"prepared statements rejected"* from *"pooler
   overloaded"*, because both present as a stall.

It also got the answer backwards the first time. The original probe used one
connection and two sequential statements — the one configuration where the
bug does not show, because the prepared statement is reused on the backend
that prepared it — and reported the opposite of the truth.

**The gate now asserts our own configuration**, which is the part we control
and the part that matters: `createPooledDb` sets `prepare: false`, and the
connection it produces survives twenty concurrent statements. The pooler's
behaviour toward prepared statements is *reported as a note and never
asserted*. Run time dropped from ~18 s to ~6 s.

The check is verified to discriminate rather than to always pass:
`prepare: false` reads `false`, `prepare: true` reads `true`, and omitting it
reads `true` — so two of the three fail the gate.

## 12.33 The tooltip had four clauses and needed two

Truck 137's row tooltip read:

> Distance is a routed road distance for a car, so it can read short of a
> truck-mile figure on a rate confirmation. The destination is a ZIP-code
> centre ±4.6 mi, not a street address — Census has no record of this street.
> At risk is suppressed here because the area is wider than the warning is
> worth. The route starts from the nearest road, about 379 m from that point.
> Arrival time counts driving only — no rest breaks.

Every clause is true. Four is more than anyone parses at 4am, and **a label
that does not get finished is worse than a shorter one that does.**

Ranked by what changes a decision:

| clause | verdict |
|---|---|
| ZIP centre ±4.6 mi | decides whether to trust the ETA at all. **Keep, first.** |
| driving only, no rest breaks | moves the number by hours on a long lane. **Keep, second.** |
| car profile vs truck miles | matters when reconciling a rate confirmation, which is not what a hover is. **Demote.** |
| 379 m snap | already inside the ±4.6, and answers a question nobody asks. **Demote.** |

### The one demotion that would have been wrong

The original ranking also demoted *"at risk is suppressed here"*. That is the
one clause that must stay, and the reason generalises:

**Every other demoted clause makes the board say less about a number that is
on screen. Suppression makes the board withhold a warning it would otherwise
show.** A dispatcher reading a row with no AT_RISK chip concludes the stop is
fine — an inference from absence, where the label carries the whole meaning
and there is nothing else on screen to correct it.

It survives as four trailing words rather than a clause, which is the right
weight for it:

```
zip, routed      The destination is a ZIP-code centre ±4.6 mi, not a street
                 address, so no at-risk warning will fire. Arrival time counts
                 driving only — no rest breaks.

street, routed   Arrival time counts driving only — no rest breaks.

straight-line    Distance is a straight line, not a road route, so the miles
                 read short. Arrival time counts driving only — no rest breaks.

lane-estimate    Distance is estimated from this lane's last route (×1.32),
                 not routed again yet. Arrival time counts driving only — no
                 rest breaks.
```

Exactly **one** trust clause fires, and coarse coordinates beat a degraded
distance — being three miles from the right place outranks the miles being
measured differently. When both are true they combine into one sentence rather
than queueing:

```
zip + straight-line   The destination is a ZIP-code centre ±4.6 mi and the
                      distance is not a measured route — treat the time as a
                      rough guide, and note that no at-risk warning will fire.
```

A street stop on a routed lane says the minimum, which is the point: when
nothing is wrong, nothing is said.

### Where the rest went

`etaDetails()` returns labelled lines for a surface someone opens on purpose —
a collapsed `<details>` in the map popup, and open in the edit modal, where
anyone reconciling against a rate confirmation has already gone deliberately.

```
Accuracy   ZIP-code centre, ±4.6 mi — Census has no record of this street
Distance   Routed road miles for a car; a truck-mile figure on a rate
           confirmation will read longer
Route      Starts 379 m from the destination point, at the nearest road
Lane       ×1.22 measured straight-line-to-road on this lane
Measured   22s ago
```

`Lane` and `Measured` are new. Both were already in `stop_routes` and nothing
surfaced them, so a lane whose route had gone stale looked identical to one
measured a minute ago.

The popup previously rendered the whole sentence **twice** — once as a `title`
on the Projected line and again in full in an Accuracy row beneath it.

`<details>` rather than state: the browser owns whether it is open, which is
one fewer thing that can write during a render (§12.29).

### Tested as a rule, not as strings

`eta-basis.test.ts` asserts the two-clause ceiling across every combination of
precision × basis × accuracy the board can produce, that the constant clause is
always last, and that at-risk suppression appears on every zip row and no other
row. The strings will be reworded; the ceiling must not move.

## 12.34 The singleton nothing recreates

`feed_health` holds one row, written by migration 0001. Every worker path
against it was `update … where id = 1`, and **an UPDATE matching zero rows is
not an error.**

Lose the row and three things fail at once, silently:

| path | consequence |
|---|---|
| `recordSuccess` | the cursor is never persisted, so every restart re-fetches from cold |
| `recordFailure` | `last_error` is never written, so the offline banner has no cause |
| `loadFleet` | `newest_position_at` stays null, and `isFeedStale(null, …)` is **true** |

The third is the serious one. The console withdraws schedule colour from every
row when the feed is stale (§5.9), so a missing singleton means **the board is
permanently and silently colourless** — the one state that looks like the rule
working correctly.

Found because the §12.32 truncate removed it, which made that truncate an
accidental dry run of a fresh deploy. A genuine fresh deploy is covered, since
migrations run first and 0001 seeds the row; what is not covered is anything
that loses it afterwards, and the failure is invisible in logs either way.

Fixed by making the writes upserts, so the worker recreates the row rather
than depending on a row only a migration knows how to create. Confirmed on the
real database: the worker was restarted with the row absent and wrote it on its
first successful poll, cursor and all.

`npm run db:verify` already checked this (`feed_health rows : 0 (singleton)` →
`FAILED`) and was the only thing that noticed.

## 12.35 Drivers a dispatcher creates

New hires are on the board before anyone adds them to the ELD, and until now
they could not be assigned to a truck at all — so the board could not
represent the real fleet.

### The hazard, established before anything was designed

The roster sync rewrites `drivers` from Samsara every poll. If a hand-entered
driver were wiped on the next one the feature would be worthless, so that was
settled first, by running it rather than by reading it:

```
seeded:   samsara-1     Samsara Driver    (synced)
          app-local-1   Hand Entered      phone=555

Samsara returns ONLY samsara-1, renamed. After the sync:

          app-local-1   Hand Entered              active=true  phone=555   survived
          samsara-1     Samsara Driver RENAMED    active=true  phone=-
```

`upsertDrivers` is `INSERT … ON CONFLICT DO UPDATE` with **no DELETE**, and
nothing else in the codebase writes to `drivers` at all.

**But that survival was an accident of the sync's shape, not a rule.** Nothing
stated it, no test asserted it, and the obvious next feature — "deactivate
drivers Samsara stopped returning" — would have wiped every hand-entered
driver in one poll.

### Source is explicit, never inferred

`samsara_driver_id IS NULL` is the tempting inference and it is wrong at the
one moment it matters: a **merge fills that id in**, and the row the sync must
still keep its hands off then looks Samsara-born. So `source` is a column, and
the sync carries `setWhere source = 'samsara'`.

### The constraint that would have taken the worker down

`samsara_driver_id` becomes nullable and its unique index **partial**.
Postgres will not match `ON CONFLICT (samsara_driver_id)` to a partial index
unless the same predicate is supplied, so without `targetWhere` the roster
sync throws *"no unique or exclusion constraint matching the ON CONFLICT
specification"* — on the worker, on every poll, thirty seconds apart.

### The merge: detect and offer, never automatic

Onboarding completes, Samsara returns the driver, and the sync makes a
**second** row for a person who already has assignment history against the
first.

Name is the only signal available — Samsara gives id, name and activation
status, no phone, and licence data is never stored — and two drivers called
J. Martinez in a 24-driver fleet is not hypothetical. An automatic merge that
is wrong silently rewrites assignment history, and **nobody would find it,
because the point of merging is that the rows stop being distinguishable.**

So the sync records a candidate and a human decides. Dismissals are stored, or
a rejected match re-offers itself every thirty seconds forever.

Linking runs in one transaction, in this order:

1. repoint `assignments.driver_id` — `ON DELETE RESTRICT` requires it, and it
   is what keeps the history intact rather than orphaned;
2. carry the phone across if Samsara has none, which it never does;
3. carry a local retirement across;
4. delete the app row, now unreferenced;
5. audit **both ids**, on both sides.

Rewriting which row past assignments point at is deliberate: the meaning of
the merge is that these were always one person, and a history that keeps them
apart lies in the other direction. **The audit entry naming both ids is the
condition** — afterwards the rows are indistinguishable by design, so that
entry is the only way back from a wrong link.

### Name matching had two implementations, and they disagreed

Found by a test. `detectMergeCandidates` normalised in SQL
(`lower(regexp_replace(…))` — whitespace and case) while `normalizeDriverName`
normalised in TypeScript (also punctuation and accents). "J Martinez" and
"J. Martinez" matched in one and not the other.

The same shape as §12.21, §12.23 and §12.32: **one rule, two implementations,
and the layers drift.** Collapsed to one — the matching happens in TypeScript
and the database does not get a vote. At 24 drivers the read is free.

### The rest

| decision | why |
|---|---|
| **name only**, phone optional | A required field a dispatcher cannot fill at 6am is a required field they will fake, and faked data looks real to the next shift. Phone is the only way to reach a driver with no ELD. |
| **nothing else** | Licence data is never stored by policy; an employee number has no consumer, and a field with no consumer goes stale while looking authoritative. |
| **`No ELD` tag** in the picker | Provenance, not status — so it borrows no status colour. It decides whether "no position" reads as expected or as broken. |
| **dispatcher creates; admin links and retires** | Creating is routine and happens at 6am. Linking rewrites history; retiring removes someone from the board. Neither is urgent, both are hard to notice afterwards. |
| **`retired_at`, not `active`** | `active` is Samsara's and is rewritten every poll, so after a merge the sync would resurrect a driver an admin had retired. |
| never deleted | `assignments.driver_id` is `ON DELETE RESTRICT`, and the history is the record of who drove what. |

### Position is keyed on the vehicle

Stated rather than assumed, and pinned by a test: the fleet query joins
`positions` with a lateral on `truck_id`, and the driver join supplies only
`driver_id` and `driver_name`. A truck with an app-created driver has
position, ETA, miles, routing and arrival detection exactly as any other. What
a driver with no ELD costs is their own HOS — which this product does not use
at all.

## 12.36 Arrival detection had never fired

It shipped in phase 5 with 24 tests against synthetic fixtures. A week of a
worker running against a live fleet later: **zero arrivals, zero departures.**

That is not evidence it works. It is not evidence it is broken either, and
that ambiguity is the actual defect — `arrived: 0` was the same log line
whether the fleet was 600 miles out or one poll short of confirming.

### Why it never fired

Measured against the live fleet:

```
watched stops (street precision, undeparted)  19
open stops: street 47 · not-street 1 · no coordinates 0
closest truck to its next stop                4.435 mi
within the 0.25 mi radius                     0
```

Nothing was wrong. The watched set was healthy, the coordinates were there,
the radius was fine — **the trucks had genuinely not arrived**, because the
watched stops are seeded demo destinations that bear no relation to where this
fleet actually drives. The detector had never been given a chance.

### Verified against real position data

The fixes in `test/real-tracks.ts` are unedited production data — real
coordinates, real 11–30 s cadence, real GPS wander, real speeds. Only the
stop's coordinates are chosen, which is the one thing a dispatcher types
anyway.

**Truck 142, near Wisconsin Dells — genuinely parked.** Seventeen consecutive
fixes at 0 mph across five minutes, wandering 3.5e-5° of latitude (about 12
feet) and 1.2e-4° of longitude (about 30 feet). That jitter is why the radius
is 0.25 mi and not something tighter: a stationary truck's coordinates move.
Detected, through the whole sweep, anchored to a recorded fix rather than
`now()`.

**Truck 133, near Alexandria, MN — a traffic light.** 69 mph, down to 21, then
**0 mph for thirty-six seconds**, then away again at 11, 15, 35, 53, 67, 69.
With the stop placed on the exact halt point the detector correctly refuses:
the two-poll confirmation is the only thing standing between that track and a
moving truck parked on the board. This is the case the feature lives or dies
on, and it now has real data behind it.

### Silence made legible

Every sweep now logs the closest candidate and what stopped it counting —
`too-far`, `moving`, `not-confirmed`, `coarse-precision`, `already-arrived`.

The closest fix in the window, not the newest: "how close did it get" is the
question, and the newest fix cannot answer it, because a truck that pulled
into the yard and left again reads identically to one that was never there.

The first instrumented sweep changed the picture immediately:

```
12:53:11  considered 19  arrived 0  nearest truck 133  0.194 mi  52.814 mph  moving
```

**0.194 mi — inside the 0.25 mi radius.** The fleet does pass within range of
these stops; it passes *through* them at 52 mph, and the speed gate rejects it
correctly. A week of `arrived: 0` had hidden that entirely.

## 12.37 The fifth instance, and the first where the missing layer was the UI

§12.35 shipped a migration, a schema, a server module, an API route and 28
passing tests. It shipped **no way to add a driver**, and the `No ELD` tag on
one of nine surfaces.

Everything was green. `npm run check` passed. The feature was unusable.

### Why the tests could not have caught it

They test the server, and **nothing rendered a screen**. Not because nobody
wrote one, but because nobody *could*:

`tsconfig.json` says `"jsx": "preserve"` — correct, Next compiles the app —
and esbuild therefore defaulted to the **classic** JSX runtime under Vitest,
which needs `React` in scope. Any component containing JSX threw
`React is not defined` on render. The one `.tsx` test in the suite was a hook,
exercised through `createElement`, with no JSX at all.

So the suite could not render a component, had never rendered one, and nothing
said so. `esbuild: { jsx: 'automatic' }` in `vitest.config.ts` is a one-line
change that had been missing since phase 3.

### The tell

> "the `No ELD` tag will appear beside any driver you add by hand"

Written without opening the board. The seven design questions in the plan were
all answered — including "whether the UI shows the source" — and answering the
design question was treated as satisfying it.

### The same shape, five times

| § | rule present in | absent from |
|---|---|---|
| 12.21 | the modal's validation | the shared schema, then the server re-parse |
| 12.28 | the stop save's transaction | the override write beside it |
| 12.29 | the click handler | the render path that also wrote the URL |
| 12.32 | `vitest.setup.ts` | `globalSetup`, which runs first |
| **12.37** | **every server layer** | **the screen** |

The fourth cost a production database. This one cost a feature that reported
as done.

### The grep, which is the lesson from §12.21

Nine sites render a driver name. Fixing the three that were visible would have
left six, because **three separate data shapes never carried provenance at
all** — `FleetRow`, `BoardTruck` and `ReassignPreview`. Each now carries
`source` and `samsaraDriverId` rather than a precomputed boolean, so
`isEldBacked` stays the single implementation and the SQL does not grow a
second one (§12.35's name-matching lesson).

| site | |
|---|---|
| `DriverSelect` dropdown options | tagged |
| `DriverSelect` closed input | tagged |
| `AssignmentBoard` truck rows | tagged |
| `AssignmentBoard` drivers-without-truck panel | tagged — `Panel` takes nodes now, not strings |
| `TruckRow` driver column | tagged |
| `MapPopup` header | tagged |
| `MapPopup` Driver row | tagged |
| `ReassignConfirm` gaining / losing | tagged |
| `reassign.ts` summary prose | **deliberately not** |

The prose is excluded on purpose: those are sentences — *"Reassigns 137 from
Jo Martinez to Pat Lee."* — and a tag inside one reads as part of the name.
`ReassignConfirm` renders both names visually directly above that sentence, so
the information is present where it is legible.

### Placement

**"+ Add driver" lives at the bottom of the picker's dropdown**, surfacing
once a search returns two matches or fewer. That is the moment the need is
felt: a dispatcher types a surname, does not find them, and the answer is
directly under the empty result. A button elsewhere on the board is something
you have to already know exists.

It returns to the picker **with the new driver selected**, and refreshes the
board *before* selecting, so the row exists in `drivers` before the select
points at it. The affordance is only offered when the caller passes
`onDriverCreated` — a picker that offered it and could not show the result
would look broken.

**The merge prompt sits above the assignment board**, where a dispatcher is
already thinking about who is on what. Not deferred, because the worker
records a candidate every poll and acts on none: **an unshown candidate is
worse than an undetected one**, since the data claims the question was asked.

### What would have caught it

A smoke test that renders the board. Deliberately shallow — no layout, no
styling, no interaction depth — asserting only that what is claimed to be on
screen is on screen.

It counts tags rather than searching for the string, because
`toContain('No ELD')` passes if *everything* is tagged. And it is verified to
discriminate: reverted to the original `{truck.driverName ?? 'Unassigned'}` it
fails with `expected 1 to be 2`, and passes on the fix.

## 12.38 "Add and assign" created the driver and left the truck empty

Reported by the dispatcher who tried to use it. §12.37 described the
post-click behaviour — *"the board refreshes, the dropdown closes, and the
picker is left with Ada selected on that truck"* — without exercising it, two
commits after §12.37 was itself about describing UI that did not exist.

### Which half was missing: the assignment was never sent

Diagnosed before fixing, because the three candidates need different fixes:

1. **The picker does its part.** Probed directly:
   `SEQUENCE: ["onDriverCreated","onChange(d-new)"]` — one call, with the new
   id.
2. **The board took it and threw it away.** `router.refresh()` resolves
   *before* the new props arrive, so the order was: refresh → `onChange` →
   `setDraft(truck → d-new)` → ...new board lands... → `board.trucks` is a new
   array → `initial` recomputes → `useEffect(() => setDraft(initial))` →
   **wiped.**
3. **Even surviving, it was only a draft** needing a Save click, while the
   button said "Add and assign".

Nothing was rejected and nothing was written and lost server-side. It was
never sent.

### A test must fail for the reason you think it fails

**The clean example, and it is mine.** The first version of the click-through
test mocked `router.refresh()` as a no-op. The board never received new props,
so the reset effect never fired, and the test failed — on something *adjacent*
to the defect. It would have gone green against a fix that did not touch the
race at all.

The second version re-rendered from a fake server but reused the same board
object, so `board.trucks` kept its identity, the `initial` memo never
recomputed, and the test **passed against the very code it was written to
catch**. Only cloning the board on refresh — which is what a server render
actually delivers — made it fail correctly. And with a faithful mock it
immediately caught a second case the earlier version had missed: the
occupied-truck selection was being wiped too.

> **A mock that cannot express the bug cannot verify the fix.** It goes green
> against a wrong one.

This belongs beside the four isolation faults (§12.32) and the preflight gate
(§12.32) as the same discipline: a guard, a gate or a test must be shown to
fail on the broken code before its passing means anything.

### The defect was the reset, not this call site

`useEffect(() => setDraft(initial), [initial])` discards **every** local edit
whenever server data arrives. `router.refresh()` is called from three places
on that board, and any edit made in the gap is lost silently — no error, no
warning. Retiring a driver refreshes, and would have wiped a half-finished set
of assignments the same way.

Replaced with a **rebase**: server data becomes the new base and the
dispatcher's own edits are replayed on top, tracked in a ref so the tracking
does not itself trigger the effect. Their pending change wins over a
concurrent one, and the save's conflict detection adjudicates — rather than a
silent overwrite here. Cleared on save and on discard, when the server is the
truth again.

### Label matches capability

| truck | button | what happens |
|---|---|---|
| empty | **Add and assign** | created and assigned in ONE transaction (§12.28) |
| occupied | **Add driver** | created, selected in the picker; the existing reassignment confirm takes over on Save |

The occupied case is **refused server-side**, not confirmed: reassignment has
a two-sided confirm and a preview token (§9.10), and creating straight through
would bypass a confirmation the design requires. Refused means *nothing* is
written — no driver left behind by a failed assignment, which is the half-write
§12.28 exists to prevent.

The dispatcher learns no new path: on an occupied truck it behaves exactly
like picking any other driver.

### The edit modal was never checked

It had no `onDriverCreated`, so "+ Add driver" **was never offered there at
all** — while §12.37's walkthrough claimed "the same flow works in the edit
modal". The same error, in the same session, about a second surface.

It is create-only there even on an empty truck: the modal already assigns
inside its own save with the preview token (§12.28), so creating *and*
assigning server-side would write the assignment twice.

The picker now holds the driver it just created until the `drivers` prop
catches up, which removes the ordering dependency from both callers — the
board can refetch cheaply and the modal cannot, and an input that blanks after
a successful create looks like a failure.

## 12.39 The worker stalled for 5.5 hours and nothing said so

Truck 116's dwell was swallowed by a 34-minute gap in which the worker
ingested nothing, detected no arrivals and routed nothing. It was not an
incident. Counting the gap before every error in one day:

```
08:56  10.6 min      12:37  48.3 min      16:36  34.0 min
09:21  36.3 min      12:39  51.1 min      17:29  26.0 min
09:50  28.4 min      13:48   5.8 min
10:23  26.6 min      15:26  33.4 min
10:51  28.6 min
```

**Eleven stalls, 329 minutes — 5.5 hours of a 9.5 hour day.**

### Connection-level, and the log said the opposite

The 13 errors span four tables and both reads and writes — a `feed_health`
select, a `trucks` update, a `positions` insert, a `stop_routes` select. No
query is at fault.

The poll loop is correct: it catches, logs and continues 30 s later. So
`pollOnce` **hung**, and the error line marked the END of the outage. One line
saying "a query failed" where the fact was "the fleet has been unobserved for
34 minutes".

> **This diagnosis was wrong. See §12.52.** The cause was the host sleeping,
> not the database. The paragraphs below are kept because the changes they
> describe are still correct defensively and because the reasoning is worth
> being able to re-read — but they are not what was happening.

Two defaults were blamed:

- `createDirectDb` set only `connect_timeout: 10`, which covers CONNECTING.
  **There was no query timeout anywhere**, so a statement on a socket that had
  gone away waited for TCP to give up — 10 to 30 minutes.
- postgres.js defaults `max_lifetime` to `60 * (30 + Math.random() * 30)`: a
  **random 30 to 60 minutes per connection**, undocumented in our code, with
  two connections expiring independently. Mean stall 29.9 min was said to sit
  squarely in that band — which it does, and which turned out to be a
  coincidence fitted to a hypothesis (§12.52).

Every timeout is now stated regardless: `statement_timeout` 20 s so Postgres
kills the statement rather than us waiting on a socket, `max_lifetime` 10
minutes so recycling is a decision, `idle_timeout` 60 s. Worth having; not the
fix it was claimed to be.

### The staleness rule worked. That was not the problem

The board DID go stale: no positions written, `newest_position_at` frozen,
`isFeedStale` true after five minutes, every row's ETA reading `stale`.

It left **no trace**. On recovery Samsara returned the backlog,
`newest_position_at` jumped forward, the banner cleared, and `recordSuccess`
wiped `last_error` — which is correct, because `last_error` answers *is it
broken now*. Nobody could ask *has it been*.

So `feed_health` gained `missed_cycles`, `longest_stall_seconds` and
`longest_stall_at`, which nothing clears, and a successful poll following a
gap logs `poll stall ended` at WARN with the duration.

**A self-healing failure that leaves no record is worse than a loud one.** In
production nobody finds out until a dispatcher asks why a truck has not moved.

A test caught a real bug in that record: the stall columns were only in the
`ON CONFLICT` branch, so the first poll after the row was recreated (§12.34)
inserted defaults and dropped its own stall.

## 12.40 The ETA drifted with the wall clock

At 09:32 the board read 11:13; five minutes later, truck still moving, 11:18.

`project()` anchors to `position.recorded_at` correctly (§12.24), and both
renderers only format the stored instant. **The anchoring was never the
problem.** `projectDistance` returned `cached.routedMiles` unchanged while a
route was fresh, so:

> ETA = moving anchor + frozen distance = drift, 1:1 with the clock.

Measured on truck 116:

```
fix recorded_at    straight  routedUsed   ETA(UTC)
17:36:26             62.96      71.84     18:59:20
17:38:20             65.17      71.84     19:01:14
17:40:12             67.34      71.84     19:03:06
17:42:02             69.47      71.84     19:04:56

5.6 min of clock -> 5.6 min of ETA, while the truck covered 6.5 miles
```

**The whole 25-minute error was this.** The recompute threshold contributed
none of it — it decided how long the freeze lasted, not that it froze.

The straight-line distance is always current, so the fix is to subtract what
has been covered since the route was measured, scaled by the lane's own
measured ratio, clamped at zero.

### And it reversed the threshold decision

`max(10 mi, 15%)` was going to be replaced, because on an 85 mi run it gave
one recompute per ~13 miles and a truck 12 miles out could never trigger one
at all. Re-measured after this fix, with the residual error being ratio
divergence rather than elapsed time:

```
rule                    calls/day    85mi lane          12mi lane
current max(10,15%)         296     1.95 mi / 2.3 min   1.57 mi / 1.8 min
B  max(1, 12%)              630     1.57 mi / 1.8 min   0.22 mi / 0.3 min
D  0.5 + 8% remaining       815     1.13 mi / 1.3 min   0.22 mi / 0.3 min
```

**The threshold stays.** Tripling the API calls now buys one to two minutes.
The rule was never the defect; it was amplifying one. Deferring the number
until after the fix is the only reason this was not a wasted change.

## 12.41 An arrival the truck had left could never be found

`confirmedRun` walked the fixes newest-first and `break`ed on the first that
failed, so a run had to BEGIN at the newest fix — the truck had to still be
parked when the sweep looked.

Truck 116 parked at its receiver for 21 minutes during the 34-minute stall in
§12.39. By the next poll it had gone, the newest fix was moving, and the dwell
sitting two fixes behind it was unreachable. Not late. **Lost.**

It now takes the longest qualifying run anywhere in the window, which costs
one pass over a few dozen fixes.

### The spec asserted a guarantee the code did not provide

§12.27 said the 30-minute window *bounded* post-outage inaccuracy — "a truck
that parked three hours ago is recorded as arriving at the window's edge... a
bounded and stated inaccuracy". That was **false from phase 5 until this
fix**. The window decides how far back we look; `confirmedRun` decided that
looking back was pointless.

The paragraph is corrected in place rather than quietly deleted, because the
failure mode is worth keeping: **a spec line claiming a guarantee the code
does not provide is its own defect — it is what stops anyone looking.**

### One contract changed deliberately

A test asserted that one bad fix mid-dwell returns null. It now returns the
dwell around the glitch, and the test states why rather than being deleted. A
GPS glitch should cost the fixes around it, not the arrival.

## 12.42 A counter cannot say which day

§12.39 added `missed_cycles`, `longest_stall_seconds` and `longest_stall_at`
to `feed_health`, and they were the right columns for the question that had
been unanswerable: **has this ever been broken?** They answer it and nothing
clears them.

They cannot answer **was it broken yesterday**, which is the question the
morning after a fix. A cumulative total and an all-time maximum have no day in
them. The §12.39 diagnosis — eleven stalls, 5.8 to 51.1 minutes, 329 in total
— was only possible by reconstructing gaps out of `positions`, inside a
retention window that deletes the evidence after seven days.

So `feed_stalls`: one row per stall, written by the poll that recovers it. A
stall is rare and a row is 40 bytes, so the distribution is readable from psql
months later without the worker's stdout.

### A startup line is the wrong place for a daily report

The obvious implementation logs the previous day at startup. It is also
exactly backwards: **if the fix works, the process runs for weeks and the
report never prints.** The line that says "yesterday was clean" is the one
that only ever arrives after a restart, which is to say after a failure.

The report is emitted on a UTC day rollover from inside the poll loop, and
also at startup — the second for a process that has just come up, the first
for one that never does.

### The zero that would have lied

On the first morning after this table ships, the day before it has no rows.
Reporting `0 stalls` for the day that in fact lost 5.5 hours would be worse
than reporting nothing at all: an absence of records rendered as good news.

`feed_health.stall_log_since` records when the log began, so an unrecorded day
can be told from a quiet one. It is checked rather than inferred from the
absence of rows, because that absence is precisely the ambiguity — and the
distinction is carried by the message string, not only by a field, since
"no stalls" and "not recorded" read identically at a glance and only one of
them is good news.

A missing `feed_health` row counts as unrecorded for the same reason. §12.34
deleted that row once already.

## 12.43 Silence meant two different things

`MergePrompt` loaded its candidates in a `try` whose `catch` was empty, with a
comment for a body: *"a prompt that cannot load is not worth an error on the
board."* Two lines above it, a non-2xx response `return`ed into the same
nothing.

The component then rendered `null`, which is exactly what it renders when the
roster is clean.

That is §12.35's own stated failure mode, executed by the surface built to
prevent it. The worker records a candidate every poll and acts on none of
them — **an unshown candidate is worse than an undetected one**, because the
data claims the question was asked and nobody was asked anything. A dispatcher
sees an untroubled board either way, and the duplicate accrues assignment
history against the wrong row.

### The fix is a distinction, not a message

`checked: 'loading' | 'ready' | 'failed'` separates **whether the check ran**
from **what it found**. They had been one thing, and that one thing was
`candidates.length === 0`.

- `failed` renders a neutral line and a Retry. Neutral, not alarming: nothing
  is wrong with the fleet and there may well be nothing to merge — we do not
  know, and not knowing is what the neutral token means everywhere else.
- `loading` renders nothing, because a pending request is not a failed one.
- `ready` with nothing found renders nothing, and **that silence is earned.**

Three things now count as a failure to check rather than as an absence of
candidates: a rejected request, a non-2xx response, and a body without a
`candidates` array. The middle one had its own `return` and the third would
have thrown into the empty catch.

### Where the error goes

Both: a line on the board for the dispatcher, who needs to know the check is
not running, and `console.error` with the cause for whoever has to find out
why. **Neither one alone is a handler** — a message says what, never why, and
a console line nobody has open says nothing at all. The two mutation catches
in this component and in `AddDriverInline` kept the cause for the same reason;
they were already telling the user, and were throwing away the half that
answers a bug report.

### The rest of the greps

Every other bare `catch {}` in the source was checked rather than assumed, per
§12.37. `Split.tsx` (localStorage in private browsing), `url.ts`, `env/schema.ts`
and `appointment.ts` (parse failures returning a documented fallback) and
`supabase/server.ts` (a cookie write from a Server Component) are all
deliberate, stated, and lose nothing anyone needs. A rule that fires on every
instance of a syntax is not the rule; **swallowing a fact somebody needs** is.

## 12.44 State and ZIP normalise in the schema, not in the modal

`state` was `z.string().trim().length(2).toUpperCase()` and `zip` was
`blankIsNull(12)`. Both are now normalisers in `lib/stop-edit.ts`, beside
`blankIsNull` and for the same reason.

```
ZIP                          State
'60601'      -> '60601'      'il'       -> 'IL'
'60601-1234' -> '60601'      ' il '     -> 'IL'
'606011234'  -> '60601'      ''         -> null
' 60601 '    -> '60601'      null       -> null
''           -> null         'illinois' -> 400
null         -> null         'i1'       -> 400
'6060'       -> 400          'I'        -> 400
'abcde'      -> 400
'60601-12'   -> 400
```

Dispatchers paste ZIP+4 off rate confirmations. Everything we do with a ZIP is
geocoding, Census matches the five and ignores the +4, so storing it adds a
field that can disagree with itself and buys nothing — and a stored
`60601-1234` silently degrades the geocode the whole ETA chain hangs off.

### The layer, which is the actual subject

The modal's own `trimmed()` nulls a blank before validating, so **the UI can
never produce the bad shape and an API client always can.** That is why the
load-number and city empty-string bugs survived three sessions: every layer
that could see the defect was downstream of the one that hid it. An API client
posting `{"state": "il"}` must get `IL` stored or a 400.

### Two rules for one intent

`.length(2)` rejected `''` — not as a decision, but as a side effect of a
length check meeting a zero-length string. So clearing the state meant `null`
while clearing the city meant `null` OR `''`. **Two rules for one intent is
how layers drift apart**, so `''` now means null in every text field on the
stop.

The same `.length(2)` accepted `'i1'` and `'1!'`. A rule that does not say
what its name claims is worse than an absent one, because the name is what
stops anyone checking.

### And one layer further down

`stops_state_two_letters` and `stops_zip_five_digits` are CHECK constraints
(0013). The schema covers every path the current code takes — and the seed
script and the geocoder both write these columns **without going through
`StopEdit`**. A rule enforced where today's code happens to go and absent
where tomorrow's will is the shape of every bug in this session.

A 500 on a bad write beats a quietly wrong row. No backfill: all 56 stops
already conformed, checked before the migration was written rather than after.

### The optimistic patch was already right, and now says so

`EditStopModal` patches the cache from `parsed.data`, which §12.21 fixed and
nothing asserted. The two shapes now differ in two more fields than they did
then, so the regression was one edit away and silent: a dispatcher who types
`il` and sees the row read `il` until the refetch corrects it sees a glitch,
not a bug, and does not report it.

Locked by a test that fails with `expected 'il' to be 'IL'` when the patch is
switched back to `edit`.

## 12.45 The header circle was a span

`ConsoleHeader` rendered `SL` in a box with nothing behind it, for four
phases. There was no way to sign out of the console, and no way to see which
account you were on.

It is now a menu: name, email, role, **Edit display name**, **Sign out**.
Initials only — no picture and no upload path, because a Storage bucket and
its RLS policies are not worth writing to tell five accounts apart. The
initials are derived from `full_name` rather than passed in, so there is one
implementation of what `Mary Anne Fitzgerald` shortens to (`MF`, not `MA`).

The display name is the only profile field anyone can change about
themselves. `role` is admin-only and set elsewhere; `email` is the auth
identity, and changing it is an auth flow rather than a profile edit.

### A rename is a write to history

`full_name` is JOINed into override attribution — `fleet-query` selects
`p2.full_name as set_by_name` — so renaming yourself silently rewrites how
every past override reads.

That is history changing with no record of the change, which is the same thing
the driver merge does when it repoints assignments, and **that was only
acceptable because the audit entry names both rows.** So a rename writes an
audit entry with both names, in the same transaction as the update.

A rename to the identical string writes nothing at all. An audit row saying a
name changed to itself is noise in the one log that has to stay readable.

`'profile'` joins the closed `AUDIT_ENTITIES` set, whose own comment explains
why that deserved a test: a typo there writes happily and the row is simply
never found again by the screen that eventually looks for it.

### `useFocusTrap` is not a menu

The dismissal logic that existed was `useFocusTrap`, and only its **return
focus to where you were** half is right for a menu. A Tab trap is a modal's
contract; a menu should let Tab leave and close behind it. Reusing the whole
hook would have made the menu a dialog that cannot be tabbed out of, which is
worse than writing nothing.

So `useReturnFocus` is split out and shared, and the menu adds Escape,
outside-click and Tab-out itself. Grepped first, per §12.37: focus-restore
existed in exactly one place, so this is the second consumer rather than the
second copy, which is where drift starts.

### The test that proved nothing

The first version of "closes on Escape and gives focus back to the circle"
**passed with `useReturnFocus` commented out.** It opened the menu without
ever focusing anything inside it, so the trigger still held focus and the
assertion was trivially true.

Focus has to have MOVED for the return to mean anything. The test now tabs
into the menu first, and fails with `expected <body>` when the hook is
removed — a stranded keyboard user, which is the actual defect.

Third instance this session of §12.38's rule: **a test must fail for the
reason you think it fails.**

### Still untested

The server action itself. `updateDisplayName` calls `requireUser()`, which
needs a real Supabase session, so the component tests mock it at the module
boundary and assert what the menu *sends*. The action's own path — session,
parse, transaction, revalidate — is browser-shaped, and belongs on the phase 6
Playwright list rather than being faked here.

## 12.46 Enter had two owners

`TruckRow` handled Enter and called `onSelect`. It called `preventDefault` but
not `stopPropagation`, so the event carried on to Console's `window` listener,
which opened the edit modal on `selectedId`.

That `selectedId` is the one captured in the effect's closure — the value from
**before** the row's `setSelectedId` was queued. React will not re-run the
effect in the middle of dispatching one event.

So: select row A, Tab to row B, press Enter. **The modal opens on A**, and B
becomes selected. Reproduced as `expected '101' to be '202'`.

It worked for four phases because the two paths agreed whenever focus and
selection agreed, which is every mouse interaction. Tab is the one gesture
that separates them.

### Two cursors, and the key has to say which it means

DOM focus moves with Tab. `selectedId` moves with a click or the arrow keys —
and the arrow keys deliberately do **not** move DOM focus, because the list is
virtualized and focusing a row that is about to be recycled is its own bug.

So Enter means: **the focused row when there is one, the selection otherwise.**
It also selects what it opens, so the map is never showing a different truck
from the modal.

Console owns the key. The row carries `data-row-id`, which is how the one
handler resolves what has focus, and the row's own `onKeyDown` keeps Space and
nothing else. **Two owners agreeing by luck is not agreement.**

### Why nothing caught it

Nothing in the suite mounted the console. Two things had to exist first:
components rendering at all (§12.37), and a stated layout — happy-dom computes
none, and `@tanstack/virtual` measures the scroller with `offsetHeight`, so an
unmeasured list renders zero rows and looks exactly like a broken one.
`src/test/layout.ts` states a size; the components still run their own logic
against it, including the 6/8 column switch.

## 12.47 Miles in the row, without moving a column

The ETA cell showed the time alone, with miles in the tooltip. That was
decided when the column was assumed to be tight. Measured in Chromium against
the real Barlow at the real sizes:

```
14:18 CDT        64.0px    the ETA column is 100px
09:05 CEST       70.6px    a four-letter zone, the worst normal case
no ETA           40.7px
arrived          40.7px
stale            28.0px
412 mi (small)   38.0px
~412 mi          45.3px
~1204 mi         52.6px
412 mi · 14:18 CDT  115.5px   ← inline does not fit, and never did
```

Two things fell out of that. **Inline needs the column at ~138px**, which at a
1728 viewport takes 38px from the two flexible columns — they only have 341px
between them, and at the 8-column floor (900px of list) only 204px. And **the
degraded strings are all shorter than the normal one**, so the column's worst
case is `14:18 CDT`, not `no ETA`.

So the miles go **under** the time, and nothing moves.

### The second line is out of flow, and that is the whole trick

Stacked normally the two lines form a 35.3px block, which `items-center`
centres in a 44px row. Measured:

```
variant   rowH   apptMid   etaMid   delta
none        44        22       22       0
block       44        22     13.4    -8.6   ← the ETA time, 8.6px too high
abs         44        22       22       0
```

Two adjacent numeric columns out of line by 8.6px reads as a bug. Absolutely
positioned at `top-full`, the time stays exactly where it was and the miles
sit at 42.6px of the 44px row.

This is the same reasoning as the Appt cell's fixed 18px prefix slot: the
annotation gets its own space so the **number** never moves.

### The pair has to read as one unit

The first version placed the line at `top-full` and no more. Measured on a
full board of LATE rows, that was wrong twice over:

```
                    eta baseline   miles baseline   gap   to row edge
top-full, 11.5px            26.4             40.6  14.2           1.9
-mt-1,    10.5px            26.4             35.6   9.2           6.9
```

A 14.2px gap with 1.9px of clearance does not read as a caption under a time.
It reads as something sitting in the gutter between two rows, belonging to the
row below as much as its own.

`-mt-1` closes the pair to 9.2px and lifts it to 6.9px of clearance. The time
does not move: 26.4px in both, and the alignment below still holds.

`text-micro` needs `tracking-normal` with it — the micro size is drawn for
uppercase condensed labels and carries .11em, which is wrong under a number.

### Weight: the time is the decision

At `text-text-secondary` the miles were the same ink as the time above them,
and on a LATE row the eye landed on the number underneath. That is backwards.
**Both** signals were changed: 11.5px to 10.5px, and secondary to muted — one
token below the time.

Size alone was not enough. Measured side by side, 10.5px secondary still
competes with 12.5px secondary; the token step is what makes the miles recede.

### Which cost the third basis

```
routed        412 mi     measured for THIS position
not routed   ~412 mi     not measured for where the truck is now
```

This shipped with three, splitting `lane-estimate` from `straight-line` by
colour. Dropping the miles to muted leaves nothing below muted, and a fourth
level was measured and rejected: **#6f777e is indistinguishable from muted
#858d94 at 10.5px, and #656d74 is distinguishable only by being hard to read.**
Inventing a token that does not separate is worse than not separating.

So the split is made where it changes a decision, which is §12.33's own rule.
Both non-routed bases say the same thing to a dispatcher — trust it less, open
the popup — and `basisShort` keeps all three apart there, where words fit.

**This is a reduction from what was approved.** It is recorded rather than
quietly applied, because the reasoning is a constraint discovered by
measurement and not a preference.

### When there is no second line

Four cases, each for its own reason:

- **feed stale** — the time already reads `stale`, and a precise mileage under
  it would undo that in the same glance (§5.9);
- **arrived** — no miles left worth printing;
- **suppressed-unassigned** — the strike says "this number is not being
  maintained", and live miles under it would contradict it;
- **under ten miles**, where `milesText` says `arriving` — a word, not a
  number, and the line exists to carry the number. It is also the only string
  here with a descender, which is what would have reached the row's border.

### What the tests can and cannot see

happy-dom computes no layout, so the alignment property — the entire reason
for the design — cannot be asserted in the suite. It was measured in Chromium
and is recorded above. What the test asserts is the **mechanism**: that the
miles element is `absolute top-full`. A test that cannot see the property has
to say which proxy it is checking instead.

## 12.48 Double-click opens the edit modal

The mouse form of §12.10's Enter, not a new behaviour. The whole row, with the
status chip excluded — it is the only cell likely to grow a click target of
its own.

Not a subset of cells: a gesture that works on five columns of eight is
unlearnable, and a dispatcher who finds it on the driver column and finds it
dead on the truck column concludes the app is broken.

### The collision, and why the row stays selectable

Nothing in the console is `select-none`, so double-click's existing meaning is
"select a word" — and the truck number, the load number and the address are
exactly the things somebody copies out of a row.

Disabling selection would buy a clean gesture at the price of a real one. So
the handler calls `getSelection()?.removeAllRanges()` instead: click-drag
copying keeps working, and only the stray word-select goes — which the modal
would have covered anyway.

Selection needs no extra work. `dblclick` is preceded by two `click`s, so the
existing `onSelect` has already run and the map is already on the right truck.

## 12.49 The ETA carries the status colour

Verified cell by cell against the drawn LATE row in `Fleet_Tracker_dc.html`,
because the brief does not say this anywhere and §4.1 gives every column's
type with no colour at all:

| Cell | Ink | Weight |
|---|---|---|
| stripe | `status.late.fg` | — |
| Truck | `text.DEFAULT` | 700 |
| Driver | `text.DEFAULT` | 400 |
| Position | `text.DEFAULT` | 500 |
| **Next stop** | **`text.secondary`** | 400 |
| Appt | `text.DEFAULT` | 600 |
| **ETA** | **`status.late.fg`** | 500 |
| chip | `status.late.fg` on its bg | — |

Consistent across every drawn state — AT_RISK amber, ON_TIME green, STALE_GPS
`stale` in muted, UNASSIGNED struck through in muted. **The Appt time is
`text.DEFAULT` in all of them**, which is exactly what §5.9 means by
"appointment times stay full strength": it is the one number that never
carries feed-derived colour, and that is what makes it trustworthy when the
feed dies. Colouring it would have put the offline rule in direct conflict
with itself.

### Why not the address

§6.2 ranks **Next stop 1st in the truncation ladder** — the most expendable
cell, first to drop its dock detail, first to ellipsise, and below 900px of
list width the only flexible column left, absorbing all the narrowing alone.
A signal belongs on a cell that is always complete, and §6.2's never-truncate
set is exactly where the design put it.

### Measured against every ground

§5.2 publishes base and selected. These are all four, including hover, which
it never gave:

```
ink                        default      hover   selected  unassigned
LATE    #ff8a7a               7.78       7.06       7.00        7.31
AT_RISK #f2b23f               9.52       8.64       8.56        8.94
ON_TIME #5ed69b               9.82       8.91       8.83        9.22
ARRIVED #9cc4e8               9.74       8.84       8.76        9.15
TOMORROW/NEUTRAL #858d94      5.29       4.80       4.76        4.97
```

**LATE on a selected row is 7.00. That is the floor, with no margin.** The
design holds itself to 7.0; this pair is exactly on it and any change to
`row.selected` moves it below. **Do not adjust that ground without
re-measuring this pair.** The published 7.78 and 7.00 were reproduced
independently here, which is the check that the method is right.

`#858d94` is below the 7.0 bar on every ground, and it is also `text.muted` —
already used as row text on TOMORROW rows, so it is a pre-existing pair rather
than a new one.

### The four refusals

- **feed stale** — §5.9 withdraws schedule colour fleet-wide. The cell reads
  `stale`; it must not read it in green.
- **unassigned** — the strike says this number is not being maintained. Status
  ink would argue the opposite in the same glance.
- **`no ETA` and `—`** — not times. Colour would make "we cannot project this"
  look like a schedule judgement.
- **a forced override** — not a refusal but a redirection: the ink follows
  `row.status`, not `row.computed`, so the ETA and the chip it sits beside can
  never disagree (§9.5).

## 12.50 One toast, chosen by counting

§9.11 specifies three toasts and makes status-change toasts "opt-in per chip".
There is no settings surface, and building one for a single preference is the
wrong order: **narrow the event set until the preference has nothing to do.**

### Two of the three are not built

- The green `Undo` toast has **no undo behind it anywhere in the codebase**,
  and History is deferred (§13). A toast whose action word does nothing is
  §12.35's shape — a surface claiming a capability that is not there.
- The red save-failure toast already has a better home: the modal the
  dispatcher is looking at, which renders the error with `role="alert"` and
  keeps it until they deal with it. A toast would be a worse copy that expires
  after six seconds.

### LATE only, and the counting that decided it

`scripts/status-transitions.mts` replays the real engine over the positions in
the database. Over 20 hours, 28 trucks with an open stop:

```
                crossings   distinct truck+stop   worst hour
into LATE              10                     6            2
into AT_RISK            4                     4            1
```

**All four AT_RISK crossings were followed by a LATE crossing on the same
truck and stop, 17 to 49 minutes later.** So an AT_RISK toast flags no truck
that LATE does not, and interrupts twice about one deteriorating situation —
which is precisely the pattern that teaches people to ignore toasts.

After the suppression rules, six toasts in twenty hours: about one every three
hours. Quiet enough to be read, frequent enough to be worth having.

### Six rules, and the one the data forced

1. **First load.** No previous poll is a starting position, not a transition.
   Every LATE truck on the board is not news; it is the board. This also
   covers a mid-shift refresh.
2. **The feed.** When `feedStale` flips, every row changes at once — 23 toasts
   for one event, none of them about a truck. Suppressed on both edges,
   because the return is as synchronised as the departure.
3. **A truck that was not there a poll ago** has not crossed anything; it has
   arrived in the query.
4. **The fog states.** `STALE_GPS`, `NO_APPT` and `UNASSIGNED` mean "we do not
   know", not "everything is fine". Leaving one is the fog lifting on a fact
   that was already true.
5. **A forced status.** The dispatcher who set it does not need telling what
   they typed. Checked on the new row, so an override *lifting* to reveal a
   real LATE still toasts.
6. **Once per truck and stop per dispatch day**, persisted, so a refresh does
   not re-announce a truck already dealt with. Keyed by stop, so the same
   truck going late on its next load is a new fact.

Rule 4 is the one measurement produced rather than reasoning. **Truck 138
reports GPS once an hour**, so it cycled `LATE → STALE_GPS` (at the 45-minute
threshold) `→ LATE` three times in one morning while being continuously and
unchangingly late. Truck 124 did the same later the same day.

**That is why the fix is a ledger and not a debounce.** The flapping has a
sixty-minute period: any debounce short enough to be useful lets it through,
and one long enough to catch it would swallow genuine crossings on other
trucks. A time window cannot express "this fact has already been reported".

### The surface

Bottom-left, 6s, three at most, per §9.11 — `surface.overlay`, hairline on
three sides, 3px status-coloured left border, action word in `accent`.
`role="status"` with `aria-live="polite"`, never `alert`: *"a toast is an
echo, not the notification — the row and the marker have already changed."*

## 12.51 A pasted date is a test that depends on when it runs

`override.test.ts` pasted `2026-09-18` as its fixture appointment. It passed
for as long as that date was in the future, and the moment the clock reached
the 19th `setOverride` refused the write — "that expiry is already in the
past" — and the suite went red on a day when nothing had been touched.

CLAUDE.md already says to derive dates in code and never paste one. It says it
about DST, but the reason is more general: **a pasted date is a silent
dependency on the calendar.** The fixture now derives tomorrow in the dispatch
zone, so the appointment is in the future whatever the hour the suite runs at.

The assertions changed shape with it. `expect(expiry).toBe('2026-09-18T20:00:00.000Z')`
became two statements that survive a date change and say more:

- the expiry **is** the stop's own `appointment_end_utc`, read back from the
  row the edit path wrote — which is the actual contract the test is named
  after, and was only ever implied by the literal;
- read back into the stop's zone it says `15:00`, which is the 14:30 + 30
  minute arithmetic the literal carried, and is now correct under either
  offset rather than only under CDT.

### The blast radius, checked rather than assumed

`expiry is already in the past` is the **only** rule in the codebase that
requires a future instant. The other 90-odd pasted dates in the suite are in
tests where a past date is legitimate — appointment conversions, stop edits —
and several are pasted precisely because the conversion is the subject.

## 12.52 The worker was not stalling. The laptop was sleeping

§12.39 diagnosed eleven stalls a day as a database problem — no
`statement_timeout` plus postgres.js recycling connections on a random 30-to-60
minute `max_lifetime`. Every timeout was stated, the worker was restarted, and
§12.42 was built to answer the question the next morning.

**It answered it. The answer was no.**

```
feed_health   missed_cycles 298   longest_stall 3934s (65.6 min)
feed_stalls   19:44:41Z -> 20:26:00Z   41.3 min
              20:26:37Z -> 21:09:19Z   42.7 min
              21:50:51Z -> 22:56:26Z   65.6 min
```

Three stalls, all **after** the fix. And then `pmset -g log`:

```
stall 1 started  19:44:41Z   Clamshell Sleep at 19:44:49Z    8 seconds
stall 3 ended    22:56:26Z   Wake        at 22:56:14Z       12 seconds
```

The lid was closed. macOS then ran a maintenance-sleep cycle every five
minutes, which is why the gaps are 40-65 minutes of mostly-asleep rather than
one clean block: the worker got a poll in during some of the wakes.

The same log shows **233 sleep events during the previous working day**,
beginning with a clamshell sleep at 08:45:46Z — inside the window the original
eleven stalls were measured in. The first diagnosis almost certainly described
the same thing.

### What was actually wrong with the reasoning

The evidence genuinely fitted: reads and writes across four tables failing
alike does point at the connection rather than the logic, and a 29.9 minute
mean does sit inside a 30-to-60 minute band. But **a suspended process
produces exactly the same evidence** — every query fails, whatever it touches,
and the gaps are shaped by whatever the host does rather than by anything in
the code.

I had one hypothesis that fitted and stopped looking. The distinguishing test
was cheap and never run: *was this process running during the gap at all?*

### What survives

- The **instrumentation is right and is what found this.** §12.39's columns
  and §12.42's per-stall rows did their job precisely: a stall outlived its
  recovery, and the morning-after report said the fix had not held. That is
  the whole point of recording an outage rather than an error.
- The timeouts are worth keeping. A query with no timeout is a bug whether or
  not it caused this one.

### What it means

**A worker on a laptop is not a worker.** `worker/index.ts` already says it
should run "as its own Node process on a small VM"; until it does, every
`feed_health` figure includes the host's sleep schedule and none of them
measure Supabase.

So the stall diagnosis is **not re-openable from this machine.** It becomes a
phase 6 question, answered by the first day of numbers from the deployed
worker, and the counters are only evidence about the database once the process
is somewhere that stays awake.

## 12.53 The audit, and the four things it found that were already broken

A systematic gap audit before phase 6, read out of `PROJECT_BRIEF.md` and
this file rather than out of memory, and checked against the code rather than
against a recollection of having built it. §12.37 is why: a feature reported
done with 28 passing tests and no UI at all.

Most of what it produced is a list of things that were never built, which is
a scoping question and not a ruling. Four items were different — they were
**specified, apparently built, and wrong**, and three of them could only be
found by reading the document beside the code.

### 1. The documents disagreed with themselves

The §12 rulings carry brief-level authority and supersede both other
documents, and neither other document was ever amended to match. So the
precedence was clear and the reading order was not: anyone starting from
`CLAUDE.md` or the brief got the superseded answer first.

- **`CLAUDE.md` held the older load-number rule.** Its never-build list read
  "Load-number format validation. Non-empty and trimmed, nothing more."
  §12.21 makes load numbers **permanently optional** and says do not
  reintroduce the constraint. This was the worst of the set, because
  `CLAUDE.md` is the file every session reads first and its rules override
  everything — the one place a stale rule gets re-implemented rather than
  merely believed. §12.21 took four passes to finish; a fifth was one session
  away.
- **`PROJECT_BRIEF.md` carried five stale facts**: the ≥30 min LATE grace and
  `lateThresholdMinutes` (§12.1), `facility_name` / `dock_door` /
  `loads.broker` in the data model (§12.20), cluster counts as on-time and
  tomorrow only (§12.5), the straight-line ETA as the current one (§12.31),
  and urgency groups without §5.7's "specified, not built".

Both are corrected in place, each pointing at the ruling that moved it. **A
ruling that supersedes a document has not landed until the document says so**
— precedence is a rule for resolving a conflict, not a substitute for not
having one.

### 2. The dispatcher note was destroyed by every save

`EditStopModal` initialised its note box to `''` and never loaded the stored
value. `StopEdit` required the key. `updateStop` wrote it unconditionally,
along with `note_by` and `note_at`. So opening a stop that carried a note and
saving **anything at all** — a load status, a city — nulled the note and its
authorship, and the dispatcher who did it could not see that there had been
one.

This is **§12.23's broker wipe, a third time**, in the field whose own label
promises it is *visible to the next shift*:

```
loads.broker            column existed, form did not render it, write listed it
loads.load_number       four layers, four passes (§12.21)
stops.dispatcher_note   form rendered it, never LOADED it, write listed it
```

A new failure mode in the same family: the first two were fields the form did
not own, and this one the form did own and had never populated. **A form that
renders a field it did not load is a delete button with a text cursor in it.**

The fix is the §12.21 mechanism, unchanged, plus one addition:

1. `dispatcherNote` is `.optional()` — omitted means leave it alone.
2. The modal loads the stored value, so the box shows what is there.
3. **`note_by` and `note_at` move only when the TEXT moves**, compared
   against the stored value on the server. This rule only exists *because* of
   the load: a modal that now sends the same note back on every unrelated save
   would otherwise re-stamp the authorship of somebody else's note with the
   current user and the current time — §12.45's rename, in a column.

The note is carried on `FleetRow.nextStop` so the modal can load it. **Nothing
renders it on the board yet** — the detail panel (§9.4) is where it belongs
and does not exist, so a note is still a thing you can write and only find
again by opening the same modal. That is a gap; it is no longer a shredder.

> **The test that had to be rewritten.** The authorship test first asserted
> `note_at` and passed against the broken code: `now()` in Postgres is the
> TRANSACTION's start time, and the harness runs both saves in one rolled-back
> transaction, so the two stamps were identical whether or not the column was
> rewritten. It asserts `note_by` with two distinct actors instead. §12.38's
> rule, met again from a new direction: a test must fail for the reason you
> think it fails, and "it passed" is not evidence that it could have failed.

### 3. The board went grey and nothing said why

§5.9's fleet-wide withdrawal shipped in phase 5. §9.8's banner and §9.1's sync
cluster did not. The result was the worst available pairing:

| What the dispatcher saw | What it meant |
|---|---|
| Every row dimmed to .72, every stripe dotted | the feed is down |
| Every ETA reading `stale`, every chip neutral | the feed is down |
| A **green** dot reading **`Synced 12s ago`** | everything is fine |

A board that looks broken with nothing claiming to be broken reads as **the
app failing, not the feed**, and the dispatcher's next move is to reload the
page rather than to phone whoever owns the worker. The dimming was doing half
a job and the header was actively arguing against it.

The header's half had a specific and instructive cause: `feedNewestAt` was
**declared in `Props` and never destructured**. TypeScript accepts a prop
nobody reads, so typecheck, lint and 644 tests could all pass over it. The
call site had been passing the right value down for two phases.

Two numbers, and the distinction is the point:

- **`fetchedAt`** — how long ago the browser talked to us. Stays healthy while
  the feed is dead, which is exactly why it must not be the only one shown.
- **`feedNewestAt`** — how old the positions are. The number a dispatcher is
  actually deciding on.

So the dot goes `status.late.fg` and the label becomes `Last sync 06:41 · 9m
ago`, naming the instant as well as the age because the instant is what gets
said down a phone. The banner carries the spec's sentence, including the
clause it exists to deliver — **do not quote an ETA from this screen** — with
the age in words, because `9m` is the chip's format and not this sentence's.

Two details worth keeping:

- **The countdown is real.** `auto-retry in 14s` counts from the fetch instant
  plus the actual poll interval. A number that describes nothing is worse than
  no number: the first time a dispatcher watches it reach zero with nothing
  happening, every other countdown in the product stops being believed.
- **`feedNewestAt` can be null** — §12.34's singleton, on a fresh deployment or
  a worker that has never completed a poll, and `isFeedStale` returns true for
  it. `since —` would read as a formatting bug, so both surfaces say the true
  thing instead: `No position has ever reached this database`.

`status.late.dim` (`#d79b91`) is added for the countdown: **6.45** on
`status.late.bg`, against 6.58 for `late.fg` on the same ground. A step down
in weight, not in legibility.

### 4. `trucks.active` could not be flipped from anywhere

§12.14 built the `Inactive` chip because the Samsara stats feed returns every
vehicle ever registered, some dead since 2019, and made the edit modal the
only surface the flag is editable from — "No separate admin screen."

The checkbox was `defaultChecked`, uncontrolled, with no `onChange`, and was
never sent. `/api/trucks` and `setTruckActive` — role-gated to `admin`, with
an audit row, inside a transaction — had **zero callers**. §12.37's shape a
sixth time, and this one was visible from the chip: the console could show you
an inactive truck and offer no way to change it, which §12.14 had already
named as the failure ("without a way to see and flip inactive trucks, seeding
is a dead end").

It is **its own request, not part of the stop's save**, because it is a
different entity behind a different gate: `/api/stops` requires `dispatcher`
and `/api/trucks` requires `admin`. Folding an admin-only field into a
dispatcher-level transaction would have made the whole save admin-only, or
made one of the two role checks a lie. Same reasoning as `Clear now` keeping
its own request (§12.28). It fires **after** the stop save — a truck vanishing
from the console while its stop failed to save is the worse half to land
alone — and a refusal surfaces as a warning saying the stop DID save, so
nobody redoes work that landed.

### What was ruled and not built

- **Trailer is cut.** §9.9 put it in the assignment grid, §9.4 under Load &
  contacts, §3 in the ultrawide column set — and no data model ever had a
  column for it, including §12.20's prune, which does not mention it either
  way. Dispatchers type a trailer number on paperwork, not here, and its grid
  slot is now §12.14's `Active` checkbox. **Recorded as cut, not pending** —
  the distinction §12.20 exists to protect.
- **Google Workspace stays unbuilt.** The brief offers it ("or Google
  Workspace if they want it later"); §9.12 draws it as a 46px secondary
  button with no qualifier. The brief wins: it is OPTIONAL, and the button
  does not render until somebody asks for it.
- **Toast preferences move from deferred to superseded.** §12.15 lists them
  under "Deferred to v2" because `2h` made status-change toasts opt-in per
  chip and there was no settings surface. §12.50 resolved it by narrowing the
  event set until a preference had nothing to do. There is nothing left
  deferred.

## 12.54 A radius sized from one truck, and a sweep that could not say why

Truck 132 showed `LATE`, ETA 19:41 EDT, against a 10:00 appointment, parked
0.2 mi from its receiver with the load marked `At receiver` by hand. Four
things were wrong and one was not.

### What was not wrong: the ETA

```
fix          40.934355, -75.949289  @ 23:41:31.526Z  0 mph
stop         40.93735438403, -75.953783147648  (street, census:in-range)
straight     0.3130 mi   × roadFactor 1.25 = 0.3913 mi   ÷ 52 mph = 27.1 s
ETA          23:41:31.526Z + 27.1 s = 23:41:58.613Z = 19:41:58 EDT
```

19:41:58 EDT **is** 23:41:58 UTC — the current time. The fallback produced a
27-second travel time, which is the tiny number a 0.3-mile gap should produce.
`LATE` was then correct arithmetic: the deadline was 14:00Z (10:00 EDT) and
the projection was 9.7 hours past it, because the stop had been re-pointed at
23:38 to an appointment already nine hours old. §12.24's anchor rule held
throughout. **See §13.6** — what defeated the reading was the presentation,
not the computation, and that is recorded as an open question rather than
patched.

Load status is deliberately not an engine input, and stays that way.
`AT_RECEIVER` is a dispatcher's claim, `arrived_at` is a measurement, and
§12.27 exists because those are different. A dispatcher who wants to overrule
the engine has §9.5's override, which carries a required reason, a mandatory
expiry and the computed status rendered beside it. Letting a dropdown built
for billing state silently suppress `LATE` would be an override with none of
those.

### The sweep could not answer the question asked of it

Every poll line for eight minutes read:

```
"routed":0,"routesSkipped":20,"routesFailed":0,"routeReasons":{}
```

`routeReasons` was empty in all 289 poll lines in the log, because a reason was
recorded only for a lane that was ROUTED or that the provider refused. Both
skip branches did `skipped += 1; continue`. So twenty lanes correctly left
alone and one lane dropped by the wrong rule produced identical output, and
diagnosing it took four database queries against a log that had the answer and
was not printing it.

This is §12.36's `arrived: 0` again — the number that could not distinguish
"nothing to report" from "the rule is broken" — and `explainNearest` was built
to fix precisely that on the arrival side. The routing sweep never got the
equivalent.

Now every candidate leaves through one `record()` call and lands in exactly
one outcome:

| outcome | meaning |
|---|---|
| `routed` | a call was made; `routedBecause` says which `needsRecompute` reason paid for it |
| `route-current` | the cached route still describes this lane — the resting state |
| `too-close` | under `MIN_ROUTABLE_MILES` (0.5) |
| `failed` | the provider refused; `failures` keeps its reason |
| `cycle-cap` | this poll had already spent `MAX_PER_CYCLE` |
| `budget-exhausted` | the monthly ceiling |

`lanesConsidered` is the denominator and `routeOutcomes` sums to it, so a
branch added later cannot be silent. `lanesBlocked` names trucks for every
outcome that is **not** `routed` or `route-current`, capped at six — naming
twenty healthy lanes every thirty seconds is how the one that mattered got
buried. Two behaviours changed with it: the cycle cap records and continues
rather than `break`ing, because a silently truncated list is how a permanently
starved lane stays invisible; and the straight-line distance is computed
before the recompute decision so a capped lane can still be reported with a
number.

### The arrival radius was sized from one truck at one facility

§12.27 set 0.25 mi from a single arrival — truck 143 at Grand Forks,
0.119–0.135 mi — and doubled it. It named both causes correctly (centreline
interpolation, and trucks parking in yards) and then measured the truck's
parked jitter rather than the offset across facilities. The offset is what the
radius has to clear.

**Re-measured** over 89,101 fixes. A *parking place* is one truck at speed 0,
fixes rounded to ~110 m, held 20 minutes or more; the distance is to the
nearest street-precision stop. Deduplicated that way because the naive version
counted one truck parked in Joliet against all eight Joliet stops within a
mile. 13 places, 8 trucks, 4 facilities:

```
0.101  0.103  0.116  0.123  0.124  0.128  0.133  0.152
0.312  0.318  0.320  0.321  0.516
```

The method reproduces §12.27 independently: two different trucks at that same
Grand Forks facility land at **0.128 and 0.133**.

**0.25 reaches 8 of 13. 0.35 reaches 12.** The binding case is Hazleton at
0.3086–0.3124, held for the whole of a 249-minute dwell. 0.40 and 0.50 reach
no further in this data, so **0.35** is the smallest value clearing the
measured cases with margin. §12.27's "twice the margin" heuristic is
deliberately not reapplied — against 0.312 it gives ~0.6 mi, three times the
distance at which the short stationary episodes already cluster.

**The false-positive cost is almost nothing, and not where it was assumed to
be.** Of the stationary episodes over 120 s within a mile of a street stop,
widening 0.25 → 0.35 admits exactly **one** more (2 minutes, 4 fixes, at
0.316 mi) and gains one more real dwell. Seven of the eight short episodes
already sit at 0.039–0.188 mi — geometrically inside the old circle. The red
light was never held off by the radius; `confirmSeconds` was doing that work
all along, exactly as §12.27 said when it chose 120 s.

### What the radius is sizing, which is not geocoder error

Without the dwell filter, the closest single stationary fix at Burlington is
**0.0105 mi**: the truck passes within 17 metres of the geocoded point and
then parks 0.12 mi away. `route_samples.snap_to_m` agrees — street
destinations snap to a road in 0.0–12.9 m, average 5.4.

The point is on the road centreline. Trucks drive over it and park off it. So
the number is **interpolation offset plus facility footprint**, and
parked-truck data cannot separate them. At one drop yard (275 W Laraway,
Joliet) the same facility spans 0.101 to 0.321.

### `geocode_accuracy_miles` at `street` was null, and null read as exact

§12.30's table gives `block` a measured 0.16–0.78 mi and `zip` a measured
median 2.14. It gives `street` the words *"interpolation only"* — a
description in a column of measurements. Null then reads as exact, and §12.30
leans on that reading to grant `street` the right to conclude an arrival.

`street` now carries **0.15 mi**, the p25 of the 13 places above, and it is
labelled for what it is: **how far the dock may be from this point, never
geocoder error.** The coordinate is exactly where Census says. p25 rather than
the median or the max because the arrival radius is what has to clear the
distribution; this number exists to stop `null` meaning "exact", and a ± that
swallowed the 0.52 outlier would make every street address look unusable.

It does not enter `etaCaution`, which holds at two clauses (§12.33) — a street
address is the good case and needs a number, not a warning. It appears in
`etaDetails`, which a dispatcher opens on purpose, saying the dock *may be up
to* 0.2 mi from the point rather than printing a bare ± that would read as the
geocoder being unreliable.

**n=13 across 4 facilities is thin. Re-derive both numbers on real loads.**

Two things had to follow it, and neither was obvious until the board was
checked rather than the code:

- **Migration 0015 backfills the 54 existing `street` stops, and the geocode
  cache.** A new constant applied only to rows written after it is half a
  rule, and the missing half was every stop already on the board. The cache
  matters for the reason §12.30 states outright — *"a stale cache keeps
  working, at the old answer"* — a cached street hit carrying null accuracy
  writes null onto the next stop that matches it. No `CHAIN_VERSION` bump: the
  coordinates, the precision and the match are unchanged, and only a derived
  constant is added.
- **`toFixed(1)` printed 0.15 as `±0.1`.** Floating point rounds it down, so
  the board understated a measured number in the one field whose entire job is
  to say how wrong the point might be. **Rounding a tolerance down is the
  direction that misleads.** Two decimals under a mile now, one above, trailing
  zero stripped — `±0.15`, `±0.8`, `±4.6`.

### `route_samples`: every row kept, `stop_id` demoted

The stale cache pointed at Dallas and so did three samples, on a stop now in
Pennsylvania. That is not one bad row — **35 of 114 samples (31%) already
named a destination their stop no longer had**: Bismarck→Grand Forks,
Atlanta→Joliet, Phoenix→Grand Island, Fargo→Minooka, and six more.

Those rows are correct. Chicago to Dallas really is 1198.9 straight and
1387.96 routed, and §12.31's use — grouping by destination to sanity-check a
provider swap — reads `dest_city/state/zip`, which still say Dallas. The
denormalisation saved it; the schema comment already said "a sample whose
destination can change is not a measurement".

The gap was that the city was snapshotted and **the point it referred to was
not**, so a row could name its destination and not locate it, and `stop_id` —
a live foreign key — was the only way to recover coordinates. `dest_lat` and
`dest_lng` join the snapshot, and `stop_id` is documented in the schema and in
the database as **provenance only, not a join key for destination facts**.

Migration 0014 backfills from two sources and guesses at nothing: the cache
row written in the same transaction (`computed_at = measured_at`, which
recovers the newest sample per stop whatever the stop says now), then the live
stop where its city and state still match the snapshot. **80 of 114 recovered,
34 left null** — and null is the honest value, because a guess from the live
stop would say "Hazleton" about a Dallas measurement.

### The two defects were holding each other up

`stop_routes` is a cache of the current stop, and it is already inert when the
stop moves: `fleet-query` joins on `sr.stop_lat = s.lat and sr.stop_lng =
s.lng`, so a re-pointed stop falls back to a straight line rather than
projecting to the old place. That guard worked — the board said "straight
line — no route has been measured for this lane yet", which was true of the
lane it was describing.

But **22 of 23 cache rows were current, and the one that was not is the one
the 0.5-mile floor had hold of.** Every other re-pointed stop got re-routed
and its cache overwritten. Truck 132's could not be, because `needsRecompute`
returned `stop-moved` every poll and the floor then skipped the lane — the
truck was parked 0.313 mi from the new address. **The rule that made the lane
unroutable is the same rule that blocked the overwrite that would have cleared
the cache.** Neither defect would have produced a lasting stale row on its own.

So the cache row is deleted at the source, when the stop is re-geocoded,
rather than waiting for a sweep that may be unable to run. `route_samples` is
untouched — those are measurements, and they carry their own destination now.

## 12.55 The guard checked the town and never the street

`outcomeFor` is the confidence cutoff: it decides whether Census's answer is
the place that was typed. It compared the **state, the city and the ZIP**.

```
typed     1907 4TH AVE NW UNIT 200, West Fargo, ND 58078
matched   1907 4TH AVE E,           WEST FARGO, ND, 58078
```

Same state, same city, same ZIP — so it passed, at `street` precision,
`census:in-range`, carrying the ±0.15 mi added that morning (§12.54). **The
two points are 3.023 miles apart, on different streets.** Truck 135 sat at its
receiver reading AT RISK while the board measured it against a street it had
never been on; Samsara's own reverse geocode said `4th Avenue Northwest` on
every fix.

The preamble already stated the principle — *"a refusal costs an ETA, an
acceptance costs a WRONG ETA, and only one of those sends a dispatcher
somewhere"* — and the guard was enforcing it on three of the four components.
A wrong street inside the right town is the one error a dispatcher reading the
row cannot see: the city is right, the ZIP is right, the precision says exact
and the ± says 0.15.

**A match that changes the street is not a match.**

### The audit, before the fix

Every geocoded stop and every cache row, typed street against matched street,
70 comparisons. **Two addresses disagree**, and they disagree differently,
which is what set the rule:

```
1907 4TH AVE NW       ->  1907 4TH AVE E          3.02 mi.  WRONG.
450 E Arthur Gardner  ->  450 ARTHUR GARDNER HWY            RIGHT — truck 132
                                                  arrived 0.31 mi from it,
                                                  inside the normal facility
                                                  spread (§12.54).
```

So a directional **present on one side and absent on the other** is a
difference in how a street is written, and refusing on it would have thrown
away a match that was demonstrably correct. A directional **present on both
sides and different** is a different street.

**Absence is never evidence. Disagreement is.**

### How the legitimate variations survive

`streetDisagreement` compares the street's parts, not its spelling: house
number, name, canonical suffix, and the SET of directionals. All of these
pass, and all are real rows from our own data:

```
5500 East 56th Avenue          ->  5500 E 56TH AVE
2611 South Westmoreland Road   ->  2611 S WESTMORELAND RD
4801 S California              ->  4801 S CALIFORNIA AVE     suffix omitted
1750 South 4800 West           ->  1750 S 4800 W             numeric name
4400 Fulton Industrial Blvd SW ->  4400 FULTON INDUSTRIAL BLVD SW
275 w laraway rd               ->  275 W LARAWAY RD
1907 4TH AVE NW UNIT 200       ->  1907 4TH AVE NW           unit dropped
```

A **set** rather than a pre/post pair, because `E 56TH AVE` and `56TH AVE E`
are one street written two ways and a positional comparison would call them
different — while `NW` against `E` stays different wherever it sits.

`address.ts` deliberately refuses a suffix dictionary for the cache key, on
the grounds that ST is Street and also Saint. That objection is answered by
making the dictionary **positional**: ST is only read as a suffix when it is
the last token, so `1200 St Charles Rd` keeps its saint and its RD.

### Three test fixtures had been describing this bug all along

Nine tests failed the moment the guard existed, and every one was a fixture
pairing a typed street with an unrelated matched street:

```
typed  1804 Vitest Fixture Street   matched  1804 N WASHINGTON ST
```

No real Census response could produce that, and nothing noticed because
nothing compared the two. The fixtures are coherent now. **A fixture that
cannot happen is a test that proves something else** — the same lesson as
§12.38, arriving through the data rather than through the assertion.

One of the nine was my own wiring rather than a fixture: `streetDisagreement`
was called with the whole matched address, and `squash` turns commas into
spaces, so the city, state and ZIP folded into the street name and every
comparison agreed with itself. `parseStreetLine` takes the segment before the
first comma now, and says why.

### The cache had to be invalidated, and this time it is stale HITS

`CHAIN_VERSION` goes to `census-v7+street-guard`. §12.30 introduced it for
stale misses; this is the mirror. `1907 4TH AVE NW` is sitting in the cache as
a confident street match on `1907 4TH AVE E` with thirty days of TTL, and
without a bump the cache would keep serving precisely the answer the guard
exists to reject — on exactly the addresses most likely to be wrong.

## 12.56 Two silences and a speed that was too strict

Three defects found with truck 133 and truck 135, none of them the radius
(§12.54), which had fired correctly once and was not what stood between the
board and these two arrivals.

### The ZIP gate was closed in a place that made it invisible

§12.30 is right that only a `street` coordinate can conclude an arrival: a
0.35 mi circle around a ZCTA centroid ±4.6 mi is noise, and `arrived_at` is
never unset automatically. That ruling stands and the gate stays shut.

What was wrong is **where** it was shut. The worker's candidate query carried
`and s.geocode_precision = 'street'`, so a coarse stop never became a
candidate — which made `explainNearest`'s `coarse-precision` branch
unreachable from the worker, and made the sweep report `considered: 19` in all
245 lines while meaning 19-of-21.

Truck 133 sat on Grainger Way in Minooka, **1,497 stationary fixes over twelve
hours**, 3.26 mi from the ZIP centroid its stop resolves to, and no line
anywhere said why nothing fired. That is §12.36's shape inside the code
written to end it.

The filter is gone from the query; the pure rule refuses, which is where the
refusal was always meant to live. The sweep now logs `cannotArrive` with the
truck, the stop and the distance — **named, not just counted**: "2 stops
cannot arrive" sends someone looking, `considered: 19` sends nobody anywhere.

And it is said on the board, which is the half that matters at 4am. §12.33
kept the at-risk suppression clause for one reason — **inference from
absence** — and this is the same argument: a dispatcher watching a truck sit
at a receiver and never flip to ARRIVED concludes the truck is not there, or
that the board is broken. Neither is true. The zip caution now reads *"neither
an at-risk warning nor an arrival can register here"*, still one sentence so
§12.33's two-clause ceiling holds, and `etaDetails` gains an `Arrival` row
naming the remedy.

The count, asked for and given before any fix: **2 of 46 open stops**, both
Illinois intermodal — Minooka and Elwood. 4.3% is not a rate to plan against
on a demo-seeded address set. That both failures are ramps is the pattern that
matters, and a real answer needs `geocode:probe` against real destinations.

### `nearest` was occupied by a stop that had already fired

**181 of 245 sweeps (73%)** reported an `already-arrived` stop as `nearest`.
Truck 132's completed stop at 0.309 mi beat a genuinely blocked truck 1.6 mi
out, on distance alone — so the field built to explain why nothing fired spent
three quarters of its lines on the one thing it cannot be about, and answering
a question about truck 135's approach needed the database again.

Arrived stops stay candidates, because departure detection needs them. They
are excluded from **that selection only**.

### "Stopped" meant exactly zero, and trucks do not park like that

`isStopped` was `(speedMph ?? 0) === 0`. Measured across fixes from trucks
that were demonstrably parked — a dwell of 20 minutes or more — **7.8% report
a non-zero speed**:

```
exactly 0   92.17%        1   < v <= 1.5   0.72%
0   < v <= 0.5  3.53%     1.5 < v <= 2     0.77%
0.5 < v <= 1    1.97%     2   < v <= 2.5   0.51%
                          2.5 < v <= 3     0.31%
```

Every one of those restarted the two-minute clock. **The tolerance is 3 mph**,
capturing 99.98%; 2 captures 99.16% and would still have been broken by truck
135's 2.482.

What it costs was measured rather than reasoned. Runs of at least 120 s within
0.35 mi of a street stop — the ones that would actually confirm:

```
tolerance   0     1     2     3     5
runs       22    22    22    22    19
```

**Flat.** The tolerance admits no new confirmable runs; it merges fragments of
the same events into longer ones, which is the entire intent. And the
geometric bound: at 3 mph a truck covers 161 m during the window against a
563 m radius, and `confirmedRun` only counts fixes that are inside the radius
AND slow — so the clock starts at the boundary and the truck is deeper by the
end. 5 mph was rejected on that bound alone: 268 m is half the radius.

**The real track proves it.** Truck 143 manoeuvred into its yard reporting
1.23, 2.482, 0, 1.23, 0, 2.482, 1.856 mph on consecutive fixes. Under `=== 0`
the run could not start before 20:15:49 — the first zero with only zeros after
it. With the tolerance it reaches back to **20:14:49**, and the fix before
that reads **3.086 mph**, which the cut correctly excludes because the truck
was still rolling in. §12.27's rule that the instant recorded is when it
ARRIVED, not when we became sure, is sixty seconds more accurate on the only
real arrival track we have.

`detectDeparture` moves with it. "Moving" is the complement of "stopped", not
`> 0` — otherwise a truck creeping at 2 mph is neither, and one still in the
yard could satisfy the departure test.

## 12.57 The arrival a dispatcher can mark, and the column that says who did

`stops.arrived_at` had exactly one writer from phase 2 until now: the arrival
sweep, which anchors it to a GPS fix inside a radius, below a speed threshold,
held across two polls. **Two real stops can never produce that fix**, and both
appeared on the first day of real use:

- **Truck 133**, Minooka IL. Census has no record of `201 S MCLINDEN RD`, so
  the stop is a ZIP centroid at ±4.9 mi and §12.30 gates arrival off
  entirely. The truck sat there overnight and the board never moved.
- **Truck 135**, West Fargo ND. Census answered `1907 4TH AVE E` for a typed
  `1907 4TH AVE NW` — a different street three miles away — and §12.55 now
  refuses the match, which leaves the stop with **no coordinate at all**.
  Correct, and it cannot register an arrival either.

Both are intermodal-adjacent, which is where most of this fleet's deliveries
go. A board that can never say ARRIVED for a truck that plainly has is not
missing a nicety; it is wrong on the screen's headline fact.

### The override was not this, and never could be

`FORCED_STATUSES` already contains `ARRIVED`, and the obvious move was to use
it. It is a **chip, not an arrival**, and the difference is not cosmetic:

| | forcing ARRIVED | this |
|---|---|---|
| chip, rail, sort, filters | yes | yes |
| the ETA | **keeps running** — `etaAbsence` keys off `computed`, so the row shows ARRIVED beside a live projected time and live miles | suppressed, like any arrival |
| an arrival time | none recorded | recorded |
| departure detection | can never fire — `detectDeparture` needs `arrived_at` | fires normally |
| the next stop | never advances; §12.13 is "lowest sequence with no `departed_at`" | advances |
| lifetime | **expires.** `expires_at` is mandatory (§9.5), so the row silently returns to LATE | permanent, until cleared by hand |

Both of today's trucks are on stop 1 of 2. An override would have stranded
them there.

### A wall time, not a button

A button stamping `now()` records when the DISPATCHER got round to it. A
dispatcher confirming at 07:10 for a truck that docked at 06:44 would put 26
minutes of invented detention into the only column anyone could argue it
from. So it is a date and a time, defaulted to now at the stop and editable.

It is a **stop-local wall time plus a zone**, converted server-side, as §7 has
required of appointments since phase 2 — and for a stronger reason here. The
zone is the one the appointment block is already showing, live rather than
copied: a dispatcher reading "06:44" off a phone call is reading the
receiver's clock, and asking which zone that was twice in one modal is how the
wrong answer gets typed.

Three wall-time carriers now exist — the appointment, the override's custom
expiry, and this — so the shape is one schema, `WallTimeInput`, and the
conversion is still the single `appointmentStartSql`. What `resolveWallTime`
repeats is the round-trip CHECK, not the conversion: the spring-forward hour
is refused here too, because an arrival stored silently an hour late is a
false record of where a truck was.

**Clearing must be possible, and is.** §12.27 never unsets `arrived_at`
automatically, which is right for a measurement and intolerable for a field a
human types: an arrival entered on the wrong row at 4am would otherwise be a
permanent wrong answer. Omitted leaves it alone, null clears it — §12.23,
unchanged.

### `arrived_source`, and why it is a column

The sweep's claim and a dispatcher's claim are different kinds of thing. One
is measured; one is believed. Storing them in one column with no discriminator
makes them indistinguishable everywhere except `audit_log`, which nothing on
the board reads.

Two derivations were considered and both refused as the confident-wrong-answer
shape:

- *"`arrived_at` matches some position's `recorded_at`"* — a join per row, and
  a coincidence misclassifies silently.
- *"the seconds are zero, so a human typed it"* — true of most hand entries
  and of any GPS fix landing on the minute. Usually right is the problem.

Not `arrived_by uuid REFERENCES profiles` either, mirroring `note_by`: that
answers WHO, and null would have to mean "the sweep", so deleting a profile
(`ON DELETE SET NULL`) would silently reclassify a dispatcher's entry as a
detection. **The kind of claim must not depend on whether the person who made
it still has an account.** Who made it is in `audit_log`, where "who" belongs.

Paired with `arrived_at` by a check constraint, both ways — which caught three
test fixtures writing a timestamp with no source the moment it landed.

### What the board says

Same slot, different word, the way `NO ELD` says which kind of driver row you
are reading:

```
arrived    detected — a fix inside the radius, stopped, held across two polls
marked     a dispatcher typed it
```

Not a suffix, a badge or a colour: that cell is 44px of a scanned list and the
distinction has to survive being read sideways. The ETA detail block
(§12.33) carries the full sentence, including the half nobody can infer —
*"No GPS fix confirmed it"* — and §12.56's "mark it by hand" instruction stops
appearing on a ZIP stop once somebody has.

### The rule that keeps it honest

**The source moves only when the time moves, tested at the control's
resolution, not the column's.**

The modal loads the stored arrival, so every unrelated save re-sends it. A
detected arrival reads back as `06:44:37`; the control can only render and
return `06:44`. Comparing instants would see a change on every save and
relabel a measurement as somebody's assertion — §12.53's note-authorship bug,
in the one column where measured-versus-asserted is the entire point. So the
comparison is to the minute, because a minute is all the control can express,
and the server decides it against the stored value rather than trusting the
caller to omit correctly.

Two guards, both landing on the field rather than as a 500: an arrival in the
future is refused (with five minutes of tolerance, sized for an unsynchronised
browser clock, not for predicting arrivals), and so is one after the truck had
already left.

## 12.58 A reason list with no entry for the commonest reason

`OVERRIDE_REASONS` offered five, and the closest fit for both of today's
trucks was `ELD_POSITION_WRONG` — which is false. The ELD is working and the
position is right; it is **our coordinate for the stop** that cannot register
an arrival. Saying otherwise would put a lie in the audit log and send
whoever read it to the wrong vendor.

So it filed as `OTHER`, which §9.5 reserves for the rare case that earns a
written note, and which is the one value that cannot be counted in review. A
list whose catch-all absorbs the commonest entry is not a list.

Added as `ARRIVAL_NOT_DETECTED`, *"Arrival cannot be detected for this stop"*
— worded about the stop, not the truck. Inserted `BEFORE
'DRIVER_REPORTED_DELAY'` rather than appended, so the database's enum order
matches the order a dispatcher reads down in the modal; nothing sorts by it
today, and a silent disagreement is a trap for whoever first writes
`order by reason`.


## 12.59 Routing moves to HERE, truck profile — and geocoding does not

§12.31 opened the provider seam with a defect written on it: **Mapbox
Directions has no heavy-goods profile**, so every route the board had ever
measured was a car route. Fine for deciding LATE, not fine for anyone
reconciling against a rate confirmation, because brokers pay truck miles and a
car route reads short. This spends that seam.

**Routing only.** HERE's Base plan states that Permanent Geocoding is not
included, with no listed pricing — and storing lat/lng long-term is exactly
what we do (§12.24). Routing Truck carries no such restriction and is free on
Base at 5,000 monthly transactions. Geocoding stays on the US Census geocoder
until HERE support answers directly, and `src/server/geocode.ts` was not
touched. Splitting the migration here is not caution about the code; it is
about a licence we do not have in writing.

### `transportMode=truck`, confirmed twice

The parameter name was read out of HERE's transport-modes reference — it is
one of three mandatory parameters, and `truck` is its heavy-goods value — and
then confirmed against the live API before a line was written. The response
echoes `"transport":{"mode":"truck"}`, so the provider states which profile
answered, and the parser refuses anything that comes back as `car`. A silent
downgrade to car miles is the exact defect this swap exists to end, and it
would be invisible: car miles are not obviously wrong, only short.

**Truck dimensions are deliberately not sent.** HERE accepts `grossWeight`,
`height` and the rest, and they change the answer. We do not send them because
we do not know them: there is no per-truck equipment record, the trailer field
was cut (§12.53), and a default weight would produce a specific-looking number
describing a truck nobody owns. The profile alone applies the general HGV
network restrictions, which is the gap §12.31 named.

### The gap got BIGGER, which is the opposite of the hoped-for answer

Re-run on ten of our own lanes, same endpoints, both profiles, same minute
(`npm run route:compare`):

```
lane                       straight   mapbox car   HERE car  HERE truck  truck-car
138 -> Phoenix, AZ           1426.5       1723.2     1721.2      1765.3      +44.1
145 -> Salt Lake City, UT     875.3            —     1140.0      1145.8       +5.8
141 -> Denver, CO             900.8        986.4      986.3       986.3        0.0
146 -> Dallas, TX             756.8        981.3      954.8       998.2      +43.4
128 -> Atlanta, GA            585.9        740.8      737.5       737.5        0.0
130 -> GRAND ISLAND, NE       544.6        602.8      606.2       605.8       -0.4
137 -> Elwood, IL             407.3        500.7      500.5       500.5        0.0
132 -> Joliet, IL             318.9        413.1      414.3       414.4       +0.1
136 -> Fargo, ND              287.2        298.4      298.4       298.4        0.0
133 -> Minooka, IL             46.6         55.8       53.5        54.6       +1.2
```

**HERE truck vs HERE car: mean +9.4 mi (0.97%), worst +44.1 mi.** §12.31
measured +3.0 mi mean and +15.6 mi worst against Valhalla. The gap is roughly
**three times larger** than the number that motivated the swap, so the swap
was better justified than its own business case, not worse.

**But the mean is the wrong summary, and the distribution says why.** Six of
ten lanes are *identical* to the car route to within half a mile — interstate
corridors with no HGV restriction to apply. The other four differ by 23.6 mi
mean and 44.1 mi worst. Truck routing either agrees exactly or departs by tens
of miles; averaging those describes no lane we run. Same shape as §13.7's
bimodal yard, and the same lesson: report the two modes, not their midpoint.

A control worth having: **the two car profiles agree to 4.35 mi mean across
the nine comparable lanes.** So the difference is the profile, not the vendor —
which is what makes the +44 attributable to truck routing rather than to
changing supplier.

One methodological correction, because the first run of the comparison was
wrong. `route_samples` stores the destination it measured but not the origin,
so the origin had to come from `stop_routes` — the *current* cached origin,
which on a re-routed lane is a different point. That produced a 199-mile
"provider disagreement" on Salt Lake City that was two different journeys
being subtracted. Car-vs-truck was never affected (both calls leave the same
point in the same minute); the Mapbox column now prints `—` when the origins
cannot be shown to match, rather than being quietly averaged in.

### `provider-changed`, and why the migration alone was not enough

A `lane_ratio` is not provider-neutral: a car ratio applied to a truck lane is
a 44-mile understatement wearing a measurement's clothes. Two things address
it, and they are not the same thing.

Migration 0017 **deletes the cached rows** — `stop_routes` is a cache by
§12.54's own distinction, deletable and already deleted on every re-geocode,
while `route_samples` is the measurement record and keeps every row. All 337
Mapbox measurements are still there, each stamped with its provider; only the
24 cached answers went.

`needsRecompute` gains **`provider-changed`**, returned whenever a cached row
names a provider other than the one in force, and checked *before* the
geometry — a row from the old provider is wrong wherever the truck has got to,
and letting `truck-moved` report it would hide a swap inside ordinary traffic.

That rule earned itself within eleven minutes. A worker process from before
the swap was still running, unnoticed, and went on writing Mapbox rows
*after* the migration had emptied the table. The new worker's first sweeps
reported `routedBecause: {"provider-changed": 8}` and replaced every one; one
sweep later all 19 cached routes were HERE truck. The migration was the
cleanup and it was already out of date; the rule is the guarantee.

### The budget does not fit the documented projection, and does fit reality

HERE Base allows **5,000 routing transactions a month**. Mapbox's free tier
was 100,000 and `ROUTING_MONTHLY_CEILING` defaulted to 25,000 — five times the
entire new allowance, so it guarded nothing and had to move.

§12.31's calibration projects **~516 calls/day ≈ 15,480/month**. That is
**3.1x over the free tier** and it does not fit. Measured traffic tells a
different story:

```
2.62 routing calls per worker-hour, over 99 hours of real operation (259 calls)
  -> ~1,950/month at 24/7
  +  restarts, where every lane is `no-route`: worst observed hour was 72
  => ~2,700/month
```

The simulation assumed 23 trucks all running long lanes at once; the fleet
actually moves about seven at a time, which is why it is off by 4.5x.

**Ceiling set to 3,000** — 60% of the allowance, ~1.1x measured worst case.
The honest statement of the risk: if utilisation rises to what §12.31
simulated, this is reached around day six and the board spends the rest of the
month on lane estimates. That is the budget guard working, not failing. The
guard degrades and never throws — a failed or over-budget call falls back to
the lane ratio and then to the straight line, exactly as it did when Mapbox
was down — and `routing_budget` lives in the database so a crash loop cannot
reset the counter.

**Watch the monthly number.** It is the one figure here that is a projection
rather than a measurement.

### The key

`HERE_API_KEY`, server-side only, and `MAPBOX_DIRECTIONS_TOKEN` is **removed**
rather than left lying about: a credential for a provider nothing calls has no
owner, and the next person to find it has to work out whether it matters. The
browser token `NEXT_PUBLIC_MAPBOX_TOKEN` stays — it draws the map.

The startup guard is broader than the one it replaces. The old rule compared
one token against one named counterpart; this compares the HERE key against
**every `NEXT_PUBLIC_*` value**, because that prefix is the whole client
surface — Next inlines each of them into the bundle by literal substitution.
It therefore also catches the mistake the narrow version could not: somebody
adding `NEXT_PUBLIC_HERE_API_KEY` to reach HERE from a map component. A
routing key in a network tab is a metered API anyone can spend, and 5,000
transactions is one afternoon of somebody else's script.


## 12.60 The budget's first warning was also its last chance to act

§12.59 set the routing ceiling at 3,000 against HERE's 5,000 and wrote down a
specific foreseen failure: if utilisation rises to what §12.31's calibration
simulated, the ceiling arrives **around day six** and the board spends the
rest of the month on lane estimates.

That sentence lived in the spec and in a commit message. Neither is open at
3am. The runtime had exactly one budget signal:

```
logger.error('routing budget exhausted for the month — degrading to lane
              estimates', { ceiling })
```

Three things wrong with it, and the first is the one that matters:

1. **It fires only once the ceiling is already hit.** By then the degradation
   has happened and the only remedies left are raising the ceiling or waiting
   for the month to turn over. The first thing ops heard about it was also the
   last thing they could do anything about.
2. **It carried the ceiling and not the spend**, so it said what the limit was
   and not how the month had got there.
3. **Nothing reported the budget on a normal cycle**, so there was no baseline.
   "Is this sudden?" had no answer.

### What it does now

`budgetStatus` in `lib/routing.ts` — pure, so the forecast is testable without
a clock or a database, like every other rule in that module. It returns the
spend, the fraction, the burn per day, the projected month end, and the day of
the month the ceiling lands on at the current rate.

**The §12.59 day-six number is computed, not remembered.** A forecast is only
worth anything if it updates, and this one is asserted directly:

```
budgetStatus(516 * 5, 3_000, Sept 6)  ->  burnPerDay 516, exhaustedOnDay 6
```

Bands at 70% (`watch`, warn), 90% (`critical`, error) and 100% (`exhausted`,
error). The watch line names the §12.59 scenario in words, so the person
reading it at 3am gets the context without having to find the spec.

**Edge-triggered**, because the poll is every 30 seconds and an unconditional
warning is 2,880 identical lines a day — which is the same as no warning, but
harder to read past. Only `exhausted` repeats, because that one is a live
degradation and a board running on lane estimates should keep saying so. A
restart re-announces deliberately: a worker coming up at 85% of the month is
worth one line. Dropping back a band logs too, so a recovery is as findable as
the warning was.

And `poll: ingested` now carries `routeCallsThisMonth` and `routeCallCeiling`
on **every** cycle. A number that only appears in trouble is a number nobody
has a baseline for.

Verified against the real counter rather than a fixture — 374 calls, ceiling
forced to 500:

```
warn  routing budget past 70%. If this is the §12.59 scenario …
      spent 374  ceiling 500  percent 74.8  burnPerDay 17.4
      projectedMonthEnd 521  exhaustedOnDay 29  ruling "§12.59, §12.60"
```

One detail with a bug behind it: elapsed time is floored at one hour. Without
it, twelve calls at 00:05 on the first of the month divide by 0.003 days and
project to millions, so every new month would open with a critical alert.

## 12.61 The ceiling was set from an average of the wrong thing

§12.59 sized the routing ceiling at 3,000 from 2.62 calls per worker-hour
measured over 99 hours — about 2,700 a month including restarts, comfortably
inside HERE's 5,000 free Base allowance.

Those 99 hours included long stretches with the fleet parked and the worker
idle. Averaging over them answers "what does an hour cost on average", which
is not the question a monthly ceiling asks.

Counted over a real dispatch day instead:

| | calls/day | /month (31d) |
|---|---|---|
| measured, 24 h of live operation | 168 | 5,208 |
| simulated over 110,777 real fixes, 18 truck-lanes | 187 | 5,797 |

The simulation overshoots the count by 11% — close enough to trust, and
pessimistic in the safe direction. **The rule that is running costs about
5,800 calls a month against a free tier of 5,000.**

### 5,000, because a ceiling above the vendor's limit guards nothing

No honest ceiling exists that the current rule fits inside, so the only
question is which limit the guard should be, and it is HERE's. Above 5,000
the vendor's limit arrives first and the overage is a bill rather than a
degradation to lane estimates; below 5,000 free capacity is given away and
the ceiling is breached anyway. At exactly 5,000 the guard fires where the
free tier ends.

The consequence is meant to stay visible rather than be smoothed away: at the
measured rate the ceiling is reached **around day 27**, and the board spends
the last days of the month on lane-ratio estimates. That is the guard working
and the standing argument for a cheaper recompute rule.

Raising it further is a decision to pay HERE for overage and wants a price in
hand, not a quieter log.

### What was measured and rejected: the per-lane cooldown

A per-lane cooldown — a floor on how often ONE lane may be routed,
suppressing `truck-moved` only, since it is the single recompute reason that
means "older" rather than "about somewhere else" — was replayed over the same
110,777 fixes:

| rule | calls/day | /month | % of 5,000 |
|---|---|---|---|
| current `max(10 mi, 15%)` | 187 | 5,797 | 116% |
| + cooldown 15 min | 175 | 5,425 | 109% |
| + cooldown 30 min | 147 | 4,557 | 92% |
| + cooldown 45 min, exempt under 25 mi | 134 | 4,154 | 83% |
| far lanes 25 mi/25% + cooldown 30 min | 132 | 4,092 | 82% |
| far lanes 25 mi/25% + cooldown 60 min | 109 | 3,379 | 68% |

**Rejected as the wrong instrument**, on the evidence rather than the cost.
`route:drift` measures `lane_ratio` between consecutive real HERE samples,
which is what the displayed distance depends on between recomputes:

```
gap between        pairs   median dRatio   p90 dRatio   median mi   p90 mi   worst mi
0-10 min                6          0.0126       0.0338        0.47     0.61       0.61
10-15 min              13          0.0330       0.2224        0.72     5.36      10.25
15-20 min               8          0.0249       0.1610        2.57     5.23       5.23
20-30 min              13          0.0104       0.0309        1.30     4.12       4.28
```

Drift does not grow with the gap. It grows with **proximity** — every
observation above 5 miles is an approach, the worst being Bismarck at
1.133 -> 2.752 while the truck covered 16.4 -> 6.3 miles. A clock therefore
buys its savings in the wrong currency: truck 116's interstate lane recomputed
five times in forty minutes to learn 0.031 of ratio (about 1.5 miles, 1.7
minutes of ETA), while truck 143's lane moved 2.7-5.4 miles over comparable
gaps. The same cooldown is nearly free on one and expensive on the other, and
time cannot tell them apart.

**What the data points at instead is a ratio-stability gate**: skip the
recompute when the lane's ratio has not moved, not when time has not passed.
It cannot be costed from the existing simulation, which holds ratio at a
synthetic 1.25 and can therefore count calls but not model accuracy. It needs
a shadow-mode run — logging what the gate would have skipped while skipping
nothing — over several real days before any number is proposed.

Sample size, stated: 41 consecutive pairs on 30 lanes. Thin.


## 12.62 "Exactly one of these should run" was never a mechanism

`worker/index.ts` has carried the sentence *"Exactly one of these should run"*
since phase 2. It is a true statement of intent and it has never prevented
anything.

Two instances have existed. Once for real: a worker started before a schema
swap outlived the migration, and for a while two processes were polling the
same feed and spending from the same `routing_budget` month row. Once nearly,
while the §12.61 shadow run was being set up on a second terminal.

### Why a second instance is not merely wasteful

Three pieces of shared state, and none of them survives two writers:

- **The ingest cursor.** Each worker advances it past pages the other has not
  read, so positions are silently dropped rather than duplicated. This is the
  expensive one — the data is gone, not doubled.
- **`routing_budget`.** The ceiling is HERE's free allowance exactly (§12.61),
  sized against one worker's measured 168 calls a day. Two workers reach it in
  half a month and the board falls back to lane estimates while every log line
  reports a rate that looks normal for the process printing it.
- **`feed_health`.** §12.39 and §12.42 exist to make the stall counters
  trustworthy. Two processes writing `last_success_at` means neither one's gap
  measures anything, which quietly undoes the instrumentation that found
  §12.52.

### The mechanism

A session-scoped Postgres advisory lock, `pg_try_advisory_lock(0x564C, 0x4654)`,
taken at startup and held for the process lifetime. `try` rather than the
blocking form: a second instance should fail at the moment somebody is watching
a deploy, not queue silently and start hours later when nobody is.

**The lock needs its own connection, and this is the part that is easy to get
wrong.** `createDirectDb` sets `max_lifetime: 60 * 10` and `idle_timeout: 60`
— correct for the worker's query connection, for §12.39's reasons, and fatal
for this one. Advisory locks live on a session; postgres.js would recycle the
connection about ten minutes into a deploy, Postgres would release the lock
with it, and nothing would say so. That is worse than having no guard, because
the next person to deploy trusts it. So the lock client is `max: 1`,
`max_lifetime: 0`, `idle_timeout: 0`, and does nothing else.

**The heartbeat cannot be `select 1`.** postgres.js reconnects transparently,
so a dropped connection loses the lock and then answers healthily from a new
backend holding nothing. The check has to ask about the backend —
`pg_locks … and pid = pg_backend_pid()` — because the connection surviving and
the lock surviving are different facts and only the second one matters.

**It fails closed.** A worker that has lost the lock cannot know whether
something else has taken it, and running on is the exact failure being
prevented. It exits and lets the restart policy try again.

### What is checked where

Mutual exclusion, release, and the never-recycle configuration are unit tests
against the local cluster. One thing is not testable there: whether Supabase's
session pooler passes advisory locks through at all. "Session mode" is a vendor
promise, and if Supavisor ever multiplexed it the way it multiplexes
transaction mode, the guard would go quiet rather than loud — the same failure
shape as `prepare: false`, and so checked in the same place, `npm run
preflight`.

That check asserts exclusivity, never that the lock is free: on a live system a
worker is normally holding it, and a gate that goes red on every deploy after
the first is a gate people learn to ignore (§12.32's lesson about the
`prepare: true` assertion, applied before it could be repeated). Being refused
by the running worker proves the property just as well as taking it does.



## 12.63 The Sentry upgrade that would have started sending the session cookie

Two Sentry projects, not one: the app and the worker are separate runtimes
with separate failure modes. The app fails per-request in front of a
dispatcher who can retry and say what happened; the worker fails alone at 3am.
Pointed at a single project the second kind disappears behind the volume of
the first, and neither gets its own quota. Startup refuses two identical DSNs,
because pasting one into both variables breaks nothing visible.

A DSN itself is **not a secret** — it is write-only ingest, which is why
`NEXT_PUBLIC_SENTRY_DSN` is a deliberate exception to this project's rule
about that prefix. The exception is on the merits: the alternative is proxying
every browser error through our own route, which is a lot of machinery to hide
a value designed to be seen.

### What was nearly missed

**Sentry v11 removed `sendDefaultPii` and replaced it with `dataCollection`,
inverting the default.** In v10 an unset `sendDefaultPii` was restrictive. In
v11 an unset `dataCollection` collects:

```
userInfo             true
cookies              true
httpHeaders          { request: true, response: true }
httpBodies           all four directions
databaseQueryData    true
stackFrameVariables  true
```

For this application that means the dispatcher's **Supabase session cookie** —
an auth credential, squarely covered by the rule that secrets do not leave the
server — plus **stop-edit payloads** (street address, dock, the dispatcher's
free-text note, the driver's name) and **bound query parameters**, which is the
same data again by another route. None of it is needed to find out why a route
handler threw; the stack, the route and the reference code are.

Nothing would have failed. The config would have looked finished, the tests
would have passed, and the leak would have started at the first error.

### What it means beyond Sentry

The policy lives in **one** module, `src/lib/sentry-privacy.ts`, imported by all
four `Sentry.init` sites (Node, edge, browser, worker). A privacy rule that has
to be remembered four times is one that will eventually be applied three times,
and the fourth is not a gap but a leak.

The test that matters is not the one asserting today's values — it is the one
asserting that **no `Sentry.init` anywhere lacks `dataCollection`**, with a
second test pinning the expected list of init sites so the scan cannot pass by
finding nothing. Next time the defect will not be a wrong value; it will be a
fifth runtime that never asked.

### What is captured, and what is not

The worker reports through `logger.error` rather than by intercepting the
console. Interception would have caught the same calls — `logger.ts` emits via
`console.error` — and grouped them uselessly, because the event message would
be the serialised JSON line and every event would group by its own unique
payload. Sentry would show thousands of singletons instead of "this failed 400
times". Warnings and info become breadcrumbs instead of events: the worker
warns on things that are true for a while rather than wrong, on a schedule, and
as events they would be a pager that is always going off.

Sentry's own `OnUncaughtException` and `OnUnhandledRejection` integrations are
**removed**, and `worker/index.ts` owns both handlers. Left in, every crash is
reported twice — once by Sentry's handler and once by ours, since ours reports
through `logger.error` to attach the worker's context. Two events for one crash
is not redundancy; it is two issues that each look half as frequent as the
problem is. Ours also flushes before exiting, which is what makes the last
error before a shutdown — usually the one that explains it — actually ship.

# 13. Still open

The contradictions found during extraction, plus what real use has since
raised. **These have not been ruled on.**

13.1–13.5 came out of the phase-0 extraction; of those, four are cosmetic or
deferred and one (§13.3) has since been resolved. **§13.6 and §13.7 are
different in kind** — both were raised by real trucks rather than by reading
the drawings, and both are held open deliberately: §13.6 to see whether the
misreading happens again, §13.7 because the idea is sound and the shape is
not settled. Neither is a gap. §13.7 carries a tension that is stated and
**not** resolved; a proposal that does not address it is not a proposal.

## 13.1 Filter-chip number keys — resolved by consequence, needs a nod

`2g` says `1`–`7`; the drawn consoles showed **six** chips. Adding the
`Inactive` chip (§12.14) makes the set **seven**:

```
1 Late · 2 At risk · 3 On time · 4 Arrived · 5 Tomorrow · 6 Data issues · 7 Inactive
```

which reconciles `2g` exactly. §8.1 is written this way.

**The inference to confirm:** that `Inactive` belongs in the same keyed row as
the status chips, rather than sitting apart as a different axis (an `active`
flag is not a status). If it sits apart, the keyed set reverts to `1`–`6` and
`2g`'s `1`–`7` is simply stale.

## 13.2 List-column width — 1037 or 1132?

`2g` and `3b` both say **list 1037, map 685 at 1728**. `3e`'s column proof
says it was drawn at **1132px, "the real list-column width at the default
60/40 split"**. They disagree by 95px.

§4.1 uses **1037** — it is 60% of 1728 and corroborated twice, against 1132's
single appearance. `3e`'s conclusion is unaffected either way, since the fixed
columns don't flex.

Low stakes. Worth a glance only because `3e` is the section that exists to be
authoritative about column widths.

## 13.3 The 560px list minimum — **RESOLVED, see §12.17**

Below 900px of list width the row drops to six columns: Position and ETA are
cut, type and padding are untouched. Kept here as a pointer because the
arithmetic that produced it is worth not re-deriving.

## 13.4 Unassigned and Tomorrow markers are both circles

`TOMORROW` is a hollow circle, no fill, `#858d94` 1.5 stroke. `UNASSIGNED` is
a solid-outline circle, `#262a2f` fill, `#b3bac0` 1.5 stroke. They separate by
fill and one step of grey — weaker than the rest of the set, which separates
by silhouette.

Turn 4 states this deliberately ("no new hue"), so it is built as specified.
It is the one place the greyscale-safe guarantee leans on fill rather than
shape. **Look at it on real tiles in phase 3.**

## 13.5 `2f` phone detail has no override block

`4c`'s override treatment is specified for the row, the edit modal and the
desktop detail panel. The phone detail stack predates it.

Given turn 4's authority and the phone-parity requirement, the phone detail
should carry the collapsed form of the block. **Not drawn anywhere.**


## 13.6 Should the ETA column carry the stop's zone when nothing else does?

**Raised from a real misreading, deliberately not fixed.** Kept open to see
whether it happens again against real loads.

The reading that failed: `LATE`, ETA **19:41 EDT**, appointment **10:00**. The
conclusion drawn was that the board was broken. It was not — 19:41 EDT was the
current instant, and the ETA was 27 seconds after the last GPS fix (§12.54).

What defeated it was presentation, not arithmetic. **Three zones were in play
and only one of them was printed:**

- the ETA in the stop's zone, `EDT` — §7.1, and correct
- the appointment in the same column's own zone, which on this row was also
  EDT but on the row above was CDT
- the dispatch clock (CDT) and the viewer's clock (CEST) in the header,
  neither of them EDT

So a number appeared in a zone that appeared nowhere else on that row, next to
a number whose zone was implied, while the reader's own clock was six hours
away. Every individual rule was followed and the composition was unreadable.

§7.1 is emphatic that the Appt column carries the stop's own zone, and gives
the reason: a single list carries MST, PST, EST and CST at once. The ETA
follows the same rule so the two columns can be compared. **The question is
whether "the same rule" is enough when the two columns sit 100px apart and
only one of them is labelled**, and whether the ETA should instead print in
the dispatch zone — the one clock in the header a dispatcher is anchored to —
with the stop-local time in the tooltip.

Arguments both ways, unresolved:

- **Stop-local, as now.** The ETA is a claim about arriving at that facility,
  and the receiver's clock is the one that decides whether it was late. Moving
  it would put the ETA and the Appt in different zones in adjacent columns,
  which is worse.
- **Dispatch zone.** The row already labels nothing in the ETA cell, the
  dispatcher's anchor is the header clock, and the comparison that actually
  gets made at 4am is "is this before or after now", not "is this before or
  after the appointment".

Do not design a fix on this one report. **Watch whether it catches anyone
again once real loads are running**, and if it does, that is the evidence.

## 13.7 Should a facility's coordinates be learned from observed arrivals?

**Raised from a real question about real trucks, ruled "agreed, not yet, and
not as one feature". Recorded here rather than built.** The argument for it is
sound and the evidence below is ours; what is not settled is the shape, and
one tension in it has no answer yet.

### The argument, which our own measurements make

A geocoder answers *"where is this address on the road network"*. A dispatcher
asks *"where do trucks stop at this facility"*. These are different questions
and we have been using the first answer for the second.

Census street-precision points sit on the road centreline, and we can show it:
across **140 routed street-precision lanes** the provider had to move the
destination an average of **5.3 m** to reach a road, maximum 12.9 m. The point
is already on the tarmac. (The same figure for zip precision is 402.5 m — a
centroid is nowhere near a road, which is a separate fact.)

Trucks do not park on the centreline. Every place one of our trucks has sat
for five minutes or more at three miles an hour or less, within a mile of its
own stop, deduplicated to about 55 m — **14 parking places across 4
facilities** — sits **0.057 to 0.341 mi** from the geocoded point. That spread
is what §12.54 sized the 0.35 mi arrival radius against.

A truck parked at a receiver for twenty minutes is therefore a **direct
measurement of the thing we actually want**, and a better one than the
geocoder can give. That much is not in doubt.

The bootstrap objection — that arrival detection needs coordinates before it
can observe an arrival — is real but not fatal, and the answer is one we need
anyway: **a dispatcher confirming "this truck is at the receiver" by hand**.
That is the same control the zip-precision stops need (§12.30 gates arrival
off entirely there, so they can never fire on their own), and the same one
truck 135's stop needs now that §12.55 has taken its coordinates away. One
control, three problems.

### But it is three problems wearing one costume

The failures that prompted this are not the same failure, and they do not want
the same remedy:

| failure | our example | what it actually needs |
|---|---|---|
| the geocode is **wrong** | 135 — Census returned a street 3.02 mi away | a corrected **centre** |
| the yard is **big** | 275 W Laraway Rd, Joliet | a wider **radius**, or several centres |
| there is **no geocode** | 133 — ZIP centroid, ±4.9 mi | a **centre**, bootstrapped by hand |

These separate cleanly, and a design that treats them as one thing will be
wrong about at least two of them:

- A **learned radius** — keep the geocoded centre, widen the circle to the
  observed maximum plus a margin — handles the middle row with no override
  question at all, and fails safe to 0.35 mi when there is nothing learned.
  It does nothing for row 1, where the radius would have to be three miles.
- A **learned centre** handles rows 1 and 3, and carries every hazard below.
- Row 1 also has a cheaper remedy that already exists: the guard refuses the
  match, the stop goes dark, and a dispatcher fixes the address. **Learning
  must not become the way we paper over an address nobody corrected.**

### The large yard, measured

275 W Laraway Rd, Joliet has three parking places at five minutes or more:

```
   0.102 mi from the geocode    21 fixes,  6 min
   0.169 mi                     14 fixes, 17 min
   0.333 mi                      7 fixes, 22 min
```

Two groups, **0.232 mi apart** — a dock and a drop yard, or two entrances.
Their centroid lands 0.201 mi from the geocode and **0.098 / 0.041 / 0.134 mi
from the three places themselves**: it describes a spot where no truck has
ever parked, and it is furthest from the longest dwell of the three.

This is precisely the error §12.31 threw out when it discarded the 1.25 road
factor — a single constant fitted to a distribution that has no single value
in it. So if a centre is learned, the **observations must be kept, not
collapsed**, and the arrival test becomes "within R of any observed cluster"
rather than "within R of the mean". That is materially more code and more test
surface than the idea sounds like.

### Should a learned coordinate override a geocoded one?

**The recommendation is no — and to scope it narrower than "override or
not".** Ask instead who consumes the coordinate:

- **Routing** snaps to a road anyway (5.3 m, above), so a yard centre buys the
  ETA almost nothing.
- **The map marker** would be improved by it, but nothing is broken today.
- **Arrival detection** is the consumer whose question the learned point
  actually answers, and the only one visibly failing.

So: **arrival detection uses the learned point where one exists with enough
observations; everything else keeps the geocode.** That keeps the blast radius
at one rule, stays exactly reversible (delete the observations and behaviour
reverts), needs no amendment to §12.30's precision ladder, and leaves the ETA,
the ±, and the row's warnings alone. The marker and the routing can follow
later on evidence rather than in advance.

### The tension, unresolved

**One bad observation is sticky, and the cases that most need learning have
the least evidence.**

§12.27 never unsets `arrived_at`; a wrong arrival is corrected by a human or
not at all. A dispatcher who confirms while the truck is in the gate queue
0.4 mi from the dock teaches the gate. Over twenty observations that averages
out. Over the first one it does not — and **the bootstrap case has exactly one
observation by construction**, because a stop that cannot detect its own
arrivals only ever gets the one a dispatcher gives it.

So the confidence threshold that would make learning safe (enough
observations to outvote a bad one) is the threshold the stops that need it
most can never reach. Every obvious escape has a cost: requiring N
observations leaves 133 and 135 exactly where they are; accepting N=1 means a
single mistaken confirmation silently relocates a facility; weighting by dwell
length helps and does not solve it, because the gate queue is sometimes the
longest dwell of the visit.

**This is not resolved. Do not let a design proposal quietly assume it away.**

### What it would cost, and what else breaks

Roughly **2–3 days, more than half of it interface.** The table and migration
are small and the dwell clustering is a modest addition to a sweep that
already finds the closest fix. The dispatcher control is the expensive part,
and it wants the detail panel (§9.4), which does not exist — the same blocker
as the manual override for zip stops, which is either a reason to do both
together or a reason this waits.

Where it must live: keyed on the **normalised address**, beside `geocode_cache`
and emphatically **not in it**. The cache has a TTL and is swept
(`sweepGeocodeCache`); observations are measurements and must never expire.
That is the `stop_routes`-versus-`route_samples` distinction from §12.54, and
putting learned points in a table with a TTL would discard them silently. A
new `facilities` entity is the wrong shape — §12.20 deleted `facility_name`
precisely because nothing ever wrote it.

What else breaks:

1. **Cached routes invalidate.** `stop_routes` joins on the stop's
   coordinates, so adopting a learned point costs a re-route on that lane.
   Correct behaviour, real cost.
2. **The ± stops meaning what it says.** §12.54's 0.15 mi is "how far the dock
   may be from this point". If the point *is* the dock, that number should
   collapse, so the constant can no longer be applied per-precision and the
   detail line needs different words.
3. **§12.30's precision is single-valued.** A stop with both a geocoded and a
   learned point has two accuracies, and that ruling would need amending.
4. **Demo data would teach it garbage.** Any learning must be gated off
   `DEMO-` loads, or run only after the pre-deploy truncate.
5. **No automatic recovery** from a wrong learned coordinate, for the same
   reason §12.27 gives for `arrived_at`.

**Not ruled on.** The street guard (§12.55) plus a manual arrival control get
us 133 and 135 without any of this, and learning wants a real week of arrivals
before it has anything worth learning from.


# 14. The fifteen features (design turn 5)

Extracted from `design/Fleet_Tracker_dc.html` turn 5 — "Brief part 2: new
tokens, measured · the busy-day composite · what competes". Turns 1–4 are the
console that already exists; turn 5 is the only new material.

**Read this, not the HTML.** CLAUDE.md's rule stands: from phase 1 onward the
spec is the source. This section exists so that rule keeps holding for work
the designer produced without the spec in hand — their own note says *"I don't
have docs/design-spec.md; 2g + 3e are the spec being extended."*

## 14.1 What turn 5 is, and what it is not

It is three things: **5a** exact tokens with measured contrast, **5b** one
composite of a busy day with most features on screen at once, and **5c** the
collisions between features and the rule each one produced.

It is **not** the detailed screens. Turn 5 closes with "approve 5a–5c, then
detailed screens in brief order", so nine features have a measured token or a
stated rule to build against and six do not. Which is which is recorded in
§14.6, because a reviewer should be able to tell a drawn screen from an
interpretation at a glance.

Two notes the designer attached, both carried here so they are not lost with
the HTML:

- **The keymap could not be pulled from source.** No codebase was connected,
  so the cheat sheet's contents are the `2g` keymap (`/ Esc ↑↓ Enter E 1–7 0`)
  plus the new bindings proposed in turn 5 (`? ⌘K P X D`), asserted rather than
  verified. The build resolves this by rendering the sheet from a **keymap
  registry** rather than a hand-written list, so the document cannot disagree
  with the application.
- **"The brief says twelve and lists fifteen. All fifteen are in scope."**

## 14.2 The contrast defect in every existing modal

Found while measuring, and confirmed here independently:

```
text.muted #858d94 on surface.overlay #252a30 : 4.29   FAIL
text.mutedOnOverlay #949ca4 on #252a30        : 5.20   passes
```

Every modal — `2c`, `3a`, `4a`, `4c` — renders muted ink at 4.29:1, under the
4.5:1 floor. The replacement colour is already in the palette as
`mutedOnSelected`; only the ground it is used against is new.

**Why it survived:** `src/design/tokens.test.ts` enforces that no component
hardcodes a hex, which is a different rule. Nothing asserted a ratio, so a
failing pair passed every check for months. The fix ships with a contrast
test, because a measurement nothing re-runs is a measurement that was true
once.

## 14.3 Relationships decided before drawing (5a preamble)

- **The health strip is secondary.** Chips stay the filter and the only live
  count; the strip prints nothing a chip already prints. It shows the day's
  outcome — stops done, on time vs late — which no chip can express, because
  an `Arrived` chip counts trucks on site *now*, not deliveries made.
- **Multi-select is checkboxes** in a 28px leading column; shift-click on a
  checkbox extends a range. Plain shift-click on rows was **rejected**: a row
  click already means select + map follow, and ↑↓ own the selection.
- **The trail is selected-only.** Thirty trails at once would read as traffic,
  not history.
- **⌘K is navigation plus view-only actions** — pin, density, apply a saved
  view, open shortcuts. **No status writes**: a write from the palette would
  skip the reason and expiry form.
- **`?` is matched on the key value, not the physical key**, since on US
  layouts it shares a key with `/`. Suppressed inside inputs, textareas and
  contenteditable — the same guard as every other single-key binding.

## 14.4 Tokens (5a), measured

Additions only. Colours belong in `src/design/tokens.ts` and are spread into
the Tailwind config; nothing here may be spelled out in a component.

| Token · feature | Pair as rendered | Ratio | Source |
|---|---|---|---|
| `row.checked` §2 | `#949ca4` on `#1b222b` | 5.76 | = selected |
| checkbox §2 | `#6e767d` edge · tick on accent | 3.86 · 8.96 | reused |
| pin §4 | filled accent = pinned · hollow `#858d94` on hover | 8.96 · 5.30 | reused |
| `row.flash.*` §6 §14 | late `#2b1c1c` risk `#2b2417` ontime `#15261d` arrived `#19232c` | ≥ 4.56 | new |
| `trail` §9 | accent 1 → .75 → .5 → .3 → .15 on sunken | 9.45 5.79 3.21 1.91 1.33 | new |
| health bar §8 | solid · hatched · hollow on raised | 7.06–8.91 · 3.51 | reused |
| `text.mutedOnOverlay` §1 §10 §12 | `#949ca4` on `#252a30` | 4.29 → 5.20 | new · fix |
| kbd cap §1 §10 | ⌘K primary on base, hair edge | 14.91 | reused |
| `scrim` §1 §10 §12 | `rgb(9 11 13 / .72)` over base → `#0c0f11` | n/a | new |
| copied §3 | icon + the word, never hue alone | 9.82 | reused |
| favicon tile §13 | cyan on navy · navy tile on a dark tab bar | 5.57 · **1.34** | brand |

**Three measurements changed a design decision**, and each is a rule rather
than a preference:

1. **Flash peaks at 60% of `status.bg`, not at it.** At full strength the
   flash grounds fail muted ink (4.02–4.48). This is the only derived colour
   in the pass.
2. **Trail dots older than ~12 min fall below 3:1 on purpose.** They carry
   direction; the marker carries status.
3. **The favicon's navy tile disappears on a dark tab bar** at 1.34:1, so §13
   gets a 1px cyan edge at 16 and 32px.

```ts
text:  { mutedOnOverlay: '#949ca4' },
row:   { checked: '#1b222b',                    /* = selected */
         flash: { late: '#2b1c1c', risk: '#2b2417',
                  ontime: '#15261d', arrived: '#19232c',
                  neutral: '#1f2327' } },       /* status.bg @ 60% over base */
trail: { DEFAULT: '#94bce3', ramp: [1, .75, .5, .3, .15] },  /* newest → 30 min */
scrim: 'rgb(9 11 13 / .72)',
spacing: { 'row-comfortable': '44px', 'row-compact': '32px',
           'chip-comfortable': '21px', 'chip-compact': '18px' },
transitionDuration: { flash: '1600ms', chip: '160ms',
                      'toast-in': '180ms', 'toast-out': '120ms',
                      overlay: '120ms' },
transitionTimingFunction: { flash: 'cubic-bezier(.2,0,0,1)',
                            toast: 'cubic-bezier(.2,.8,.2,1)' },
```

### The whole motion budget

| | |
|---|---|
| **Flash** | ground jumps to `row.flash` at 0ms, decays to its resting ground over 1600ms. No border flash, no scale. |
| **Chip flip** | old chip fades out as the new fades in, 160ms. Width **snaps** — no layout animation. |
| **Toast** | in: 8px rise + fade, 180ms. Out: fade, 120ms. Never takes focus. |
| **Overlays** | palette, cheat sheet, tour: opacity only, 120ms. |
| **Reduced motion** | everything becomes 0ms, and the flash is replaced by a static `◆ changed 04:11` tag after the chip for 60s. **The signal survives without the motion** — it is not simply dropped. |

## 14.5 What competed, and the rule each collision produced (5c)

These are the load-bearing decisions. Each one exists because two features
wanted the same pixels.

| Collision | Rule |
|---|---|
| **Flash vs checked ground** | Both tint the row. Flash wins for its 1.6s, then the row settles to `row.checked`. Checked state is carried by the tick, so nothing is lost while the ground is borrowed. |
| **Re-sort under the cursor** | A flip re-sorts the row, and with a flash that is legible. But while the pointer is over the list, or 2+ rows are checked, re-sort is **held (max 10s)** so a click never lands on a row that just moved. The flash and toast still fire in place. |
| **Bulk bar vs fold footer** | The same 44px slot. The bar replaces the footer while 2+ are checked, and keeps the one fact that mattered — the problems-below-the-fold count — at its right end. |
| **Pinned vs urgency groups** | Above 40 trucks (`3d`) the pinned block sits above the first group header. Pinned trucks are **removed from their group, not duplicated**, and the group count reads "Late 4 · +1 pinned". Cap of 5 so the block never pushes the problem set below the fold. |
| **Pin vs checkbox vs copy** | Three per-row affordances, three different cells: checkbox in its own column, pin after the truck number, copy at the right edge of `Next stop` and the load cell, **on hover only**. None shares a hit area; none widens a fixed column. |
| **Search field vs ⌘K** | Two text boxes that both find trucks, split by verb: `/` filters the list in place, `⌘K` jumps and closes. The placeholder becomes "Filter list…" and shows both hints. |
| **Health strip vs chips** | No number appears in both. Chips: trucks by state now. Strip: stops done today, split on time / late. Placed in the **list toolbar**, not the header, so it is read with the list rather than competing with the chip row. |
| **Trail vs markers** | Dots, no stroke, 4–5px — smaller than any marker (14px+) and **never a line**, so a future route preview can own the solid line. The selected marker gains a steel edge so trail and head read as one object. |
| **Toast placement** | Moves to the map's top-right: bottom-left now belongs to the bulk bar, and the list's top holds the pinned block. |
| **Overlays** | Palette, cheat sheet and tour share one scrim and one layer, **only one open at a time**. `⌘K` during the tour ends the tour; `?` inside the palette types a "?". |

### Two collisions that resolved differently here (build notes)

**The re-sort hold guards a mechanism this console does not have.** §14.5
holds re-sort for up to 10s while the pointer is over the list or 2+ rows are
checked, "so a click never lands on a row that just moved". That assumes a
list which re-sorts itself on new data. §12.4 settled the opposite in phase 1:
order is computed on mount, on a filter or search change, and on explicit user
action — **a poll never moves a row**. The hazard is already impossible, by a
stronger mechanism than a timer.

What survives is the *offer*. The "3 rows would reorder" pill appears in flow
at the top of the list the moment drift becomes non-zero, and everything below
shifts down by its height — the same defect with a smaller displacement. So
the hold applies to the pill, on the same two conditions and the same ten
seconds (`src/hooks/useResortHold.ts`). If §12.4 is ever relaxed, the rule is
already here and only its subject changes.

**The toast has a third neighbour the brief did not see.** §14.5 moves the
toast to the map's top-right because the bulk bar takes bottom-left. The map's
top-right already holds the zoom control (§7), which turn 5 was not drawing
against. The stack therefore anchors to the map's top-right *below* the zoom
control rather than beside it: a 340px toast inset far enough to clear a 28px
control reads as misaligned, and moving existing map chrome to make room is a
change nobody asked for.

**Feature 7's "loading" half has nothing to attach to, and that is correct.**
`src/app/page.tsx` renders on the server with the fleet already loaded and
hands it to `useFleet` as `initialData`; the query then keeps the last good
fleet through every refetch (`placeholderData`), because a console that blanks
every 20 seconds is unusable on a night shift. So `data` is never undefined
and a skeleton would have been dead code from the day it shipped.

The two moments that genuinely are a wait are covered instead: a refetch in
flight by the header's fetch age, and a refetch that FAILED by a new banner.
That second one was a real hole — every number on screen simply stopped moving
and nothing said why. It is amber rather than §9.8's red, and the two can show
together: §9.8 says the positions are old and an ETA must not be quoted from
them; this says the console stopped being able to ask. Different causes,
different fixes.

The empty half is five reasons, not one, decided in `src/lib/empty-state.ts`
as a pure function of five counts. The ordering is the load-bearing part,
because the reasons nest — a search matching nothing inside a chip set that
matched nothing has to report the chips, since clearing the search would not
help. The fifth reason is the one the console could not have had before this
phase: everything that matched is in the pinned block a few pixels above.

**The health strip needed a fourth case §14.4's three treatments did not
have.** The token table names "solid · hatched · hollow" and measures
7.06–8.91 · 3.51; those land exactly on `status.ontime.fg` (8.91),
`status.late.fg` (7.06) and `status.neutral.bd` (3.51) against
`surface.raised`, all verified in `contrast.test.ts`.

The data has four states, not three. A stop arrived with no appointment on
file cannot be scored: calling it on time flatters the board, calling it late
invents a failure, and dropping it from the bar makes the printed "11 of 31
done" disagree with the segments beside it. It gets its own segment in
`status.neutral.fg`, which measures **8.25** — inside §14.4's own stated
7.06–8.91 band, so the measured range does not move. A fourth ink, not a
fourth treatment: still solid, told apart by position and by the words printed
beside the bar rather than by hue alone (§5.1).

The lateness rule is `status.ts`'s, restated rather than reinvented: the
deadline is `apptEndUtc ?? apptStartUtc` and the window IS the grace (§12.1).
The engine is read for the rule and neither imported nor executed — it
evaluates a live truck against `now`, and this evaluates a finished stop
against its own appointment. `status.ts` is untouched, as §14.6 requires while
the §12.61 shadow run collects.

One asymmetry, deliberate: `remaining` is keyed off the APPOINTMENT's day and
`done` off the ARRIVAL's. A stop due yesterday and arrived this morning
belongs in exactly one of them — the second.

**The trail's steel edge already existed.** §14.5 asks that "the selected
marker gains a steel edge so trail and head read as one object".
`selectionLayer` has carried a 2px `accent.DEFAULT` stroke since phase 2, so
the requirement is met by what is there; adding a second edge would have
doubled the ring. The trail source is declared before it, so the dots paint
underneath.

**The trail drops its newest reading.** It is built from position history, and
the newest history row is the one the marker is drawn at — keeping it would
put a full-opacity dot under a 14px marker and spend the brightest step of
`TRAIL_RAMP` saying what the marker already says.

It buckets by AGE rather than taking the last five rows. The worker polls
every 30 seconds, so the last five rows are the last two and a half minutes —
a trail that never reaches past the end of the block the truck is on.
Bucketing into five six-minute steps spreads the dots across the whole half
hour whatever the poll cadence does, and degrades honestly: a truck tracked
for nine minutes gets two dots, not five crowded ones. A parked truck yields
five dots at one coordinate, which draws as one dot beside the marker — that
is what "has not moved in half an hour" looks like, and is not a bug.

The query returns one row per MINUTE. The feed sends several readings per
vehicle per poll (one truck carried five, five seconds apart), so half an hour
of raw history is between 60 and 300 rows and the shape of that number is the
vendor's business. `distinct on` a truncated minute caps it at thirty.

**Views and the palette, and the one thing that decided their shape.** §14.6
put views first "because ⌘K applies a saved view and would otherwise ship with
a dead entry", and that held.

A **view** is the chip set and the search term — the two things that decide
which trucks are on screen — and deliberately not the selected truck (a
cursor; saving it would make applying a view move the map), the row density
(a person's preference, which would then fight `D`) or the pinned block
(also a person, and applying a view must never change which trucks someone
chose to watch). It refuses rather than overwrites, on the pin cap's ruling.

§14.3's **no-writes rule** for ⌘K is enforced where the catalogue is built
rather than remembered at each call site: `lib/palette` has a closed `ACTION`
set and a closed `kind` set, so a writing command cannot be added without
adding a kind and failing a test. Two candidates were considered and left
out — "Clear the filters", which is `0` and a saved view away, and "Open the
selected stop", which raises a form that writes. That form is the line the
rule draws.

**The last `planned` binding has shipped.** `KEYMAP` now has none, so
`ShortcutSheet`'s greyed "not yet" branch is asserted against zero. The
assertion and the branch both stay: they regain force the moment a proposed
key is added to the map ahead of its handler, which is exactly when a sheet
listing a dead key does damage.

**§14.5's "the placeholder becomes 'Filter list…' and shows both hints"** is
the only place a dispatcher finds out the second box exists, so the field
prints two caps — `/ filter` and `⌘K jump` — rather than the single `/` it
carried since phase 2.

**The timeline sits next to three deferred surfaces, so the line is drawn in
the query rather than in a component.** §12.15 defers **History**, the
**audit-log view** and **override review** to v2, and warns that the `History`
button in §9.4's detail panel needs hiding until then because it would
"promise a reversal path that does not exist". §14 feature 15 asks for a
per-truck timeline, which is adjacent to all three.

What it does:

- Reads `stops`, `loads`, `overrides` and `profiles` — **never `audit_log`**.
  That table is written on every edit and nothing reads it back; the first
  thing that does should be the audit view, designed as one.
- Shows the overrides on **this truck's** stops. `4c`'s deferred override
  review is a fleet-wide weekly screen for judging whether overrides are used
  honestly; this answers "why does this truck say ARRIVED when it is on the
  interstate", which the row already half-answers with the forced glyph.
- Carries **no action at all** — no undo, no restore, no reverse — and says so
  at its foot: *"A record, not a control."* Silence about having no undo
  invites exactly the question the deferral was meant to close.

Three smaller rulings inside it. `stopState` is read off `arrived_at` and
`departed_at` and never off `loads.status`, which is a label for the whole
load and can say `AT_RECEIVER` while the second of three stops is ahead. An
override has **three** end states, not two — cleared is a dispatcher changing
their mind, expired is §9.5 working as designed, and printing both as "ended"
loses the only interesting difference. And lateness restates §12.1's rule
exactly as §14 feature 8 does: the deadline is `apptEnd ?? apptStart`, and the
window is the grace.

It opens from the map popup and is **not** on the shared overlay layer. That
layer is the palette, the cheat sheet and the tour, and "only one at a time"
is its whole point — a timeline must not close the tour that is explaining
it. It sits at z-40 beside `EditStopModal`, which is the precedent for a
surface outside that set, and it needs no discard confirm because it holds
nothing.

**§14.5's shared scrim decided what the tour is.** *"Palette, cheat sheet and
tour share one scrim and one layer, only one open at a time."* A tour that
cuts a hole in the scrim to point at a control cannot share a scrim — it needs
its own geometry, measured against whichever element it points at, and the
moment it has that it is a second layer wearing the first one's name. So it is
a stepped panel that NAMES the surfaces rather than a spotlight that points at
them.

The second reason is stronger than the first. A spotlight has to know where a
control is, so every step becomes a ref into a component and the tour breaks
silently when that component moves. This breaks loudly instead: every key a
step names is looked up in `KEYMAP`, and a step naming a key the console does
not have fails a test. It is §14.1's cheat-sheet argument applied to the one
other surface that describes the console to a person.

"Has seen the tour" is stored as a **version, not a boolean**, so a step added
to explain a new feature can show itself again without showing the whole tour
to someone who has already read it.

It does **not** open itself when `localStorage` is unavailable. A tour that
cannot record having been seen would open on every single load, which is worse
than never opening — and private browsing, a blocked origin and a server
render all land there. The shortcut sheet offers it back, so it is never
unreachable, and being skipped counts as having been seen: crediting only
"Done" teaches people to close it faster rather than to read it.

## 14.6 Build order, and what each feature was built from

Two deviations from the brief's order, both forced by §14.5: **density before
bulk and pinned**, because the bulk bar and the checkbox column depend on the
row geometry being settled; and **saved views before the palette**, because
⌘K applies a saved view and would otherwise ship with a dead entry.

| # | Feature | Stage | Built from |
|---|---|---|---|
| — | tokens, contrast fix, contrast test | 0 | **approved** (5a) |
| — | keymap registry | 0 | interpretation — enabling work |
| — | shared overlay layer | 0 | **approved** (5c overlays) |
| 1 | keyboard cheat sheet (`?`) | 1 | interpretation (contents listed, no screen) |
| 5 | row density toggle | 2 | **approved** (5a spacing pair) |
| 2 | bulk override / bulk note | 2 | **approved** (5a, 5c) |
| 4 | recent/pinned trucks | 2 | **approved** (5c) |
| 3 | copy address / load info | 2 | interpretation (placement ruled, formats not) |
| 6 | flash on change | 3 | **approved** (5a motion, 5c) |
| 14 | toast/status transitions | 3 | **approved** (5a motion, 5c) |
| 7 | empty / loading states | 3 | interpretation |
| 8 | fleet health strip | 4 | **approved** (5a, 5c) |
| 9 | movement trail | 4 | **approved** (5a ramp, 5c) |
| 11 | saved filter views | 5 | interpretation |
| 10 | command palette (⌘K) | 5 | **approved** (5b, 5c) |
| 15 | per-truck timeline | 6 | interpretation |
| 12 | onboarding tour | 6 | interpretation |
| 13 | favicon / branding | 6 | **held** — see below |

**§13 is held.** The only asset in the repo is a 500×302 JPEG named
`logo.png`, which is too weak a source for a 16px tile, and the `SmallLogo.png`
derivatives the brief says to drop do not exist here. 5a's requirement — a 1px
cyan edge at 16/32px, because the navy tile reads 1.34:1 on a dark tab bar —
stands and is waiting on a better source.

**The strip's one boundary.** "Stops done today, on time vs late" is not on
the fleet row, so §8 derives it in a separate read-only query. It does not
touch the routing or status modules, which are frozen while the §12.61 shadow
run collects.

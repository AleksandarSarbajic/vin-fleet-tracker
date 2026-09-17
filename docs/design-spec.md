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
| **≥ 2200** | Ultrawide. Map grows to 980px; list keeps its 8 columns and gains Trailer + Broker. All header chips visible. |
| **1440–2199** | Reference layout. Header 56, then the `3b` draggable split — default 60/40 in the list's favour (at 1728: list 1037, map 685, handle 6). Map hard minimum 520px, list minimum 560px. Position persisted per dispatcher. **The map is never a fixed width.** |
| **1280–1439** | Split still draggable, range narrows to map 520–620. Driver column drops to **120px**; Position and Next stop share the remainder. |
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

## 5.7 Urgency groups (above 40 trucks)

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

**Load & contacts** — `Broker` · `Trailer` · `Driver cell` · `Dispatcher` ·
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
- `Trailer` — text, tabular

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
| **Toast preferences** | `2h`'s "status-change toasts are opt-in per chip" — there is no settings surface |
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

---

# 13. Still open

The five contradictions found during extraction. **These have not been ruled
on.** Four are cosmetic or deferred; one needs a decision before the list is
built in phase 3.

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

## 13.3 The 560px list minimum cannot hold the 8-column row — **needs a decision**

The blocking one. Non-flexible width of the console row is **693px** (fixed
columns + gaps + padding). The `3b` list minimum is **560px**. With `2g`'s
1280-breakpoint step of Driver 148 → 120 it is still 665px.

Not created by correction 2 — it was 671px before — but the correction makes
it 22px worse.

The design's own answer looks like the **`1b` two-line row**, whose caption
reads *"for the 560–640px list panel beside the map"*. Its non-flexible width
is 331px, leaving 229px of flexible column at a 560px list. But `2g`'s
breakpoint table ties two-line rows to **viewport `< 1024`**, not to list
width.

**Proposed:** the row variant is chosen by **list-panel width, not viewport
width** — single-line above roughly 940px of list, `1b` two-line below it.
That makes both statements true and makes the 560px minimum meaningful.

**Phase 3 needs this settled before the list is built.**

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

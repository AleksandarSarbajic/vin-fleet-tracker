# Samsara — the fields this worker actually parses

**Org 45975. Every response below was pulled from the live org on
2026-09-17** and re-confirms the 2026-09-16 findings in `PROJECT_BRIEF.md`.

The official docs describe what the API *can* return. This file records what
**our org actually returns**, because that is what the worker has to parse.
Where the two differ, the observed shape wins and the difference is called out.

Sections marked **VERIFIED** were observed in a real response. Sections marked
**DOCUMENTED** come from Samsara's reference and have **not** been exercised
here — treat them as unproven.

Base URL `https://api.samsara.com`, auth `Authorization: Bearer <token>`.

**Token scopes granted:** Read Vehicles, Read Vehicle Statistics, Read
Drivers, Read Assignments. Nothing else. A 403 means find another way or
raise it — do not ask for a broader token.

---

## 1. `GET /fleet/vehicles` — **VERIFIED**

The fleet roster. Polled rarely (name/VIN changes), not on the 30s loop.

Real response, trimmed to one vehicle:

```json
{
  "data": [
    {
      "id": "212014918912099",
      "name": "Truck #147",
      "vin": "4V4WC9EH7JN893474",
      "serial": "GKJV2N8287",
      "make": "VOLVO TRUCK",
      "model": "VNR",
      "year": "2018",
      "licensePlate": "P1333460",
      "notes": "",
      "tags": [{ "id": "4894533", "name": "Kamion 129" }],
      "externalIds": {
        "samsara.serial": "GKJV2N8287",
        "samsara.vin": "4V4WC9EH7JN893474"
      },
      "gateway": { "serial": "GKJV-2N8-287", "model": "VG34" },
      "harshAccelerationSettingType": "heavyDuty",
      "vehicleRegulationMode": "regulated",
      "createdAtTime": "2019-06-07T20:18:12Z",
      "updatedAtTime": "2026-07-06T19:26:26Z",
      "esn": "17313574"
    }
  ],
  "pagination": { "endCursor": "SAEBALgBAgMAeC83RY…", "hasNextPage": false }
}
```

### What we take

| Field | Stored as | Note |
|---|---|---|
| `id` | `trucks.samsara_vehicle_id` | **String**, not a number. 15 digits — do not parse to int. |
| `name` | `trucks.samsara_name` | Raw, e.g. `"Truck #147"` |
| *(parsed from `name`)* | `trucks.truck_number` | `147` |

### Three traps, all confirmed live

1. **`name` is `"Truck #147"`, not `147`.** Store the raw string and a parsed
   number. The console renders the bare number in a tabular column.

2. **`tags` disagrees with `name`. Never use it for truck numbers.**
   Observed in this org:

   | `name` | `tags[0].name` | Agrees? |
   |---|---|---|
   | `Truck #147` | `Kamion 129` | **no** |
   | `Truck #132` | `Kamion 132` | yes |

   The disagreement is not systematic, which makes it worse — a tag-based
   parse looks correct across most of the fleet. `name` is the source of
   truth.

3. **There is no active flag on a vehicle.** No field in this payload says
   whether a truck is in service. `createdAtTime` on the first vehicle is
   **2019**. `trucks.active` is ours — see §3.

4. **One vehicle is named exactly `"Truck"`, with no number.** So
   `parseTruckNumber` returns null and `trucks.truck_number` is null for it.
   33 of 34 parse. The row must fall back to `samsara_name` rather than
   render a blank cell — the console's Truck column is the one thing that
   never truncates and never empties.

---

## 2. `GET /fleet/vehicles/stats` — **VERIFIED**

Point-in-time snapshot for every vehicle. Used for **seeding**, not for the
poll loop (§4 is the poll loop).

`?types=gps,engineStates,obdOdometerMeters`

```json
{
  "id": "212014918912099",
  "name": "Truck #147",
  "externalIds": { "samsara.serial": "GKJV2N8287", "samsara.vin": "4V4…" },
  "engineState":       { "time": "2026-09-16T16:49:06Z", "value": "Off" },
  "obdOdometerMeters": { "time": "2026-09-16T16:49:06Z", "value": 858255830 },
  "gps": {
    "time": "2026-09-16T16:53:43Z",
    "latitude": 41.548277,
    "longitude": -87.980377,
    "headingDegrees": 0,
    "speedMilesPerHour": 0,
    "reverseGeo": { "formattedLocation": "Maple Road, New Lenox, IL, 60451" },
    "isEcuSpeed": false
  }
}
```

Note the shape: each requested stat is a `{time, value}` pair, **except
`gps`**, which is a flat object carrying its own `time`.

### `gps.reverseGeo.formattedLocation` — present and populated

This is why there is **no geocoding service** in this project, and nothing to
cache. Two real values:

```
"Maple Road, New Lenox, IL, 60451"
"3181 Evergreen Lane Southwest, Alexandria, MN, 56308"
```

**The ZIP is optional, and the component count does not identify the shape.**
Measured over 301 real readings ingested on 2026-09-17, plus a 34-vehicle
snapshot:

| Shape | Example | Seen |
|---|---|---|
| `street, city, state, zip` | `1250 171st Street, East Hazel Crest, IL, 60429` | common |
| `city, state, zip` | `Hodgkins, IL, 60480` | common |
| `street, place, state` | `I-94 W, Douglas County, MN` | 105 of 301 readings |
| `street, place, state` | `I 39;I 90, Town of Pleasant Springs, WI` | — |

Two traps here:

1. **A 3-part value is ambiguous.** `Hodgkins, IL, 60480` is
   `city, state, zip`; `I-94 W, Douglas County, MN` is `street, place,
   state`. Counting components cannot tell them apart.
2. **35% of readings carry no ZIP.** Taking a fixed offset from the right —
   "the last three are city, state, zip" — renders
   `I 39;I 90, Town of Pleasant Springs` as the city on every one of them.

The rule that works on all four shapes: **test whether the last component is
a ZIP (`^\d{5}(-\d{4})?$`); drop it if so; then take the last two as
`city, state`.** `cityState()` in `src/samsara/schemas.ts` does this, tested
against every literal above. It falls back to returning the whole string
rather than guessing, because a long cell is better than a wrong place.

Note also `I 39;I 90` — a semicolon-joined pair of route numbers. Do not
assume a component is a single name.

Store the string **whole** in `positions.formatted_location`. The Position
column renders `cityState()`; the detail panel and tooltip get all of it.

### `headingDegrees` is 0 on a stationary vehicle

Observed above: `headingDegrees: 0` with `speedMilesPerHour: 0`. That is not
"pointing north", it is "no heading". **Do not rotate the map marker when
`speedMilesPerHour` is 0.**

### `engineState.value`

Observed: `"Off"`, `"Idle"`. `"On"` is **DOCUMENTED** but was not seen in
this sample. Parse it as an open string, not a closed enum, and do not branch
on a value you have not seen.

---

## 3. The feed contains dead trucks — **VERIFIED**

A single `/fleet/vehicles/stats?types=gps` call on 2026-09-17 returned
**34 vehicles**, every one with a `gps` reading. Age of those readings:

| Age of newest fix | Vehicles |
|---|---|
| under 1 hour | 21 |
| 1–24 hours | 2 |
| 1–7 days | 0 |
| 7–30 days | 1 |
| 30–180 days | 9 |
| **over 180 days** | **1** |

Newest: `Truck #133`, 6 minutes old. Oldest: **`Truck #111`, 226.6 days** —
roughly seven and a half months.

**11 of 34 vehicles — a third of the feed — have not moved in over a week.**
They are parked or decommissioned, and Samsara still returns them with their
last known position, indistinguishable in shape from a live truck.

### Consequence

`trucks.active` is **ours**:

- **Seed** from position recency: a fix within the last 24h = active. On this
  sample that is **23 active, 11 inactive**.
- An admin flips it by hand afterwards.
- The console shows only active trucks; the rest sit behind the `Inactive`
  filter chip (design-spec §12.14).

**Never render the raw Samsara vehicle list as the fleet — a third of it is
history.**

---

## 4. `GET /fleet/vehicles/stats/feed` — **VERIFIED**. The poll loop.

Incremental. This is the 30s endpoint.

### It is genuinely incremental — measured

| Call | Params | Rows returned |
|---|---|---|
| 1 (cold, no cursor) | `?types=gps` | **34** — full snapshot |
| 2 | `?types=gps&after=<endCursor>` | **1** — only what changed |

### The shape differs from `/stats` — this is the trap

**In `/fleet/vehicles/stats`, `gps` is an object. In
`/fleet/vehicles/stats/feed`, `gps` is an ARRAY** of every reading since the
cursor.

```json
{
  "data": [
    {
      "id": "212014918912099",
      "name": "Truck #147",
      "externalIds": { "samsara.serial": "GKJV2N8287", "samsara.vin": "4V4…" },
      "gps": [
        {
          "time": "2026-09-16T16:53:43.007Z",
          "latitude": 41.548277,
          "longitude": -87.980377,
          "headingDegrees": 0,
          "speedMilesPerHour": 0,
          "reverseGeo": { "formattedLocation": "Maple Road, New Lenox, IL, 60451" },
          "isEcuSpeed": false
        }
      ]
    }
  ],
  "pagination": {
    "endCursor": "9f8df2e4-83ee-4faa-b1a7-4302688a1b3c",
    "hasNextPage": false
  }
}
```

Code that reads `row.gps.latitude` works against `/stats` and silently yields
`undefined` against the feed. The Zod schemas in `src/samsara/schemas.ts`
model the two separately so this cannot compile.

On a cold call every vehicle carried exactly **1** reading (34 readings
total). A vehicle may carry more when it has moved several times between
polls, so **iterate the array; never take `[0]`**.

### Timestamp precision differs too

- `/stats` → `"2026-09-16T16:53:43Z"` (second precision)
- `/feed`  → `"2026-09-16T16:53:43.007Z"` (millisecond precision)

The same instant, rendered two ways. `positions` has a unique index on
`(truck_id, recorded_at)`, so ingesting the *same* fix from both endpoints
would produce two rows 7ms apart rather than a conflict. **The worker reads
the feed only**; `/stats` is for seeding, and seeded rows are written before
the feed cursor is ever established.

### Cursor

`pagination.endCursor` is a **UUID** on this endpoint
(`9f8df2e4-83ee-4faa-b1a7-4302688a1b3c`), and a long opaque blob on
`/fleet/vehicles`. Treat both as opaque strings.

**Persist the cursor in `feed_health.cursor`, not in memory**, so a worker
restart resumes instead of re-ingesting from cold.

`hasNextPage` was `false` at this fleet size. Honour it anyway and drain
pages before advancing the stored cursor.

---

## 5. `GET /fleet/drivers` — **VERIFIED**

```json
{
  "id": "50657637",
  "name": "Roman De Los Santos",
  "driverActivationStatus": "active",
  "timezone": "America/Chicago"
}
```

**24 drivers** in this org on 2026-09-17, every one with
`timezone: "America/Chicago"`.

### Every field this endpoint returns for our org

```
carrierSettings   createdAtTime   driverActivationStatus   eldSettings
hasVehicleUnpinningEnabled        hosSetting               id
licenseNumber     licenseState    name                     timezone
updatedAtTime     username
```

### We store exactly three

| Field | Stored as |
|---|---|
| `id` | `drivers.samsara_driver_id` |
| `name` | `drivers.name` |
| `driverActivationStatus` | `drivers.active` (`"active"` → true) |

**Store nothing else.** `licenseNumber` and `licenseState` are liability with
no use here. `eldSettings` and `hosSetting` are the HOS data this project cut
— they are present in the payload, and that is exactly why the rule needs
stating rather than assuming.

### No phone numbers

**There is no `phone` field in this response.** `drivers.phone` is entered by
dispatchers in our app. The detail panel hides "Call driver" when it is null
rather than rendering a dead button.

### Every driver's `timezone` is `America/Chicago`

Consistent with the dispatch timezone. It is **not** used for appointments —
those carry the *stop's* zone, not the driver's.

---

## 6. `GET /fleet/driver-vehicle-assignments` — **VERIFIED**

### `filterBy` is mandatory

| Request | Result |
|---|---|
| no `filterBy` | **HTTP 400** |
| `?filterBy=vehicles` | HTTP 200 |
| `?filterBy=drivers` | HTTP 200 |

**The 400 is a parameter error, not a scope error.** Do not go asking for a
broader token when you see it.

### This org has no assignments

Both filters return the same thing:

```json
{ "data": null, "pagination": { "endCursor": "", "hasNextPage": false } }
```

`data` is **`null`**, not `[]`. Any code doing `data.map(...)` throws. The
schema coerces null to an empty array at the boundary.

### Consequence — this changes the build

Samsara holds **no** driver↔truck assignments for this org, so there is
nothing to sync and nothing to seed from. `assignments` is entirely **our**
table, written by dispatchers through the edit modal in phase 4.

The worker does **not** poll this endpoint. It is documented here so nobody
spends an afternoon working out why the sync produces nothing.

---

## 7. Rate limiting — partly **DOCUMENTED**

**VERIFIED:** responses from this org carry **no** `X-RateLimit-*` and no
`Retry-After` header. Checked on a 200 from the feed endpoint; the only
timing header is `date`.

So there is nothing to read our remaining budget from. The limiter is
**self-imposed**, not header-driven:

- Token bucket, conservative, configured in one place.
- Exponential backoff with **full jitter** on 429 and 5xx.
- Circuit breaker that stops hammering a dead API.
- **A log line for every throttle event**, so a rate problem is visible in
  the log rather than inferred from missing data.

**DOCUMENTED:** Samsara publishes per-endpoint limits well above what one
30s poller uses. We are not near them — the limiter exists so that a retry
storm or a second worker instance cannot get there either.

If a 429 ever does carry `Retry-After`, the client honours it in preference
to its own backoff.

---

## 8. What the worker actually calls

| Endpoint | When | Why |
|---|---|---|
| `/fleet/vehicles/stats/feed?types=gps` | every 30s | positions |
| `/fleet/vehicles` | on seed, then hourly | roster, names |
| `/fleet/vehicles/stats?types=gps` | on seed only | backfill last-known position, derive `active` |
| `/fleet/drivers` | on seed, then hourly | driver roster |
| `/fleet/driver-vehicle-assignments` | **never** | returns null for this org (§6) |

Nothing is ever written back to Samsara. Samsara owns position, odometer and
engine state; we own all dispatch data.

---

## 9. Re-verifying

```bash
npm run samsara:probe
```

Re-runs the calls behind this document against the live org and prints what
changed. Run it when something here stops matching reality.

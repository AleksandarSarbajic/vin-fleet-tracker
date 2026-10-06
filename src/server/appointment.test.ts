import { execFileSync } from 'node:child_process';
import { afterAll, describe, expect, it } from 'vitest';
import { createPooledDb } from '@/db/connection';
import { AppointmentInput, AppointmentTimeError, fcfsEndDate } from '@/lib/appointment';
import { wallTimeInstant } from '@/lib/format';
import { eveningBefore, fallBack, localDateOf, springForward, transitions, YEAR } from '@/test/dst';
import { resolveAppointment } from './appointment';

/**
 * The appointment boundary.
 *
 * A rate confirmation reading 14:30 means 14:30 at the receiver. Everything
 * here exists to keep that true across DST, across zones, and across whatever
 * timezone the machine doing the saving happens to be set to.
 *
 * Every date is DERIVED — the DST transitions are found by asking Intl where
 * the offset changes, never pasted from a calendar that goes stale.
 */

const url = process.env.DATABASE_URL;
const withDb = url ? describe : describe.skip;

let handle: ReturnType<typeof createPooledDb> | null = null;
const connect = () => (handle ??= createPooledDb(url!));
afterAll(async () => {
  await handle?.client.end({ timeout: 5 });
});

const appt = (
  date: { y: number; m: number; d: number },
  h: number,
  min: number,
  tz: string,
  extra: Partial<{ type: 'APPT' | 'FCFS'; windowMinutes: number | null }> = {},
) =>
  AppointmentInput.parse({
    type: extra.type ?? 'APPT',
    date,
    time: { h, min },
    tz,
    windowMinutes: extra.windowMinutes ?? null,
  });

/* ------------------------------- the schema ------------------------------ */

describe('the wire contract', () => {
  it('refuses a UTC instant by name instead of ignoring it', () => {
    const result = AppointmentInput.safeParse({
      type: 'APPT',
      startUtc: '2026-09-18T19:30:00Z',
      date: { y: 2026, m: 9, d: 18 },
      time: { h: 14, min: 30 },
      tz: 'America/Chicago',
      windowMinutes: null,
    });
    expect(result.success).toBe(false);
    // Named, not silently dropped — a dropped key is an appointment saved
    // from whatever else happened to parse.
    expect(JSON.stringify(result.error?.issues)).toContain('startUtc');
  });

  it('refuses an offset where a facility zone belongs', () => {
    for (const tz of ['UTC', 'GMT', '+05:30', 'Etc/GMT-5', 'UTC-5']) {
      expect(AppointmentInput.safeParse(appt({ y: 2026, m: 9, d: 18 }, 14, 30, 'America/Chicago'))
        .success).toBe(true);
      const bad = AppointmentInput.safeParse({
        type: 'APPT',
        date: { y: 2026, m: 9, d: 18 },
        time: { h: 14, min: 30 },
        tz,
        windowMinutes: null,
      });
      expect(bad.success, tz).toBe(false);
    }
  });

  it('refuses an unknown zone', () => {
    expect(
      AppointmentInput.safeParse({
        type: 'APPT',
        date: { y: 2026, m: 9, d: 18 },
        time: { h: 14, min: 30 },
        tz: 'America/Chicagoo',
        windowMinutes: null,
      }).success,
    ).toBe(false);
  });

  it('refuses a window on an FCFS stop', () => {
    // §12.2: a cutoff is not a slot. appointment_end_utc stays null.
    const bad = AppointmentInput.safeParse({
      type: 'FCFS',
      date: { y: 2026, m: 9, d: 18 },
      time: { h: 14, min: 30 },
      tz: 'America/Chicago',
      windowMinutes: 30,
    });
    expect(bad.success).toBe(false);
  });

  it('refuses out-of-range parts', () => {
    for (const time of [{ h: 24, min: 0 }, { h: -1, min: 0 }, { h: 12, min: 60 }]) {
      expect(
        AppointmentInput.safeParse({
          type: 'APPT',
          date: { y: 2026, m: 9, d: 18 },
          time,
          tz: 'America/Chicago',
          windowMinutes: null,
        }).success,
      ).toBe(false);
    }
  });
});

/* ---------------------------- the conversion ----------------------------- */

withDb('conversion, against the real database', () => {
  it('stores 14:30 at the stop as the instant 14:30 happens there', async () => {
    const { db } = connect();
    const r = await resolveAppointment(db, appt({ y: 2026, m: 9, d: 18 }, 14, 30, 'America/Chicago'));
    expect(r.startUtc).toBe('2026-09-18T19:30:00.000Z');
    expect(r.resolution).toBe('exact');
    expect(r.tz).toBe('America/Chicago');
  });

  it('adds the ± window to the end, and leaves an exact time open-ended', async () => {
    const { db } = connect();
    const windowed = await resolveAppointment(
      db,
      appt({ y: 2026, m: 9, d: 18 }, 14, 30, 'America/Chicago', { windowMinutes: 30 }),
    );
    expect(windowed.endUtc).toBe('2026-09-18T20:00:00.000Z');

    // An APPT with no window is a single instant; FCFS is covered separately,
    // because since §12.22 it carries receiving hours and MUST have an end.
    const exact = await resolveAppointment(
      db,
      appt({ y: 2026, m: 9, d: 18 }, 14, 30, 'America/Chicago'),
    );
    expect(exact.endUtc).toBeNull();
  });

  it('round-trips every hour of an ordinary day', async () => {
    const { db } = connect();
    for (let h = 0; h < 24; h += 1) {
      const r = await resolveAppointment(db, appt({ y: 2026, m: 6, d: 15 }, h, 15, 'America/Chicago'));
      const back = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'America/Chicago',
        hourCycle: 'h23',
        hour: '2-digit',
        minute: '2-digit',
      }).format(new Date(r.startUtc));
      expect(back, `hour ${h}`).toBe(`${String(h).padStart(2, '0')}:15`);
    }
  });
});

withDb('DST, with every date derived', () => {
  it('Phoenix never moves, so the same wall time is the same offset all year', async () => {
    const { db } = connect();
    expect(transitions('America/Phoenix', YEAR)).toHaveLength(0);

    const january = await resolveAppointment(db, appt({ y: YEAR, m: 1, d: 15 }, 14, 30, 'America/Phoenix'));
    const july = await resolveAppointment(db, appt({ y: YEAR, m: 7, d: 15 }, 14, 30, 'America/Phoenix'));
    const offsetOf = (iso: string, wallHour: number) =>
      (new Date(iso).getUTCHours() - wallHour + 24) % 24;
    expect(offsetOf(january.startUtc, 14)).toBe(offsetOf(july.startUtc, 14));
  });

  it('refuses the hour that does not exist on the spring-forward date', async () => {
    const { db } = connect();
    const moment = springForward('America/Chicago', YEAR);
    const date = localDateOf('America/Chicago', moment);
    // The wall hour the clocks skip: 02:00 -> 03:00 in the US.
    const skipped = new Date(moment.getTime() - 60_000);
    const skippedHour = Number(
      new Intl.DateTimeFormat('en-GB', {
        timeZone: 'America/Chicago', hourCycle: 'h23', hour: '2-digit',
      }).format(skipped),
    );

    await expect(
      resolveAppointment(db, appt(date, skippedHour + 1, 30, 'America/Chicago')),
    ).rejects.toBeInstanceOf(AppointmentTimeError);

    // The hours either side are ordinary.
    await expect(
      resolveAppointment(db, appt(date, skippedHour, 30, 'America/Chicago')),
    ).resolves.toMatchObject({ resolution: 'exact' });
    await expect(
      resolveAppointment(db, appt(date, skippedHour + 2, 30, 'America/Chicago')),
    ).resolves.toMatchObject({ resolution: 'exact' });
  });

  it('flags the hour that happens twice on the fall-back date', async () => {
    const { db } = connect();
    const moment = fallBack('America/Chicago', YEAR);
    const date = localDateOf('America/Chicago', moment);
    // The repeated wall hour: the one the clock lands back on.
    const repeated = Number(
      new Intl.DateTimeFormat('en-GB', {
        timeZone: 'America/Chicago', hourCycle: 'h23', hour: '2-digit',
      }).format(new Date(moment.getTime() + 60_000)),
    );

    const twice = await resolveAppointment(db, appt(date, repeated, 30, 'America/Chicago'));
    expect(twice.resolution).toBe('ambiguous');

    // Measured, not assumed: Postgres resolves it to the SECOND occurrence —
    // standard time, the later instant. The UI says which one it stored.
    const earlier = new Date(new Date(twice.startUtc).getTime() - 3_600_000);
    const wallOf = (d: Date) =>
      new Intl.DateTimeFormat('en-GB', {
        timeZone: 'America/Chicago', hourCycle: 'h23', hour: '2-digit', minute: '2-digit',
      }).format(d);
    expect(wallOf(earlier)).toBe(wallOf(new Date(twice.startUtc)));

    // An hour on either side is unambiguous.
    const before = await resolveAppointment(db, appt(date, repeated - 1, 30, 'America/Chicago'));
    expect(before.resolution).toBe('exact');
  });

  it('carries the 6-hour gap while the US and EU are out of step in spring', async () => {
    const { db } = connect();
    const us = springForward('America/Chicago', YEAR);
    const eu = springForward('Europe/Belgrade', YEAR);
    expect(us.getTime()).toBeLessThan(eu.getTime());

    const gapHours = async (at: Date) => {
      const date = localDateOf('America/Chicago', at);
      const r = await resolveAppointment(db, appt(date, 14, 30, 'America/Chicago'));
      const belgrade = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Europe/Belgrade', hourCycle: 'h23', hour: '2-digit', minute: '2-digit',
      }).format(new Date(r.startUtc));
      return (Number(belgrade.slice(0, 2)) - 14 + 24) % 24;
    };

    const DAY = 86_400_000;
    expect(await gapHours(new Date(us.getTime() - DAY))).toBe(7);
    // Between the two transitions the usual 7 hours becomes 6.
    expect(await gapHours(new Date(us.getTime() + DAY))).toBe(6);
    expect(await gapHours(new Date(eu.getTime() + DAY))).toBe(7);
  });

  it('carries the 6-hour gap during the one autumn week, the other way round', async () => {
    const { db } = connect();
    const eu = fallBack('Europe/Belgrade', YEAR);
    const us = fallBack('America/Chicago', YEAR);
    // Europe falls back first, so the gap shrinks again for about a week.
    expect(eu.getTime()).toBeLessThan(us.getTime());

    const date = localDateOf('America/Chicago', new Date(eu.getTime() + 86_400_000));
    const r = await resolveAppointment(db, appt(date, 14, 30, 'America/Chicago'));
    const belgrade = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/Belgrade', hourCycle: 'h23', hour: '2-digit',
    }).format(new Date(r.startUtc));
    expect((Number(belgrade) - 14 + 24) % 24).toBe(6);
  });
});

/* --------------------------- FCFS hours ---------------------------------- */

describe('FCFS receiving hours, on the wire', () => {
  const fcfs = (over: Record<string, unknown> = {}) =>
    AppointmentInput.safeParse({
      type: 'FCFS',
      date: { y: 2026, m: 9, d: 18 },
      time: { h: 7, min: 0 },
      tz: 'America/Chicago',
      windowMinutes: null,
      endTime: { h: 15, min: 0 },
      ...over,
    });

  it('accepts an earliest and a latest hour', () => {
    expect(fcfs().success).toBe(true);
  });

  it('refuses an FCFS stop with no latest hour — it is the deadline', () => {
    expect(fcfs({ endTime: null }).success).toBe(false);
  });

  it('refuses a ± window on an FCFS stop', () => {
    expect(fcfs({ windowMinutes: 30 }).success).toBe(false);
  });

  it('refuses receiving hours on an APPT stop', () => {
    const appointment = AppointmentInput.safeParse({
      type: 'APPT',
      date: { y: 2026, m: 9, d: 18 },
      time: { h: 14, min: 30 },
      tz: 'America/Chicago',
      windowMinutes: 30,
      endTime: { h: 15, min: 0 },
    });
    expect(appointment.success).toBe(false);
  });

  it('accepts an overnight window (§12.114)', () => {
    // 22:00-06:00 is real — grocery and retail DCs receive through the night.
    // The latest hour is on the next day; the form says so in words.
    expect(fcfs({ time: { h: 22, min: 0 }, endTime: { h: 6, min: 0 } }).success).toBe(true);
  });

  it('refuses a zero-length window, and says how to enter all day', () => {
    const same = fcfs({ endTime: { h: 7, min: 0 } });
    expect(same.success).toBe(false);
    expect(JSON.stringify(same.error?.issues)).toContain('00:00 to 23:59');
  });
});

withDb('FCFS receiving hours, converted', () => {
  const hours = (from: number, to: number, date = { y: 2026, m: 9, d: 18 }) =>
    AppointmentInput.parse({
      type: 'FCFS',
      date,
      time: { h: from, min: 0 },
      tz: 'America/Chicago',
      windowMinutes: null,
      endTime: { h: to, min: 0 },
    });

  it('stores both hours as the instants they name at the facility', async () => {
    const { db } = connect();
    const r = await resolveAppointment(db, hours(7, 15));
    expect(r.startUtc).toBe('2026-09-18T12:00:00.000Z');
    expect(r.endUtc).toBe('2026-09-18T20:00:00.000Z');
  });

  it('checks the LATEST hour for existence too, not just the earliest', async () => {
    // The latest hour is typed by a person as well, and 02:00-03:00 sits
    // inside plausible night receiving hours.
    const { db } = connect();
    const moment = springForward('America/Chicago', YEAR);
    const date = localDateOf('America/Chicago', moment);
    const skipped = Number(
      new Intl.DateTimeFormat('en-GB', {
        timeZone: 'America/Chicago', hourCycle: 'h23', hour: '2-digit',
      }).format(new Date(moment.getTime() - 60_000)),
    );

    await expect(
      resolveAppointment(db, hours(skipped, skipped + 1, date)),
    ).rejects.toMatchObject({
      name: 'AppointmentTimeError',
      // Hung on the field the dispatcher typed it into.
      field: 'appointment.endTime',
    });
  });
});

withDb('overnight receiving hours (§12.114), converted', () => {
  const night = (
    date: { y: number; m: number; d: number },
    tz: string,
    from: { h: number; min: number } = { h: 22, min: 0 },
    to: { h: number; min: number } = { h: 6, min: 0 },
  ) =>
    AppointmentInput.parse({
      type: 'FCFS',
      date,
      time: from,
      tz,
      windowMinutes: null,
      endTime: to,
    });

  const hoursOf = (r: { startUtc: string; endUtc: string | null }) =>
    (Date.parse(r.endUtc!) - Date.parse(r.startUtc)) / 3_600_000;

  /** What the stop's own clock reads at an instant, as `YYYY-MM-DD HH:mm`. */
  const wallAt = (iso: string, tz: string) =>
    new Intl.DateTimeFormat('sv-SE', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).format(new Date(iso));

  /** A night well clear of both changes: mid-June. */
  const ordinary = { y: YEAR, m: 6, d: 12 };

  it('closes at 06:00 on the NEXT day, 8 hours after it opens', async () => {
    const { db } = connect();
    const r = await resolveAppointment(db, night(ordinary, 'America/Chicago'));
    expect(wallAt(r.startUtc, 'America/Chicago')).toBe(`${YEAR}-06-12 22:00`);
    expect(wallAt(r.endUtc!, 'America/Chicago')).toBe(`${YEAR}-06-13 06:00`);
    expect(hoursOf(r)).toBe(8);
    expect(r.endResolution).toBe('exact');
  });

  it('is 7 hours on the spring-forward night and 9 on the fall-back one', async () => {
    const { db } = connect();
    const tz = 'America/Chicago';
    const spring = await resolveAppointment(db, night(eveningBefore(tz, springForward(tz, YEAR)), tz));
    const autumn = await resolveAppointment(db, night(eveningBefore(tz, fallBack(tz, YEAR)), tz));

    expect(hoursOf(spring)).toBe(7);
    expect(hoursOf(autumn)).toBe(9);
    // Both still CLOSE at 06:00 by the facility's own clock — the length
    // moved because the clock did, not because the end did.
    expect(wallAt(spring.endUtc!, tz).slice(11)).toBe('06:00');
    expect(wallAt(autumn.endUtc!, tz).slice(11)).toBe('06:00');
  });

  it('is 8 hours on those same nights in Phoenix, which does not change', async () => {
    const { db } = connect();
    const chicago = 'America/Chicago';
    for (const change of [springForward(chicago, YEAR), fallBack(chicago, YEAR)]) {
      const r = await resolveAppointment(db, night(eveningBefore(chicago, change), 'America/Phoenix'));
      expect(hoursOf(r)).toBe(8);
    }
  });

  it('follows the stop zone’s OWN change dates, not the US ones', async () => {
    // Belgrade changes on different weekends. On the US nights it is an
    // ordinary 8 hours; on its own nights it is 7 and 9. Nothing in the
    // builder knows a date, so nothing in it can be US-shaped.
    const { db } = connect();
    const us = 'America/Chicago';
    const eu = 'Europe/Belgrade';
    expect(localDateOf(eu, springForward(eu, YEAR))).not.toEqual(
      localDateOf(us, springForward(us, YEAR)),
    );

    const onUsNight = await resolveAppointment(db, night(eveningBefore(us, springForward(us, YEAR)), eu));
    expect(hoursOf(onUsNight)).toBe(8);

    const euSpring = await resolveAppointment(db, night(eveningBefore(eu, springForward(eu, YEAR)), eu));
    const euAutumn = await resolveAppointment(db, night(eveningBefore(eu, fallBack(eu, YEAR)), eu));
    expect(hoursOf(euSpring)).toBe(7);
    expect(hoursOf(euAutumn)).toBe(9);
  });

  it('refuses a latest hour the clocks skip, on the morning AFTER the start date', async () => {
    // 22:00 the evening before, closing at the skipped 02:30. The check has
    // to read back against the END's date — against the start's, 02:30 on
    // the evening before exists and the hour would be stored an hour late.
    const { db } = connect();
    const tz = 'America/Chicago';
    const moment = springForward(tz, YEAR);
    const skipped = Number(
      new Intl.DateTimeFormat('en-GB', { timeZone: tz, hourCycle: 'h23', hour: '2-digit' }).format(
        new Date(moment.getTime() - 60_000),
      ),
    ) + 1;
    await expect(
      resolveAppointment(db, night(eveningBefore(tz, moment), tz, { h: 22, min: 0 }, { h: skipped, min: 30 })),
    ).rejects.toMatchObject({ name: 'AppointmentTimeError', field: 'appointment.endTime' });
  });

  it('flags a latest hour that happens twice, and keeps the second one', async () => {
    const { db } = connect();
    const tz = 'America/Chicago';
    const moment = fallBack(tz, YEAR);
    const repeated = Number(
      new Intl.DateTimeFormat('en-GB', { timeZone: tz, hourCycle: 'h23', hour: '2-digit' }).format(
        new Date(moment.getTime() + 60_000),
      ),
    );
    const r = await resolveAppointment(
      db,
      night(eveningBefore(tz, moment), tz, { h: 22, min: 0 }, { h: repeated, min: 30 }),
    );
    expect(r.endResolution).toBe('ambiguous');
    // The start is an ordinary evening.
    expect(r.resolution).toBe('exact');
    // The SECOND: the instant an hour earlier reads the same wall time.
    const anHourEarlier = new Date(Date.parse(r.endUtc!) - 3_600_000).toISOString();
    expect(wallAt(anHourEarlier, tz)).toBe(wallAt(r.endUtc!, tz));
  });

  it('crosses the year', async () => {
    const { db } = connect();
    const r = await resolveAppointment(db, night({ y: YEAR, m: 12, d: 31 }, 'America/Chicago'));
    expect(wallAt(r.endUtc!, 'America/Chicago')).toBe(`${YEAR + 1}-01-01 06:00`);
  });

  it('leaves a same-day window exactly as it was', async () => {
    const { db } = connect();
    const r = await resolveAppointment(
      db,
      night(ordinary, 'America/Chicago', { h: 7, min: 0 }, { h: 15, min: 0 }),
    );
    expect(wallAt(r.startUtc, 'America/Chicago')).toBe(`${YEAR}-06-12 07:00`);
    expect(wallAt(r.endUtc!, 'America/Chicago')).toBe(`${YEAR}-06-12 15:00`);
    expect(hoursOf(r)).toBe(8);
  });

  it('agrees with the form’s display-only conversion on every one of those nights', async () => {
    // The "Ends next day · … · 9 h" line is computed in the browser by
    // wallTimeInstant. If it ever disagreed with Postgres, the form would
    // promise one deadline and store another.
    const { db } = connect();
    const tz = 'America/Chicago';
    for (const date of [
      ordinary,
      eveningBefore(tz, springForward(tz, YEAR)),
      eveningBefore(tz, fallBack(tz, YEAR)),
    ]) {
      const r = await resolveAppointment(db, night(date, tz));
      const end = fcfsEndDate(date, { h: 22, min: 0 }, { h: 6, min: 0 });
      expect(wallTimeInstant(date, { h: 22, min: 0 }, tz).toISOString()).toBe(r.startUtc);
      expect(wallTimeInstant(end, { h: 6, min: 0 }, tz).toISOString()).toBe(r.endUtc);
    }
  });
});

/*
 * The four `it.todo` markers that lived here — TOMORROW's midnight rollover
 * in the dispatch zone, and §12.22's three FCFS status rules — are now real
 * tests in `lib/status.test.ts`, next to the engine that owns them. This
 * suite keeps what it can assert on its own: the conversion.
 */

/* ------------------- the machine must not matter ------------------------- */

withDb('the saving machine cannot change the appointment', () => {
  const run = (TZ: string) =>
    JSON.parse(
      execFileSync(
        'node_modules/.bin/tsx',
        ['src/server/fixtures/convert-in-child.mts'],
        { env: { ...process.env, TZ }, encoding: 'utf8' },
      ),
    ) as { resolved: { startUtc: string }; trap: string; safe: string };

  it('converts identically under TZ=UTC and TZ=Asia/Kolkata', () => {
    const utc = run('UTC');
    const kolkata = run('Asia/Kolkata');
    expect(kolkata.resolved.startUtc).toBe(utc.resolved.startUtc);
    expect(utc.resolved.startUtc).toBe('2026-09-18T19:30:00.000Z');
    // Integer parts are immune on a bare client too.
    expect(kolkata.safe).toBe(utc.safe);

    /**
     * And the trap this design exists to avoid, kept visible on purpose.
     *
     * A wall-time STRING cast as `${wall}::timestamp` through postgres.js's
     * own tagged template is serialised via a JS Date, so it arrives shifted
     * by the process's offset: 14:00Z under Asia/Kolkata against 19:30Z under
     * UTC, for the same query and the same database.
     *
     * `drizzle(client)` replaces those serialisers, so the app's own writes
     * are not exposed — but every script in scripts/ opens a bare client, and
     * so did the first draft of the seed script. If this assertion ever
     * starts failing because the two agree, the driver changed and the
     * warning in lib/appointment.ts can be retired.
     */
    expect(kolkata.trap).not.toBe(utc.trap);
  }, 60_000);
});

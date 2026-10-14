import { describe, expect, it } from 'vitest';
import { stopFormFrom, type StopForm } from '@/components/edit/load-form';
import { appointmentDiff, appointmentScore, type ExpectedAppointment } from '../../scripts/ratecon-expected.mjs';

/**
 * How a filled appointment differs from the ground truth: WHICH part, never
 * its value (`ratecon:score` and `ratecon:eval-ai` print these). Invented
 * dates and times only.
 */

const OPENED = '2026-10-13T15:00:00.000Z';
const stop = (appointment: Partial<StopForm['appointment']>, check?: string): StopForm => {
  const s = stopFormFrom(null, OPENED);
  return {
    ...s,
    appointment: { ...s.appointment, ...appointment },
    fill: { sources: {}, checks: check ? { appointment: check } : {} },
  };
};

const APPT: ExpectedAppointment = { type: 'APPT', date: '2026-10-14', time: '08:00', windowMinutes: 120 };
const FCFS: ExpectedAppointment = { type: 'FCFS', date: '2026-10-14', time: '07:00', endTime: '15:00' };
const filledAppt = { enabled: true, type: 'APPT' as const, date: '2026-10-14', time: '08:00', windowMinutes: 120 };
const filledFcfs = { enabled: true, type: 'FCFS' as const, date: '2026-10-14', time: '07:00', endTime: '15:00' };

describe('appointmentDiff: which part differs, never what', () => {
  it.each([
    ['all the same', filledAppt, APPT, []],
    ['the date', { ...filledAppt, date: '2026-10-15' }, APPT, ['date']],
    ['the time', { ...filledAppt, time: '09:00' }, APPT, ['time']],
    ['the window (an appointment’s end)', { ...filledAppt, windowMinutes: 60 }, APPT, ['window']],
    ['the type', { ...filledAppt, type: 'FCFS' as const }, APPT, ['type']],
    ['the date and the time', { ...filledAppt, date: '2026-10-15', time: '09:00' }, APPT, ['date', 'time']],
    ['set where there is none', filledAppt, { none: true }, ['none-versus-set']],
    ['none where one is set', { ...filledAppt, enabled: false }, APPT, ['none-versus-set']],
    ['receiving hours, all the same', filledFcfs, FCFS, []],
    ['receiving hours’ end time', { ...filledFcfs, endTime: '16:00' }, FCFS, ['end time']],
    ['receiving hours filled as an appointment', { ...filledAppt, time: '07:00' }, { ...FCFS, endTime: '16:00' }, ['type', 'end time']],
    ["couldn't read, with the date right and no time", { ...filledAppt, time: '' }, { couldntRead: true, date: '2026-10-14' }, []],
    ["couldn't read, but a time filled", filledAppt, { couldntRead: true, date: '2026-10-14' }, ['time']],
    ["couldn't read, the date different", { ...filledAppt, time: '', date: '2026-10-15' }, { couldntRead: true, date: '2026-10-14' }, ['date']],
    ['no appointment, none filled', { enabled: false }, { none: true }, []],
  ] as const)('%s', (_, got, want, parts) => {
    expect(appointmentDiff(stop(got), want)).toEqual(parts);
  });

  it('names parts only: no date or time from either side appears in what it returns', () => {
    const parts = appointmentDiff(stop({ ...filledAppt, date: '2026-10-15', time: '09:00', windowMinutes: 60 }), APPT).join(' ');
    for (const value of ['2026', '10-1', '08:00', '09:00', '120', '60']) expect(parts).not.toContain(value);
  });
});

describe('appointmentScore agrees with appointmentDiff', () => {
  it.each([
    [filledAppt, APPT, undefined, 'exact'],
    [{ ...filledAppt, time: '09:00' }, APPT, undefined, 'WRONG'],
    [filledAppt, APPT, 'Check it.', 'marked, filled as the PDF says'],
    [{ ...filledAppt, date: '2026-10-15' }, APPT, 'Check it.', 'marked, filled differently'],
    [{ enabled: false }, { none: true }, undefined, 'exact'],
  ] as const)('%#', (got, want, check, score) => {
    expect(appointmentScore(stop(got, check), want)).toBe(score);
  });
});

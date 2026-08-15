// periodBounds — local-time window boundaries for the Dashboard's cash-flow
// tiles. Asserted as RELATIVE invariants, never against a hard-coded UTC-4
// offset, so CI cannot flake on the runner's own TZ.
import { describe, expect, test } from 'vitest';
import { periodBounds } from '@/lib/period';

const clock = (ms: number) => {
  const d = new Date(ms);
  return `${d.getHours()}:${d.getMinutes()}:${d.getSeconds()}.${d.getMilliseconds()}`;
};

describe('periodBounds', () => {
  test('from is local midnight and to is local 23:59:59.999, for dia/semana/mes', () => {
    const now = new Date(2026, 2, 15, 14, 30, 0); // Mar 15, 2026, 14:30 local

    for (const period of ['dia', 'semana', 'mes'] as const) {
      const { from, to } = periodBounds(period, now);
      expect(clock(from)).toBe('0:0:0.0');
      expect(clock(to)).toBe('23:59:59.999');
      expect(to).toBeGreaterThan(from);
    }

    // For a single day, the window is exactly one calendar day wide — the
    // relative invariant `to - from === 86_399_999`, never a UTC offset.
    const day = periodBounds('dia', now);
    expect(day.to - day.from).toBe(86_399_999);
  });

  // The clock assertions above pass even if the CALENDAR anchoring is deleted:
  // with `now` on the 31st, a window starting on the 31st still contains a sale
  // made at 23:50 that day. These pin the anchor itself, so removing
  // `from.setDate(1)` or the Monday rewind fails a test instead of shipping.
  test('the month window starts on day 1 and ends on the last day of that month', () => {
    const { from, to } = periodBounds('mes', new Date(2026, 2, 15, 14, 30, 0));

    expect(new Date(from).getDate()).toBe(1);
    expect(new Date(from).getMonth()).toBe(2); // March
    // March has 31 days; February 2026 has 28. Asserting the real last day
    // catches an off-by-one that a fixed 30 would hide.
    expect(new Date(to).getDate()).toBe(31);
    expect(new Date(to).getMonth()).toBe(2);

    const feb = periodBounds('mes', new Date(2026, 1, 10, 9, 0, 0));
    expect(new Date(feb.to).getDate()).toBe(28);
  });

  test('the week window runs Monday through Sunday, whatever day it is asked on', () => {
    // Thursday 12 March 2026. A week anchored on `now` instead of Monday would
    // start on the 12th and the suite would never notice.
    const { from, to } = periodBounds(
      'semana',
      new Date(2026, 2, 12, 16, 0, 0)
    );

    expect(new Date(from).getDay()).toBe(1); // Monday
    expect(new Date(to).getDay()).toBe(0); // Sunday
    expect(new Date(from).getDate()).toBe(9);
    expect(new Date(to).getDate()).toBe(15);

    // Asked ON a Sunday, the week is the one ENDING that day, not the next.
    const sunday = periodBounds('semana', new Date(2026, 2, 15, 20, 0, 0));
    expect(new Date(sunday.from).getDate()).toBe(9);
    expect(new Date(sunday.to).getDate()).toBe(15);
  });

  test('a soldAt at 23:50 local on the last day of the month belongs to that month, never the next', () => {
    const lastDayOfMonth = new Date(2026, 0, 31, 23, 50, 0); // Jan 31, 2026, 23:50 local
    const soldAt = lastDayOfMonth.getTime();

    const january = periodBounds('mes', lastDayOfMonth);
    expect(soldAt >= january.from && soldAt <= january.to).toBe(true);

    const february = periodBounds('mes', new Date(2026, 1, 1, 12, 0, 0));
    expect(soldAt >= february.from && soldAt <= february.to).toBe(false);
  });
});

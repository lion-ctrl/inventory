/**
 * Local-time window boundaries for the Dashboard's cash-flow period selector.
 * `from`/`to` go to `reports.cashFlow` as epoch ms — the server does no tz
 * math. Pure: `now` is always passed in, never read internally.
 */

export type Period = 'dia' | 'semana' | 'mes';

export function periodBounds(
  period: Period,
  now: Date
): { from: number; to: number } {
  const from = new Date(now);
  let to: Date;

  if (period === 'dia') {
    to = new Date(from);
  } else if (period === 'semana') {
    // ISO-style week: Monday through Sunday.
    const day = from.getDay(); // 0 (Sun) .. 6 (Sat)
    const daysSinceMonday = (day + 6) % 7;
    from.setDate(from.getDate() - daysSinceMonday);
    to = new Date(from);
    to.setDate(from.getDate() + 6);
  } else {
    from.setDate(1);
    // Day 0 of next month === the last day of the current one.
    to = new Date(from.getFullYear(), from.getMonth() + 1, 0);
  }

  from.setHours(0, 0, 0, 0);
  to.setHours(23, 59, 59, 999);

  return { from: from.getTime(), to: to.getTime() };
}

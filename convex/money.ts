/**
 * Money arithmetic — a PURE module, so the screen that DISPLAYS a total and the
 * mutation that CHARGES it round it with the same function.
 *
 * This used to be defined twice: here on the server, and again in `Sale.tsx`
 * with a comment claiming the frontend must not import from `convex/`. That rule
 * has since been written down properly (AGENTS.md rule 6: `src/` may import a
 * pure module from `convex/`, one way), and two copies of a rounding rule in the
 * money path is exactly the drift it exists to prevent — a displayed total that
 * differs from the charged one by a cent is a customer argument, not a rounding
 * detail.
 */

/** Round to 2 decimal places (money in USD). */
export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

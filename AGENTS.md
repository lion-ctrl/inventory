# Code Review Rules — Smart Inventory POS

Rules for reviewing staged changes in this repository. The app lives at the repo root
(React 19 + Vite + TypeScript + Convex PWA), ported 1:1 from the HTML prototype in `designs/`.

## Language

1. ALL user-facing UI text must be in Spanish (labels, errors, dialogs, receipts).
2. ALL code must be in English: identifiers, function names, database fields, comments.
3. Existing Spanish copy ported from the prototype must not be reworded.

## Design fidelity

4. `src/styles/tokens.css` and `app.css` are a verbatim port — do not edit,
   extend, or override them; never rename CSS class names used by screens.
5. No new styling systems (no Tailwind, no CSS-in-JS, no inline style additions beyond
   what the prototype had).

## Architecture

6. Imports: use `@/` for src and `@convex/` for convex/_generated; cross-directory
   relative imports (`../`) are not allowed. Same-folder `./Sibling` imports are fine.
7. No new RUNTIME dependencies (the `dependencies` block in package.json),
   UNLESS the owner explicitly requested a feature that requires one and the
   commit message documents that request (e.g. @zxing for owner-requested
   camera scanning). Dev tooling (devDependencies: test runners, linters,
   type packages) is acceptable when justified by the change. Especially:
   never an auth package — login is a plain `employees` table check
   (email + 6-digit PIN).
8. Screens own their data: `useQuery`/`useMutation` inside the screen (or the cached
   hooks in `src/state/hooks.ts`); no prop-drilling of server data through AppShell.

## Convex backend (convex/)

9. Every function uses the object syntax with both `args` AND `returns` validators.
10. Every mutation that needs permissions re-checks them server-side via
    `requirePerm(ctx, actorId, perm)` — UI gating alone is not acceptable.
11. User-facing errors are `ConvexError` with a Spanish message.
12. Money is stored in USD numbers; sales snapshot `ivaPct`, `exchangeRate`, prices,
    client and cashier at checkout time. Never trust client-sent prices or totals.
13. PINs are validated server-side as exactly 6 digits.

## Async & quality

14. Fire-and-forget promises in void positions must be explicitly voided
    (`void navigate(...)`, `onClick={() => void handler()}`); handlers that call
    mutations catch errors and surface `e.data` via the screen's error affordance.
15. No `tsc` or ESLint suppressions without a written reason on the line above.

## Commits

16. Conventional commit messages (`feat:`, `fix:`, `chore:`…), no AI attribution lines.

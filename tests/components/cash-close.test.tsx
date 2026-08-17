// @vitest-environment jsdom
// Cash-close screen: blind count sheet (USD + Bs, difference revealed only
// after submission — spec Requirement 1), offline/unsynced refusal (spec
// Requirement 2), and the same-cashier / view_reports history boundary (spec
// Requirement 3) — plus three additions to closes.create that landed AFTER
// tasks.md was written: `confirmPartial` (over-cap partial close, never sent
// silently), `countedFrom` (the partial-close disclosure on the reveal), and
// `openedAt` (required only for a cashier's very first close — revealed
// error-driven, exactly like confirmPartial, never predicted client-side) —
// plus a STRUCTURAL rule from a second sdd-verify round: `usePendingSales()`
// status sorts into exactly one of `blocking` (`pending`/`failed` — the two
// the engine genuinely retries), `syncingLeftover` or `conflict` (the engine
// never revisits either — disclosed with HONEST, DISTINCT wording, never
// blocking), or `settled` (`synced`/`cancelled` — neither blocks nor needs
// disclosure). Blocking always comes with an explicit "Cerrar de todas
// formas" escape, so no queue state, present or future, can permanently
// brick the close.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { useMutation, useQuery } from 'convex/react';

const H = vi.hoisted(() => {
  const online: { current: boolean } = { current: true };
  const can: { current: (perm: string) => boolean } = {
    current: () => false,
  };
  const pending: { current: unknown[] } = { current: [] };
  const listResult: { current: unknown } = {
    current: { closes: [], truncated: false },
  };
  const listArgs: { current: unknown } = { current: undefined };
  return { online, can, pending, listResult, listArgs, create: vi.fn() };
});

vi.mock('react-router', () => ({ useNavigate: () => vi.fn() }));
// Bare vi.fn() sidesteps vi.mock hoisting; dispatch is wired in beforeEach
// (tests/components/dashboard-cash-flow.test.tsx precedent).
vi.mock('convex/react', () => ({ useQuery: vi.fn(), useMutation: vi.fn() }));
vi.mock('@/state/SessionContext', () => ({
  useSession: () => ({
    user: { name: 'Carlos' },
    token: 'tok',
    can: (perm: string) => H.can.current(perm),
  }),
}));
vi.mock('@/state/useOnline', () => ({ useOnline: () => H.online.current }));
vi.mock('@/state/usePendingSales', () => ({
  usePendingSales: () => H.pending.current,
}));

import CashCloseScreen from '@/screens/CashClose';

// The EXACT Spanish message `closes.create` throws when this cashier's own
// window holds more than 1000 unclosed sales or refunds (convex/closes.ts).
// There is no error code — only this literal string.
const OVER_CAP_MESSAGE =
  'Tienes más de 1000 ventas sin cerrar. Confirma un cierre parcial para cerrar solo las más recientes.';

// The EXACT Spanish message `closes.create` throws when this cashier has no
// previous close and did not supply `openedAt` (convex/closes.ts).
const FIRST_CLOSE_MESSAGE = 'Indica desde cuándo cuenta este primer cierre.';

// The EXACT Spanish message `closes.create` throws when a supplied opening
// date is invalid (e.g. in the future) — a DIFFERENT rejection than
// FIRST_CLOSE_MESSAGE, used to prove the opening-date field survives an
// unrelated rejection instead of vanishing (convex/closes.ts).
const INVALID_DATE_MESSAGE = 'La fecha de apertura no es válida.';

// The EXACT Spanish message `closes.create` throws when `openedAt` is sent
// but a previous close already exists (convex/closes.ts) — proves a previous
// close now exists, so it is the W10 signal to reset needsOpenedAt.
const WINDOW_CONTINUATION_MESSAGE =
  'El cierre continúa desde tu cierre anterior; no puedes elegir la fecha de inicio.';

// Mirrors CashClose.tsx's own TODAY_LOCAL_ISO derivation exactly, so S1's
// "defaults to today" assertion is not coupled to whatever day the suite
// happens to run on.
function todayLocalIso(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

const closeFixture = (overrides: Record<string, unknown> = {}) => ({
  _id: 'close1',
  _creationTime: 0,
  cashierName: 'Carlos',
  openedAt: 0,
  closedAt: 1000,
  expectedUsd: 100,
  expectedBs: 5000,
  countedUsd: 100,
  countedBs: 5000,
  differenceUsd: 0,
  differenceBs: 0,
  ...overrides,
});

const usdField = () => screen.getByLabelText(/Contado \(\$\)/);
const bsField = () => screen.getByLabelText(/Contado \(Bs\)/);
const closeButton = () => screen.getByRole('button', { name: 'Cerrar caja' });

async function fillValidCounts(user: ReturnType<typeof userEvent.setup>) {
  await user.type(usdField(), '95');
  await user.type(bsField(), '5000');
}

beforeEach(() => {
  H.online.current = true;
  H.can.current = () => false;
  H.pending.current = [];
  H.listResult.current = { closes: [], truncated: false };
  H.listArgs.current = undefined;
  H.create.mockReset();
  vi.mocked(useQuery).mockImplementation((_query: unknown, args?: unknown) => {
    H.listArgs.current = args;
    if (args === 'skip') return undefined;
    return H.listResult.current;
  });
  vi.mocked(useMutation).mockImplementation(() => H.create as never);
});
afterEach(() => cleanup());

describe('CashClose — blind count (spec Requirement 1 / task 5.1)', () => {
  test('initial render: two blank count inputs, no Efectivo esperado / Diferencia anywhere', () => {
    render(<CashCloseScreen />);

    expect(usdField()).toHaveProperty('value', '');
    expect(bsField()).toHaveProperty('value', '');
    expect(screen.queryByText(/Efectivo esperado/)).toBeNull();
    expect(screen.queryByText(/Diferencia/)).toBeNull();
  });

  test('after a resolved create, Diferencia for USD and Bs render as two separate figures', async () => {
    const user = userEvent.setup();
    H.create.mockResolvedValueOnce(
      closeFixture({ countedUsd: 95, differenceUsd: -5, differenceBs: 0 })
    );
    render(<CashCloseScreen />);
    await fillValidCounts(user);
    await user.click(closeButton());

    // Two SEPARATE figures — never blended into one combined string.
    expect(await screen.findByText('-$5.00')).toBeDefined();
    expect(screen.getByText('Bs 0.00')).toBeDefined();
    expect(screen.getAllByText(/Diferencia/)).toHaveLength(2);
  });
});

describe('CashClose — offline / unsynced refusal (spec Requirement 2 / task 5.2)', () => {
  test('offline: the close action is disabled and the screen states a connection is required', async () => {
    const user = userEvent.setup();
    H.online.current = false;
    render(<CashCloseScreen />);
    await fillValidCounts(user);

    expect(closeButton()).toHaveProperty('disabled', true);
    expect(screen.getByText('Cerrar la caja requiere conexión.')).toBeDefined();
  });

  test('online but a pending unsynced sale exists: the close action stays disabled', async () => {
    const user = userEvent.setup();
    H.online.current = true;
    H.pending.current = [{ localId: 1, status: 'pending' }];
    render(<CashCloseScreen />);
    await fillValidCounts(user);

    expect(closeButton()).toHaveProperty('disabled', true);
    expect(
      screen.getByText(
        'Tienes 1 venta pendiente de sincronizar. El monto esperado podría no incluirla si cierras ahora.'
      )
    ).toBeDefined();
  });

  test('online, no pending sales, valid counts: the close action is enabled', async () => {
    const user = userEvent.setup();
    render(<CashCloseScreen />);
    await fillValidCounts(user);

    expect(closeButton()).toHaveProperty('disabled', false);
  });

  test('offline with no cached close list: history shows connection-required, not an empty state', () => {
    H.online.current = false;
    H.listResult.current = undefined;
    render(<CashCloseScreen />);

    expect(
      screen.getByText('El historial de cierres requiere conexión.')
    ).toBeDefined();
    expect(screen.queryByText('Sin cierres registrados')).toBeNull();
  });
});

describe('CashClose — history respects same-cashier / view_reports (spec Requirement 3 / task 5.3)', () => {
  test('without view_reports: the cashier picker is absent from the DOM, own history still lists', () => {
    H.can.current = () => false;
    H.listResult.current = { closes: [closeFixture()], truncated: false };
    render(<CashCloseScreen />);

    expect(
      screen.queryByLabelText('Cajero', { selector: 'select' })
    ).toBeNull();
    expect(screen.getByText('Carlos')).toBeDefined();
    expect(H.listArgs.current).toMatchObject({ scope: 'own' });
  });

  test('with view_reports: a control to view another cashier is present', () => {
    H.can.current = () => true;
    H.listResult.current = { closes: [closeFixture()], truncated: false };
    render(<CashCloseScreen />);

    expect(
      screen.getByLabelText('Cajero', { selector: 'select' })
    ).toBeDefined();
    expect(H.listArgs.current).toMatchObject({ scope: 'all' });
  });
});

// Added beyond tasks.md's Phase 5 (task instructions §"CRITICAL": tasks.md
// predates `countedFrom` on closes.create's return). Present ONLY on a
// partial close — it means the expected figures cover only
// (countedFrom, closedAt], so the difference can show a surplus that is NOT
// real. The screen MUST say so plainly next to the difference.
describe('CashClose — countedFrom discloses a partial close', () => {
  test('a close with countedFrom shows the partial-close disclosure beside the difference', async () => {
    const user = userEvent.setup();
    H.create.mockResolvedValueOnce(closeFixture({ countedFrom: 500 }));
    render(<CashCloseScreen />);
    await fillValidCounts(user);
    await user.click(closeButton());

    expect(await screen.findByText(/cierre es parcial/i)).toBeDefined();
  });

  test('an ordinary close (no countedFrom) shows no partial-close disclosure', async () => {
    const user = userEvent.setup();
    H.create.mockResolvedValueOnce(closeFixture());
    render(<CashCloseScreen />);
    await fillValidCounts(user);
    await user.click(closeButton());

    // Wait for the reveal to actually render before asserting an absence —
    // otherwise this would pass trivially before the mutation resolves.
    await screen.findByText('Bs 0.00');
    expect(screen.queryByText(/cierre es parcial/i)).toBeNull();
  });
});

// Added beyond tasks.md's Phase 5 (task instructions §"CRITICAL": tasks.md
// predates `confirmPartial` on closes.create's args). The ONLY way past the
// over-cap refusal is to resend with confirmPartial:true — the screen must
// offer that as a deliberate, explicit act, never send it silently/by default.
describe('CashClose — confirmPartial is offered, never sent silently', () => {
  test('the over-cap error offers an explicit confirm; only that click resends confirmPartial:true', async () => {
    const user = userEvent.setup();
    H.create
      .mockRejectedValueOnce({ data: OVER_CAP_MESSAGE })
      .mockResolvedValueOnce(closeFixture({ countedFrom: 750 }));
    render(<CashCloseScreen />);
    await fillValidCounts(user);
    await user.click(closeButton());

    expect(await screen.findByText(OVER_CAP_MESSAGE)).toBeDefined();
    // The FIRST call must never have sent confirmPartial itself.
    expect(H.create.mock.calls[0][0]).not.toHaveProperty('confirmPartial');

    await user.click(
      screen.getByRole('button', { name: 'Confirmar cierre parcial' })
    );

    expect(await screen.findByText('Bs 0.00')).toBeDefined();
    expect(H.create.mock.calls[1][0]).toMatchObject({ confirmPartial: true });
    expect(
      screen.queryByRole('button', { name: 'Confirmar cierre parcial' })
    ).toBeNull();
  });

  test('a different rejection never offers the partial-close confirmation', async () => {
    const user = userEvent.setup();
    H.create.mockRejectedValueOnce({
      data: 'Los montos contados no son válidos.',
    });
    render(<CashCloseScreen />);
    await fillValidCounts(user);
    await user.click(closeButton());

    expect(
      await screen.findByText('Los montos contados no son válidos.')
    ).toBeDefined();
    expect(
      screen.queryByRole('button', { name: 'Confirmar cierre parcial' })
    ).toBeNull();
  });
});

// Added per coordinator course-correction: closes.create requires an
// explicit `openedAt` for a cashier's very first-ever close. There is no
// reliable client-side signal for "does this cashier already have a
// previous close" (scope:'all' mixes every cashier's rows and AUTH-2 strips
// cashierId), so the opening-date field is revealed ERROR-DRIVEN, exactly
// like confirmPartial — never predicted, never sent until the server has
// already said so via the exact FIRST_CLOSE_MESSAGE.
describe('CashClose — openedAt is revealed only by the exact first-close rejection', () => {
  const dateField = () =>
    screen.getByLabelText(/Desde qué día cuenta este primer cierre/);

  test('the field is absent before any rejection, and appears only after the exact FIRST_CLOSE_MESSAGE', async () => {
    const user = userEvent.setup();
    H.create.mockRejectedValueOnce({ data: FIRST_CLOSE_MESSAGE });
    render(<CashCloseScreen />);

    expect(
      screen.queryByLabelText(/Desde qué día cuenta este primer cierre/)
    ).toBeNull();

    await fillValidCounts(user);
    await user.click(closeButton());

    expect(await screen.findByText(FIRST_CLOSE_MESSAGE)).toBeDefined();
    // S1: the field must default to TODAY, not merely exist — an empty or
    // wrong default would still satisfy "the field appears" alone.
    expect(dateField()).toHaveProperty('value', todayLocalIso());
  });

  test('the field survives a DIFFERENT rejection (e.g. an invalid date) instead of vanishing', async () => {
    const user = userEvent.setup();
    H.create
      .mockRejectedValueOnce({ data: FIRST_CLOSE_MESSAGE })
      .mockRejectedValueOnce({ data: INVALID_DATE_MESSAGE });
    render(<CashCloseScreen />);
    await fillValidCounts(user);
    await user.click(closeButton());
    await screen.findByText(FIRST_CLOSE_MESSAGE);

    // A future date the cashier picked gets rejected as invalid — a
    // DIFFERENT message than FIRST_CLOSE_MESSAGE.
    fireEvent.change(dateField(), { target: { value: '2099-01-01' } });
    await user.click(closeButton());

    expect(await screen.findByText(INVALID_DATE_MESSAGE)).toBeDefined();
    // S2: the field must still hold the cashier's OWN typed value, not just
    // exist — silently reverting to today would still satisfy "the field is
    // present" while quietly discarding what the cashier already entered.
    expect(dateField()).toHaveProperty('value', '2099-01-01');
  });

  test('the resubmit sends openedAt at local midnight of the chosen day; the ordinary submit sent none', async () => {
    const user = userEvent.setup();
    H.create
      .mockRejectedValueOnce({ data: FIRST_CLOSE_MESSAGE })
      .mockResolvedValueOnce(closeFixture());
    render(<CashCloseScreen />);
    await fillValidCounts(user);
    await user.click(closeButton());

    await screen.findByText(FIRST_CLOSE_MESSAGE);
    // The ORDINARY (first) submit never sent openedAt at all.
    expect(H.create.mock.calls[0][0]).not.toHaveProperty('openedAt');

    fireEvent.change(dateField(), { target: { value: '2026-01-15' } });
    await user.click(closeButton());

    expect(await screen.findByText('Bs 0.00')).toBeDefined();
    // Local midnight, NOT UTC midnight — the same idiom History.tsx uses for
    // its own date-range fields (`new Date(iso + 'T00:00:00').getTime()`).
    const expectedMs = new Date('2026-01-15T00:00:00').getTime();
    expect(H.create.mock.calls[1][0]).toMatchObject({ openedAt: expectedMs });
  });

  test('a different rejection never reveals the opening-date field', async () => {
    const user = userEvent.setup();
    H.create.mockRejectedValueOnce({
      data: 'Los montos contados no son válidos.',
    });
    render(<CashCloseScreen />);
    await fillValidCounts(user);
    await user.click(closeButton());

    expect(
      await screen.findByText('Los montos contados no son válidos.')
    ).toBeDefined();
    expect(
      screen.queryByLabelText(/Desde qué día cuenta este primer cierre/)
    ).toBeNull();
  });

  test('a successful first close resets the flag: a later close in this session does not resend openedAt', async () => {
    const user = userEvent.setup();
    H.create
      .mockRejectedValueOnce({ data: FIRST_CLOSE_MESSAGE })
      .mockResolvedValueOnce(closeFixture())
      // Distinct figure so `findByText` can prove THIS third resolution
      // landed, not just the second one's already-rendered reveal.
      .mockResolvedValueOnce(closeFixture({ differenceUsd: -1 }));
    render(<CashCloseScreen />);
    await fillValidCounts(user);
    await user.click(closeButton());
    await screen.findByText(FIRST_CLOSE_MESSAGE);

    fireEvent.change(dateField(), { target: { value: '2026-01-15' } });
    await user.click(closeButton());
    await screen.findByText('Bs 0.00');

    // A second close, same mount: this cashier now HAS a previous close, so
    // resending openedAt would be REFUSED server-side.
    await user.clear(usdField());
    await user.clear(bsField());
    await fillValidCounts(user);
    await user.click(closeButton());

    expect(await screen.findByText('-$1.00')).toBeDefined();
    expect(H.create.mock.calls[2][0]).not.toHaveProperty('openedAt');
  });
});

// W10 (sdd-verify): needsOpenedAt is deliberately never reset by an
// UNRELATED rejection (W1) so the invalid-date path stays recoverable — but
// the window-continuation message is not unrelated: it PROVES a previous
// close now exists (gained elsewhere between the first rejection and this
// resubmit), so it must reset the flag, or every later resubmit would keep
// sending openedAt and keep being refused by this exact message forever.
describe('CashClose — the window-continuation rejection resets needsOpenedAt (W10)', () => {
  const dateField = () =>
    screen.getByLabelText(/Desde qué día cuenta este primer cierre/);

  test('a previous close gained elsewhere resets the flag: the date field disappears, and the next resubmit sends no openedAt', async () => {
    const user = userEvent.setup();
    H.create
      .mockRejectedValueOnce({ data: FIRST_CLOSE_MESSAGE })
      .mockRejectedValueOnce({ data: WINDOW_CONTINUATION_MESSAGE })
      .mockResolvedValueOnce(closeFixture());
    render(<CashCloseScreen />);
    await fillValidCounts(user);
    await user.click(closeButton());
    await screen.findByText(FIRST_CLOSE_MESSAGE);
    expect(dateField()).toBeDefined();

    fireEvent.change(dateField(), { target: { value: '2026-01-15' } });
    await user.click(closeButton());

    expect(await screen.findByText(WINDOW_CONTINUATION_MESSAGE)).toBeDefined();
    expect(
      screen.queryByLabelText(/Desde qué día cuenta este primer cierre/)
    ).toBeNull();

    await user.click(closeButton());

    expect(await screen.findByText('Bs 0.00')).toBeDefined();
    expect(H.create.mock.calls[2][0]).not.toHaveProperty('openedAt');
  });
});

// C1 (CRITICAL, sdd-verify round 2): a `conflict`-status pending sale
// (verified against src/state/sync.ts) never resolves on its own — isDue()
// refuses it forever and nothing in src/ deletes or resolves it. Blocking
// the close on it would brick the drawer permanently, so it is DISCLOSED
// instead — the close stays enabled, and a banner states how many sales were
// rejected. W9: the message never names a figure the screen does not render.
describe('CashClose — conflicted sales are disclosed, never block the close', () => {
  test('a single conflicted sale does not block the close; the banner uses singular wording', async () => {
    const user = userEvent.setup();
    H.pending.current = [{ localId: 1, status: 'conflict' }];
    render(<CashCloseScreen />);
    await fillValidCounts(user);

    expect(closeButton()).toHaveProperty('disabled', false);
    expect(
      screen.getByText(
        'Hay 1 venta que el servidor rechazó al sincronizar. Su efectivo no está incluido en lo esperado; es normal que la diferencia muestre un sobrante.'
      )
    ).toBeDefined();
  });

  test('two conflicted sales: the banner uses plural wording', () => {
    H.pending.current = [
      { localId: 1, status: 'conflict' },
      { localId: 2, status: 'conflict' },
    ];
    render(<CashCloseScreen />);

    expect(
      screen.getByText(
        'Hay 2 ventas que el servidor rechazó al sincronizar. Su efectivo no está incluido en lo esperado; es normal que la diferencia muestre un sobrante.'
      )
    ).toBeDefined();
  });

  test('no conflicted sales: no disclosure banner renders', () => {
    render(<CashCloseScreen />);

    expect(screen.queryByText(/rechazó al sincronizar/)).toBeNull();
  });
});

// A `syncing` leftover (verified against src/state/sync.ts: written BEFORE
// the network await at :228-231/:295-298, and isDue() (:198-205) refuses it
// forever just like `conflict`) is a DIFFERENT fact from a conflict — this
// device does not know whether the server received it — so it gets its own
// honest wording, never merged into the conflict message.
describe('CashClose — a syncing leftover is disclosed, honestly distinct from a conflict, never blocks', () => {
  test('a single syncing leftover does not block the close; the banner states the outcome is unknown', async () => {
    const user = userEvent.setup();
    H.pending.current = [{ localId: 1, status: 'syncing' }];
    render(<CashCloseScreen />);
    await fillValidCounts(user);

    expect(closeButton()).toHaveProperty('disabled', false);
    expect(
      screen.getByText(
        'Hay 1 venta cuya sincronización quedó interrumpida en este dispositivo. No se sabe si el servidor llegó a recibir esa venta, así que su efectivo podría no estar incluido en lo esperado.'
      )
    ).toBeDefined();
  });

  test('two syncing leftovers: the banner uses plural wording', () => {
    H.pending.current = [
      { localId: 1, status: 'syncing' },
      { localId: 2, status: 'syncing' },
    ];
    render(<CashCloseScreen />);

    expect(
      screen.getByText(
        'Hay 2 ventas cuya sincronización quedó interrumpida en este dispositivo. No se sabe si el servidor llegó a recibir esas ventas, así que su efectivo podría no estar incluido en lo esperado.'
      )
    ).toBeDefined();
  });

  test('no syncing leftovers: no disclosure banner renders', () => {
    render(<CashCloseScreen />);

    expect(screen.queryByText(/sincronización quedó interrumpida/)).toBeNull();
  });

  test('a syncing leftover and a conflict render as two SEPARATE banners, never merged into one message', () => {
    H.pending.current = [
      { localId: 1, status: 'syncing' },
      { localId: 2, status: 'conflict' },
    ];
    render(<CashCloseScreen />);

    expect(
      screen.getByText(
        'Hay 1 venta cuya sincronización quedó interrumpida en este dispositivo. No se sabe si el servidor llegó a recibir esa venta, así que su efectivo podría no estar incluido en lo esperado.'
      )
    ).toBeDefined();
    expect(
      screen.getByText(
        'Hay 1 venta que el servidor rechazó al sincronizar. Su efectivo no está incluido en lo esperado; es normal que la diferencia muestre un sobrante.'
      )
    ).toBeDefined();
  });
});

// The structural rule: the close must never be permanently blockable by
// anything. `pending`/`failed` still block by default (they self-clear in
// the normal case), but a deliberate, disclosed, never-silent escape always
// exists — exactly like `confirmPartial` already lets a cashier override the
// over-cap refusal.
describe('CashClose — the close is never permanently blockable: an explicit escape always exists', () => {
  const escapeButton = () =>
    screen.getByRole('button', { name: 'Cerrar de todas formas' });

  test('a blocking (pending) sale disables the close, discloses the count, and offers the escape', async () => {
    const user = userEvent.setup();
    H.pending.current = [{ localId: 1, status: 'pending' }];
    render(<CashCloseScreen />);
    await fillValidCounts(user);

    expect(closeButton()).toHaveProperty('disabled', true);
    expect(
      screen.getByText(
        'Tienes 1 venta pendiente de sincronizar. El monto esperado podría no incluirla si cierras ahora.'
      )
    ).toBeDefined();
    expect(escapeButton()).toHaveProperty('disabled', false);
  });

  test('clicking the escape closes anyway, while the ordinary button stays disabled', async () => {
    const user = userEvent.setup();
    H.pending.current = [{ localId: 1, status: 'pending' }];
    H.create.mockResolvedValueOnce(closeFixture());
    render(<CashCloseScreen />);
    await fillValidCounts(user);

    // The ORDINARY button never becomes clickable — the escape is a
    // SEPARATE, deliberate control, never a default.
    expect(closeButton()).toHaveProperty('disabled', true);

    await user.click(escapeButton());

    expect(await screen.findByText('Bs 0.00')).toBeDefined();
    expect(H.create.mock.calls[0][0]).toMatchObject({
      countedUsd: 95,
      countedBs: 5000,
    });
  });

  // W1 (sdd-verify round 3): the flag's REAL job is keeping the ordinary and
  // partial-confirm buttons unlocked when the escape's OWN submit gets
  // REJECTED — not just after a success (which the existing "acknowledging
  // once resets" test already covers, and which resets the flag anyway,
  // making mutant and real code indistinguishable there). Under the
  // over-cap rejection, the SAME blocking sale is still present; without the
  // acknowledgement surviving the failure, it would re-lock the cashier out
  // — recurrence of the exact class this whole rework exists to close.
  test('the escape acknowledgement survives a REJECTED submit: neither button re-locks from the still-present blocking sale', async () => {
    const user = userEvent.setup();
    H.pending.current = [{ localId: 1, status: 'pending' }];
    H.create.mockRejectedValueOnce({ data: OVER_CAP_MESSAGE });
    render(<CashCloseScreen />);
    await fillValidCounts(user);

    expect(closeButton()).toHaveProperty('disabled', true);

    await user.click(escapeButton());

    expect(await screen.findByText(OVER_CAP_MESSAGE)).toBeDefined();
    // The queue is STILL blocking (same fixture, never changed) — but the
    // cashier already acknowledged it via the escape click, so neither
    // button may be re-locked by blockingCount alone.
    expect(closeButton()).toHaveProperty('disabled', false);
    expect(
      screen.getByRole('button', { name: 'Confirmar cierre parcial' })
    ).toHaveProperty('disabled', false);
  });

  test('the escape respects every OTHER reason to block: offline disables it too', async () => {
    const user = userEvent.setup();
    H.online.current = false;
    H.pending.current = [{ localId: 1, status: 'pending' }];
    render(<CashCloseScreen />);
    await fillValidCounts(user);

    expect(escapeButton()).toHaveProperty('disabled', true);
  });

  test('no blocking sales: no escape button renders', () => {
    render(<CashCloseScreen />);

    expect(
      screen.queryByRole('button', { name: 'Cerrar de todas formas' })
    ).toBeNull();
  });

  test('a syncing leftover or a conflict alone never triggers the escape — nothing there blocks', () => {
    H.pending.current = [
      { localId: 1, status: 'syncing' },
      { localId: 2, status: 'conflict' },
    ];
    render(<CashCloseScreen />);

    expect(
      screen.queryByRole('button', { name: 'Cerrar de todas formas' })
    ).toBeNull();
  });

  test('a blocking pending sale AND a conflicted sale are disclosed as two separate, distinct facts', async () => {
    const user = userEvent.setup();
    // DIFFERENT counts per status (2 pending, 1 conflict) so neither
    // disclosed count could be explained by conflating the two.
    H.pending.current = [
      { localId: 1, status: 'pending' },
      { localId: 2, status: 'pending' },
      { localId: 3, status: 'conflict' },
    ];
    render(<CashCloseScreen />);
    await fillValidCounts(user);

    expect(closeButton()).toHaveProperty('disabled', true);
    expect(
      screen.getByText(
        'Tienes 2 ventas pendientes de sincronizar. El monto esperado podría no incluirlas si cierras ahora.'
      )
    ).toBeDefined();
    expect(
      screen.getByText(
        'Hay 1 venta que el servidor rechazó al sincronizar. Su efectivo no está incluido en lo esperado; es normal que la diferencia muestre un sobrante.'
      )
    ).toBeDefined();
  });

  test('acknowledging once resets after a successful close: a later close needs its own escape click', async () => {
    const user = userEvent.setup();
    H.pending.current = [{ localId: 1, status: 'pending' }];
    H.create
      .mockResolvedValueOnce(closeFixture())
      // Distinct figure so `findByText` can prove THIS second resolution
      // landed, not just the first one's already-rendered reveal.
      .mockResolvedValueOnce(closeFixture({ differenceUsd: -1 }));
    render(<CashCloseScreen />);
    await fillValidCounts(user);
    await user.click(escapeButton());
    await screen.findByText('Bs 0.00');

    // A second close, same mount, the SAME still-pending sale: the ordinary
    // button must be disabled again — the earlier acknowledgement must not
    // silently carry forward to a close it was never actually about.
    await user.clear(usdField());
    await user.clear(bsField());
    await fillValidCounts(user);

    expect(closeButton()).toHaveProperty('disabled', true);

    await user.click(escapeButton());

    expect(await screen.findByText('-$1.00')).toBeDefined();
  });
});

// W6: a set exhaustive over PendingOpStatus (src/state/db.ts:35-41) needs
// every member pinned, not just the two ('pending', 'conflict') the rest of
// this file happened to construct fixtures for — otherwise `new
// Set(['pending'])` or a mapping that silently drops 'synced'/'cancelled'
// both leave every OTHER test in this file green.
describe('CashClose — every PendingOpStatus is categorized exhaustively (W6)', () => {
  const escapeButtonQuery = () =>
    screen.queryByRole('button', { name: 'Cerrar de todas formas' });
  const conflictBannerQuery = () =>
    screen.queryByText(/rechazó al sincronizar/);
  const syncingLeftoverBannerQuery = () =>
    screen.queryByText(/sincronización quedó interrumpida/);

  const cases = [
    {
      status: 'pending',
      blocks: true,
      conflict: false,
      syncingLeftover: false,
    },
    { status: 'failed', blocks: true, conflict: false, syncingLeftover: false },
    {
      status: 'syncing',
      blocks: false,
      conflict: false,
      syncingLeftover: true,
    },
    {
      status: 'conflict',
      blocks: false,
      conflict: true,
      syncingLeftover: false,
    },
    {
      status: 'synced',
      blocks: false,
      conflict: false,
      syncingLeftover: false,
    },
    {
      status: 'cancelled',
      blocks: false,
      conflict: false,
      syncingLeftover: false,
    },
  ] as const;

  test.each(cases)(
    'status "$status": blocks=$blocks, conflictBanner=$conflict, syncingLeftoverBanner=$syncingLeftover',
    async ({ status, blocks, conflict, syncingLeftover }) => {
      const user = userEvent.setup();
      H.pending.current = [{ localId: 1, status }];
      render(<CashCloseScreen />);
      await fillValidCounts(user);

      expect(closeButton()).toHaveProperty('disabled', blocks);
      // W2: queryBy* returns Element | null, never undefined — `.toBeDefined()`
      // on a `null` result PASSES (null !== undefined), so it asserted
      // nothing on any of these three positive branches. `.not.toBeNull()`
      // actually fails when the element is absent.
      if (blocks) expect(escapeButtonQuery()).not.toBeNull();
      else expect(escapeButtonQuery()).toBeNull();

      if (conflict) expect(conflictBannerQuery()).not.toBeNull();
      else expect(conflictBannerQuery()).toBeNull();

      if (syncingLeftover) expect(syncingLeftoverBannerQuery()).not.toBeNull();
      else expect(syncingLeftoverBannerQuery()).toBeNull();
    }
  );
});

// W5 (sdd-verify): the partial-confirm button previously gated only on
// `submitting`, so it stayed clickable offline or with a cleared/invalid
// field — it must respect the exact same `disabled` conditions as "Cerrar
// caja", since it is itself a resubmit.
describe('CashClose — the partial-confirm button is gated like the main button', () => {
  const confirmButton = () =>
    screen.getByRole('button', { name: 'Confirmar cierre parcial' });

  test('clearing the counted amount after the over-cap error disables the confirm button too', async () => {
    const user = userEvent.setup();
    H.create.mockRejectedValueOnce({ data: OVER_CAP_MESSAGE });
    render(<CashCloseScreen />);
    await fillValidCounts(user);
    await user.click(closeButton());
    await screen.findByText(OVER_CAP_MESSAGE);

    expect(confirmButton()).toHaveProperty('disabled', false);

    // countsValid becomes false — the SAME condition that already disables
    // "Cerrar caja". A button gated only on `submitting` would stay enabled
    // here and could send `create({ ..., countedUsd: NaN, ... })`.
    await user.clear(usdField());

    expect(confirmButton()).toHaveProperty('disabled', true);
  });
});

// W3 (sdd-verify round 3): every mock in this file settles synchronously, so
// no prior test observes the in-flight render — dropping `|| submitting`
// from disabledBase survives all of them. Without it, a double-click writes
// TWO immutable close rows (closes.create has no delete path), so the
// button must be disabled for the WHOLE duration of the request, not just
// before and after it.
describe('CashClose — the close action is disabled while the request is in flight (W3)', () => {
  test('disabled the moment a request starts, before the promise resolves', async () => {
    const user = userEvent.setup();
    let resolveCreate: (value: unknown) => void = () => {};
    H.create.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveCreate = resolve;
        })
    );
    render(<CashCloseScreen />);
    await fillValidCounts(user);
    expect(closeButton()).toHaveProperty('disabled', false);

    await user.click(closeButton());

    // The mocked promise has NOT resolved yet — the request is in flight.
    expect(closeButton()).toHaveProperty('disabled', true);

    resolveCreate(closeFixture());
    expect(await screen.findByText('Bs 0.00')).toBeDefined();
  });
});

// W4 (sdd-verify round 3): screen spec R1 names BOTH `Faltante` and
// `Sobrante`, but no prior test asserted either WORD — only the numeric
// difference values. Swapping diffLabel's two branches survived every
// existing assertion. Scoped to each tile's OWN `.meta` (not "the word
// appears somewhere"), since a swap would still make both words appear,
// just on the wrong tile.
describe('CashClose — Faltante and Sobrante render on their own currency tile (W4)', () => {
  function diffTileMeta(currencyLabel: string): string | null {
    const kSpan = screen.getByText(currencyLabel);
    const tile = kSpan.closest('.prod-stat');
    return tile?.querySelector('.meta')?.textContent ?? null;
  }

  test('a negative USD difference renders Faltante; a positive Bs difference renders Sobrante, each on its own tile', async () => {
    const user = userEvent.setup();
    H.create.mockResolvedValueOnce(
      closeFixture({ differenceUsd: -5, differenceBs: 10 })
    );
    render(<CashCloseScreen />);
    await fillValidCounts(user);
    await user.click(closeButton());

    await screen.findByText('-$5.00');
    expect(diffTileMeta('Diferencia ($)')).toBe('Faltante');
    expect(diffTileMeta('Diferencia (Bs)')).toBe('Sobrante');
  });
});

// W4: the two disclosure banners' titles are the most prominent thing
// distinguishing the two facts D8 insists must never be merged. Swapping
// them survived every existing assertion, which only checked message
// bodies. Scoped by DOM proximity (`.closest('.banner')`), since asserting
// both titles are merely PRESENT would still pass after a swap.
describe('CashClose — the conflict and syncing-leftover banner titles are not interchangeable (W4)', () => {
  function bannerMessageForTitle(title: string): string | null {
    const titleEl = screen.getByText(title);
    const banner = titleEl.closest('.banner');
    return banner?.querySelector('.msg')?.textContent ?? null;
  }

  test('each banner title pairs with its OWN message, not the other one', () => {
    H.pending.current = [
      { localId: 1, status: 'conflict' },
      { localId: 2, status: 'syncing' },
    ];
    render(<CashCloseScreen />);

    expect(bannerMessageForTitle('Ventas rechazadas por el servidor')).toBe(
      'Hay 1 venta que el servidor rechazó al sincronizar. Su efectivo no está incluido en lo esperado; es normal que la diferencia muestre un sobrante.'
    );
    expect(bannerMessageForTitle('Sincronización interrumpida')).toBe(
      'Hay 1 venta cuya sincronización quedó interrumpida en este dispositivo. No se sabe si el servidor llegó a recibir esa venta, así que su efectivo podría no estar incluido en lo esperado.'
    );
  });
});

// Item 1 (sdd-verify round 5, REAL DEFECT, not a coverage gap): a successful
// close reset offerPartial/needsOpenedAt/unsyncedAcknowledged but neither
// `reveal` nor the two count inputs. Consequence 1: the previous close's
// tiles (including Efectivo esperado) stayed mounted while the cashier typed
// their NEXT count — the exact anchoring spec R1 exists to prevent.
// Consequence 2: the counts stayed valid, so `disabled` went false the
// instant `submitting` cleared, and one more accidental click wrote a SECOND
// immutable close over a seconds-long window (expected ~0 against a full
// drawer count — a large fabricated Sobrante with no delete path).
describe('CashClose — a successful close clears the counts; typing a new one clears the reveal (real defect fix)', () => {
  test('after a successful close, both count inputs are empty and the button is disabled until new amounts are entered', async () => {
    const user = userEvent.setup();
    H.create.mockResolvedValueOnce(closeFixture());
    render(<CashCloseScreen />);
    await fillValidCounts(user);
    await user.click(closeButton());

    expect(await screen.findByText('Bs 0.00')).toBeDefined();
    expect(usdField()).toHaveProperty('value', '');
    expect(bsField()).toHaveProperty('value', '');
    // The reveal is NOT cleared by the success itself — the cashier just
    // asked for this result and must still be able to read it.
    expect(screen.getByText('Efectivo esperado ($)')).toBeDefined();
    // But countsValid is now false (both fields empty), so the button must
    // be disabled again immediately — not re-clickable until a NEW count.
    expect(closeButton()).toHaveProperty('disabled', true);
  });

  test('typing a new USD count after a successful close takes the previous reveal off screen', async () => {
    const user = userEvent.setup();
    H.create.mockResolvedValueOnce(closeFixture());
    render(<CashCloseScreen />);
    await fillValidCounts(user);
    await user.click(closeButton());
    await screen.findByText('Bs 0.00');

    await user.type(usdField(), '1');

    expect(screen.queryByText(/Efectivo esperado/)).toBeNull();
    expect(screen.queryByText(/Diferencia/)).toBeNull();
  });

  test('typing a new Bs count after a successful close takes the previous reveal off screen', async () => {
    const user = userEvent.setup();
    H.create.mockResolvedValueOnce(closeFixture());
    render(<CashCloseScreen />);
    await fillValidCounts(user);
    await user.click(closeButton());
    await screen.findByText('Bs 0.00');

    await user.type(bsField(), '1');

    expect(screen.queryByText(/Efectivo esperado/)).toBeNull();
    expect(screen.queryByText(/Diferencia/)).toBeNull();
  });

  test('a second, independent close completes end to end after the first, with its OWN reveal', async () => {
    const user = userEvent.setup();
    H.create
      .mockResolvedValueOnce(closeFixture())
      .mockResolvedValueOnce(
        closeFixture({ countedUsd: 50, differenceUsd: -1, differenceBs: 0 })
      );
    render(<CashCloseScreen />);
    await fillValidCounts(user);
    await user.click(closeButton());
    await screen.findByText('Bs 0.00');

    await user.type(usdField(), '50');
    await user.type(bsField(), '5000');
    expect(closeButton()).toHaveProperty('disabled', false);

    await user.click(closeButton());

    expect(await screen.findByText('-$1.00')).toBeDefined();
    expect(H.create.mock.calls[1][0]).toMatchObject({
      countedUsd: 50,
      countedBs: 5000,
    });
  });
});

// Item 2 (sdd-verify round 5): the four money tiles (Efectivo esperado /
// Contado, both currencies) had zero assertions — only the two Diferencia
// tiles were ever checked. Swapping expectedUsd<->countedUsd (or the Bs
// pair) at the success handler survived every test: the cashier would then
// read THEIR OWN count under "Efectivo esperado" — the exact figure the
// blind count exists to withhold. Scoped to each tile's OWN `.prod-stat` via
// `closest()`, the same way the diffLabel/banner-title fixes were, since
// "the number appears somewhere" cannot catch a swap.
describe('CashClose — all four money tiles show their OWN value, never a swapped one (item 2)', () => {
  // Scoped to `.prod-stat .k` specifically — "Contado ($)"/"Contado (Bs)"
  // also label the count-sheet's OWN inputs above the reveal, so a bare
  // `getByText` is ambiguous between the input label and the reveal tile.
  function tileValue(currencyLabel: string): string | null {
    const kSpan = Array.from(document.querySelectorAll('.prod-stat .k')).find(
      (el) => el.textContent === currencyLabel
    );
    const tile = kSpan?.closest('.prod-stat');
    return tile?.querySelector('.v')?.textContent ?? null;
  }

  test('Efectivo esperado and Contado each render their own figure, for both currencies', async () => {
    const user = userEvent.setup();
    // Expected != Counted per currency, AND USD != Bs, so no permutation of
    // the four values coincides with any other.
    H.create.mockResolvedValueOnce(
      closeFixture({
        expectedUsd: 100,
        countedUsd: 95,
        expectedBs: 5000,
        countedBs: 4800,
        differenceUsd: -5,
        differenceBs: -200,
      })
    );
    render(<CashCloseScreen />);
    await fillValidCounts(user);
    await user.click(closeButton());

    await screen.findByText('-$5.00');
    expect(tileValue('Efectivo esperado ($)')).toBe('$100.00');
    expect(tileValue('Contado ($)')).toBe('$95.00');
    expect(tileValue('Efectivo esperado (Bs)')).toBe('Bs 5000.00');
    expect(tileValue('Contado (Bs)')).toBe('Bs 4800.00');
  });
});

// Item 3 (sdd-verify round 5): D5's whole point — a supervisor switching
// between cashiers — had zero behavioural coverage. `tests:218` (the only
// prior assertion touching the picker) required just the <select> to exist,
// which survives even if `visibleCloses` ignores the filter entirely, or if
// `cashierNames` always returns []. This operates the control for real.
describe('CashClose — the cashier picker actually filters close history (D5, item 3)', () => {
  // Scoped to the history row's OWN `.pname` element — `getByText('Carlos')`
  // alone is ambiguous against the picker's `<option>Carlos</option>`, which
  // renders the identical string.
  function visibleCashierNames(): string[] {
    return Array.from(document.querySelectorAll('.lrow .pname')).map(
      (el) => el.textContent ?? ''
    );
  }

  test('two distinct cashiers: the picker options are derived from the distinct names, and selecting one shows only that cashier', async () => {
    const user = userEvent.setup();
    H.can.current = () => true;
    H.listResult.current = {
      closes: [
        closeFixture({ _id: 'c1', cashierName: 'Carlos' }),
        closeFixture({ _id: 'c2', cashierName: 'María' }),
      ],
      truncated: false,
    };
    render(<CashCloseScreen />);

    // Both rows visible before any filtering.
    expect(visibleCashierNames()).toEqual(['Carlos', 'María']);

    const picker = screen.getByLabelText('Cajero', { selector: 'select' });
    const optionLabels = Array.from(picker.querySelectorAll('option')).map(
      (o) => o.textContent
    );
    expect(optionLabels).toEqual(['Todos', 'Carlos', 'María']);

    await user.selectOptions(picker, 'María');

    expect(visibleCashierNames()).toEqual(['María']);

    // Reversible: back to "Todos" shows both again.
    await user.selectOptions(picker, 'all');
    expect(visibleCashierNames()).toEqual(['Carlos', 'María']);
  });
});

// SUGGESTION (sdd-verify round 5, item 5): closes.list's `truncated` flag
// was destructured away and dropped. History.tsx reads the identical flag
// from sales.history and discloses it as mandatory — closes.list caps its
// page exactly the same way. Compounds with item 3's picker: the filter
// runs client-side over the already-capped page, so a supervisor filtering
// to one cashier could be shown a silently short history.
describe('CashClose — a truncated close history is disclosed, adopting History.tsx idiom (item 5)', () => {
  test('closes.list returning truncated:true shows an incomplete-history warning', () => {
    H.listResult.current = { closes: [closeFixture()], truncated: true };
    render(<CashCloseScreen />);

    expect(screen.getByText(/Historial incompleto/)).toBeDefined();
  });

  test('closes.list returning truncated:false shows no warning', () => {
    H.listResult.current = { closes: [closeFixture()], truncated: false };
    render(<CashCloseScreen />);

    expect(screen.queryByText(/Historial incompleto/)).toBeNull();
  });
});

// Item 1 (REAL MONEY BUG, sdd-verify round 6): the Bs placeholder instructed
// "0,00" (Venezuelan comma decimal) while every keystroke is piped through
// the SHARED sanitizeAmount (src/screens/Payment.tsx), whose body is
// `String(input).replace(/[^\d.]/g, '')` — a comma is deleted outright, not
// converted. A cashier following the app's OWN instruction and typing
// "1234,50" submits 123450 (100x too much); "1.234,50" submits 1.23 (~1000x
// too little). The close row is immutable (closes exports only create/list),
// so the fabricated Sobrante/Faltante is permanent, with that cashier's name
// on it. sanitizeAmount itself is OUT OF SCOPE — shared with the
// already-shipped Payment screen. The fix is the placeholder alone: "0.00",
// matching the USD placeholder, fmtBs's own dot output, and Payment's own
// Bs-currency field (which already uses a dot feeding the same sanitiser).
describe('CashClose — the Bs placeholder no longer instructs a format the shared sanitiser destroys (item 1)', () => {
  test('both count placeholders use the dot decimal form', () => {
    render(<CashCloseScreen />);

    expect(usdField()).toHaveProperty('placeholder', '0.00');
    expect(bsField()).toHaveProperty('placeholder', '0.00');
  });

  test("a comma-formatted Bs amount is silently stripped by the shared sanitiser — PINNED, not fixed (sanitizeAmount is out of this slice's scope)", async () => {
    const user = userEvent.setup();
    H.create.mockResolvedValueOnce(closeFixture());
    render(<CashCloseScreen />);
    await user.type(usdField(), '95');
    // "1234,50" — the comma is stripped outright by sanitizeAmount (which
    // keeps only \d and '.'), leaving "123450": 100x the cashier's intent.
    // This assertion PINS that real, current hazard so it is never silently
    // "fixed" by an unrelated change to the shared sanitiser without this
    // test forcing a conscious decision — see spec.md's Known Limitations
    // for the honest account of the hazard itself.
    await user.type(bsField(), '1234,50');
    await user.click(closeButton());

    await screen.findByText('Bs 0.00');
    expect(H.create.mock.calls[0][0]).toMatchObject({ countedBs: 123450 });
  });
});

// Item 2 (sdd-verify round 6): CashClose.tsx's partial-confirm button
// deliberately gates on the FULL `disabled` (not `disabledBase`), so a
// blocking pending sale enqueued AFTER the over-cap rejection (e.g. by this
// same device's sync engine, or another tab) still re-locks it — but no
// prior test ever had a NON-empty, UNACKNOWLEDGED blocking queue at the same
// time `offerPartial` was true, so `disabled={disabledBase}` would have
// survived undetected.
describe('CashClose — the partial-confirm button also respects the blocking-queue gate (item 2)', () => {
  test('a blocking sale that appears after the over-cap rejection re-locks the confirm button, not just disabledBase', async () => {
    const user = userEvent.setup();
    H.create.mockRejectedValueOnce({ data: OVER_CAP_MESSAGE });
    render(<CashCloseScreen />);
    await fillValidCounts(user);
    await user.click(closeButton());
    await screen.findByText(OVER_CAP_MESSAGE);

    const confirmButton = () =>
      screen.getByRole('button', { name: 'Confirmar cierre parcial' });
    expect(confirmButton()).toHaveProperty('disabled', false);

    // A pending sale appears on this device AFTER offerPartial was already
    // set (e.g. queued by this same device's sync engine while the cashier
    // was looking at the confirm button). usePendingSales() is mocked, not
    // reactive, so a re-render is forced the same way any other state
    // change would — typing further into an already-valid field.
    H.pending.current = [{ localId: 1, status: 'pending' }];
    await user.type(usdField(), '0');

    expect(confirmButton()).toHaveProperty('disabled', true);
  });
});

// SUGGESTION (sdd-verify round 6, item 3): the history row's two money
// columns (USD difference, Bs difference) had zero assertions across every
// test that renders a row — the four such cases read only `.pname`, the
// `<option>` labels, or the truncation banner. This is the only surface
// where a view_reports supervisor reads ANOTHER cashier's outcome.
describe('CashClose — history rows show their OWN difference figures, both currencies (item 3)', () => {
  test('the USD and Bs difference columns render distinct values, scoped to their own row', () => {
    H.listResult.current = {
      closes: [
        closeFixture({
          _id: 'c1',
          cashierName: 'Carlos',
          differenceUsd: -5,
          differenceBs: 10,
        }),
      ],
      truncated: false,
    };
    render(<CashCloseScreen />);

    const row = screen.getByText('Carlos').closest('.lrow');
    const amounts = Array.from(
      row?.querySelectorAll('.pright .tabular') ?? []
    ).map((el) => el.textContent);
    expect(amounts).toEqual(['-$5.00', 'Bs 10.00']);
  });
});

// CashCloseScreen — a cashier counts their physical drawer against the
// server's blind expected figures (convex/closes.ts) and reviews close
// history, gated the same way the backend is: session-only to close your OWN
// drawer, view_reports to read ANOTHER cashier's closes.
//
// Blind ordering (spec Requirement 1): expected/counted/difference live in
// `reveal`, useState(null), and are set ONLY from closes.create's resolved
// value — never from closes.list, which this screen also queries but only
// for HISTORY. That is the only other call here (D4 — two calls, no third).
//
// Three closes.create contract items this screen must react to, all found
// by reading convex/closes.ts directly (some postdate tasks.md):
//   - confirmPartial: the ONLY way past the over-cap refusal. Never sent
//     silently — only the cashier's explicit "Confirmar cierre parcial"
//     click resends the request with it.
//   - countedFrom: present ONLY on a partial close. It means the expected
//     figures cover only (countedFrom, closedAt], not the whole window, so
//     the difference can show a surplus that is NOT real. Disclosed plainly
//     next to the difference whenever present.
//   - openedAt: required ONLY for a cashier's very first-ever close (no
//     previous `closes` row for them). This screen NEVER predicts that case
//     client-side — it cannot: when view_reports is held, the `closes` query
//     runs scope:'all', so the fetched rows mix EVERY cashier's closes, and
//     AUTH-2 strips `cashierId` from every one of them, so there is no
//     reliable "does THIS cashier already have a previous close" signal to
//     read locally (closes.length says nothing about this cashier alone,
//     and filtering by cashierName would be guessing at an identity the
//     screen was never given). So the reveal is ERROR-DRIVEN, exactly like
//     confirmPartial: the ordinary submit never sends `openedAt`; only once
//     the server rejects with the EXACT FIRST_CLOSE_MESSAGE below does the
//     opening-date field appear, and only then does a resubmit include it.
//
// The STRUCTURAL rule, not a per-status patch (this screen has now produced
// "a pending-sale status permanently bricks the close" FIVE times — over-cap,
// first close, conflicted sale, a syncing leftover, and a deterministic
// `failed` that never actually converts — closing the CLASS instead of the
// instance): the close must never be permanently blockable by anything.
//
// A `usePendingSales()` row's `status` (src/state/db.ts `PendingOpStatus`)
// sorts into exactly one of three OUTCOMES, verified against
// src/state/sync.ts's `isDue()` (:198-205) and its six status writes
// (pendingOps.ts:39, sync.ts:229,296,377,389,399):
//   - BLOCKS the close: `pending` and `failed` are the only two `isDue()`
//     ever revisits — pending immediately, failed once its capped backoff
//     elapses. These self-clear in the normal case, which is the only
//     legitimate reason to block: a sale landing seconds after the close
//     would otherwise silently fall outside its window.
//   - DISCLOSED, never blocks: `syncing` and `conflict` are the two
//     `isDue()` returns false for FOREVER (:204). `syncing` is written
//     BEFORE the network await (sync.ts:228-231, :295-298) — a crash, tab
//     close, reload or PWA kill during that await leaves it stuck there,
//     and nothing ever revisits it. `conflict` (sync.ts:385-395, e.g. a
//     STOCK_INSUFFICIENT the server rejected) is the same shape: permanent,
//     never retried. These are DIFFERENT facts about the cashier's money —
//     a `syncing` leftover's outcome is UNKNOWN to this device; a
//     `conflict` sale was DEFINITELY rejected — so they get separate,
//     honest banners, never merged into one message.
//   - Settled, neither blocks nor needs disclosure: `synced` never persists
//     as a row (both handlers delete the op on success, never write this
//     status) and `cancelled` is declared but never assigned anywhere in
//     `src/` today. Both are still mapped below so the partition stays
//     EXHAUSTIVE — a future status forces a decision here at compile time
//     via `satisfies`, instead of silently falling through the way
//     `syncing` did the first time this screen tried to enumerate "which
//     statuses are safe to block on."
//
// Blocking on `pending`/`failed` is still not allowed to be a dead end,
// because a `failed` op CAN retry forever in practice without ever
// resolving (a deterministic non-conflict server error keeps re-failing the
// same way every backoff cycle) — the escape hatch below is what closes the
// class rather than this one more instance: a deliberate, disclosed,
// never-silent "Cerrar de todas formas" lets the cashier override ANY
// blocking state, present or future, exactly like `confirmPartial` already
// lets them override the over-cap refusal.
import { useMemo, useState } from 'react';
import type { ChangeEvent } from 'react';
import { useMutation, useQuery } from 'convex/react';
import { api } from '@convex/_generated/api';
import { AppBar, Banner, Button, Icon, Input } from '@/components';
import { useSession } from '@/state/SessionContext';
import { useOnline } from '@/state/useOnline';
import { usePendingSales } from '@/state/usePendingSales';
import type { PendingSale } from '@/state/usePendingSales';
import { mutationError } from '@/lib/mutationError';
import { sanitizeAmount } from './Payment';
import type { Close } from '@/types';

type PendingCategory = 'blocking' | 'syncingLeftover' | 'conflict' | 'settled';

// `satisfies Record<PendingSale['status'], PendingCategory>` requires EVERY
// key of PendingOpStatus (src/state/db.ts:35-41) to be present and rejects
// any extra key — a status added to that union without a decision here
// fails to COMPILE, rather than silently landing in neither half of the
// partition.
const CATEGORY_BY_STATUS = {
  pending: 'blocking',
  failed: 'blocking',
  syncing: 'syncingLeftover',
  conflict: 'conflict',
  synced: 'settled',
  cancelled: 'settled',
} satisfies Record<PendingSale['status'], PendingCategory>;

function blockingMessage(count: number): string {
  const clause =
    count === 1
      ? 'venta pendiente de sincronizar. El monto esperado podría no incluirla si cierras ahora'
      : 'ventas pendientes de sincronizar. El monto esperado podría no incluirlas si cierras ahora';
  return `Tienes ${count} ${clause}.`;
}

function conflictMessage(count: number): string {
  const clause =
    count === 1
      ? 'venta que el servidor rechazó al sincronizar'
      : 'ventas que el servidor rechazó al sincronizar';
  // W9: never names a figure the screen does not render — usePendingSales'
  // totals are mirrored-price estimates that must never appear beside a
  // close figure (design.md), so this states the FACT (uncounted, expect a
  // surplus), never a specific amount.
  return `Hay ${count} ${clause}. Su efectivo no está incluido en lo esperado; es normal que la diferencia muestre un sobrante.`;
}

function syncingLeftoverMessage(count: number): string {
  const clause =
    count === 1
      ? 'venta cuya sincronización quedó interrumpida en este dispositivo. No se sabe si el servidor llegó a recibir esa venta'
      : 'ventas cuya sincronización quedó interrumpida en este dispositivo. No se sabe si el servidor llegó a recibir esas ventas';
  return `Hay ${count} ${clause}, así que su efectivo podría no estar incluido en lo esperado.`;
}

// The EXACT Spanish message `closes.create` throws when this cashier's own
// window holds more than 1000 unclosed sales or refunds. There is no error
// CODE — only this literal string — so it is matched exactly, never with
// `.includes`, to avoid ever misreading an unrelated rejection as "offer a
// partial close."
const OVER_CAP_MESSAGE =
  'Tienes más de 1000 ventas sin cerrar. Confirma un cierre parcial para cerrar solo las más recientes.';

// The EXACT Spanish message `closes.create` throws when this cashier has NO
// previous close and did not supply `openedAt`. Same exact-match discipline
// as OVER_CAP_MESSAGE, for the same reason: there is no error CODE, and a
// looser match (`.includes`) could misread an unrelated rejection as "reveal
// the opening-date field."
const FIRST_CLOSE_MESSAGE = 'Indica desde cuándo cuenta este primer cierre.';

// The EXACT Spanish message `closes.create` throws when `openedAt` is sent
// but a previous close already exists (convex/closes.ts) — W10: this
// rejection PROVES a previous close now exists (e.g. the same cashier closed
// on another device between this screen's first rejection and this
// resubmit), so it is the signal to reset `needsOpenedAt` — otherwise every
// later resubmit in this mount would keep sending `openedAt` and keep
// getting refused by this exact message, forever.
const WINDOW_CONTINUATION_MESSAGE =
  'El cierre continúa desde tu cierre anterior; no puedes elegir la fecha de inicio.';

// Computed ONCE at module load (mirrors History.tsx's TODAY_ISO) rather than
// inside a hook initializer — `new Date()` is impure and must not run in a
// render-time initializer. Local calendar date (Y-M-D from getFullYear/
// getMonth/getDate), NOT `.toISOString()`: a Venezuelan shop's day boundary
// is local midnight, not UTC midnight.
const TODAY_LOCAL_ISO = (() => {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
})();

// `YYYY-MM-DD` (the native <input type="date"> value shape) → epoch ms at
// 00:00 LOCAL time on that day — matches History.tsx's own
// `new Date(fromDate + 'T00:00:00').getTime()` idiom for the same reason:
// a bare `new Date(iso)` parses as UTC midnight, which is the wrong instant
// for a local shop day.
function startOfLocalDay(iso: string): number {
  return new Date(`${iso}T00:00:00`).getTime();
}

interface Reveal {
  expectedUsd: number;
  expectedBs: number;
  countedUsd: number;
  countedBs: number;
  differenceUsd: number;
  differenceBs: number;
  countedFrom?: number;
}

function fmtUsd(n: number): string {
  return `${n < 0 ? '-' : ''}$${Math.abs(n).toFixed(2)}`;
}
function fmtBs(n: number): string {
  return `${n < 0 ? '-' : ''}Bs ${Math.abs(n).toFixed(2)}`;
}
// .prod-stat has no .ok tone (app.css) — an exact match renders the plain,
// untoned tile rather than inventing a class that was never design-verified.
function diffTone(n: number): string {
  if (n < 0) return 'danger'; // Faltante — a real shortfall
  if (n > 0) return 'warn'; // Sobrante
  return '';
}
function diffLabel(n: number): string {
  if (n < 0) return 'Faltante';
  if (n > 0) return 'Sobrante';
  return 'Exacto';
}
function fmtClosedAt(ts: number): string {
  return new Date(ts).toLocaleString('es', {
    day: '2-digit',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

export default function CashCloseScreen() {
  const { token, can } = useSession();
  const online = useOnline();
  const pendingSales = usePendingSales();
  const create = useMutation(api.closes.create);

  const canViewOthers = can('view_reports');
  // scope:'all' returns EVERY cashier's closes; the picker below is built
  // from the distinct cashierNames already in that result (D5) — there is no
  // cashierId a view_reports-only supervisor could otherwise send (AUTH-2).
  const closesRaw = useQuery(
    api.closes.list,
    token ? { token, scope: canViewOthers ? 'all' : 'own' } : 'skip'
  );
  const closes: Close[] = useMemo(() => closesRaw?.closes ?? [], [closesRaw]);
  // No Dexie mirror for `closes` (design): offline with nothing cached yet,
  // the list is undefined — same connection-required shape as History's
  // salesUnavailable.
  const closesUnavailable = !online && closesRaw === undefined;
  // History.tsx reads this same flag from its own list query and discloses
  // it (never silently drops it) — closes.list caps its page exactly like
  // sales.history does. This compounds with the cashier picker below: the
  // filter runs client-side over the already-capped page, so a supervisor
  // filtering to one cashier could otherwise be shown a silently short
  // history with no indication anything was cut.
  const closesTruncated = closesRaw?.truncated === true;

  const cashierNames = useMemo(
    () => Array.from(new Set(closes.map((c) => c.cashierName))).sort(),
    [closes]
  );
  const [cashierFilter, setCashierFilter] = useState('all');
  const visibleCloses =
    canViewOthers && cashierFilter !== 'all'
      ? closes.filter((c) => c.cashierName === cashierFilter)
      : closes;

  const [countedUsdText, setCountedUsdText] = useState('');
  const [countedBsText, setCountedBsText] = useState('');
  const countedUsd = parseFloat(countedUsdText);
  const countedBs = parseFloat(countedBsText);
  const countsValid =
    Number.isFinite(countedUsd) &&
    countedUsd >= 0 &&
    Number.isFinite(countedBs) &&
    countedBs >= 0;

  const [reveal, setReveal] = useState<Reveal | null>(null);
  const [error, setError] = useState('');
  const [offerPartial, setOfferPartial] = useState(false);
  // Revealed ONLY once the server has rejected with the EXACT
  // FIRST_CLOSE_MESSAGE — never predicted (see the module header comment for
  // why this cannot be known client-side). `openedAtDate` defaults to today
  // so the field is never blank when it first appears.
  const [needsOpenedAt, setNeedsOpenedAt] = useState(false);
  const [openedAtDate, setOpenedAtDate] = useState(TODAY_LOCAL_ISO);
  const [submitting, setSubmitting] = useState(false);
  // The explicit escape hatch (see the module header comment): true ONLY
  // after the cashier's deliberate "Cerrar de todas formas" click — never a
  // default, never inferred. Reset on a successful close so a LATER close in
  // the same session (a different, possibly changed queue) requires its own
  // fresh acknowledgement rather than silently inheriting this one.
  const [unsyncedAcknowledged, setUnsyncedAcknowledged] = useState(false);

  const blockingCount = useMemo(
    () =>
      pendingSales.filter((p) => CATEGORY_BY_STATUS[p.status] === 'blocking')
        .length,
    [pendingSales]
  );
  const syncingLeftoverCount = useMemo(
    () =>
      pendingSales.filter(
        (p) => CATEGORY_BY_STATUS[p.status] === 'syncingLeftover'
      ).length,
    [pendingSales]
  );
  const conflictedCount = useMemo(
    () =>
      pendingSales.filter((p) => CATEGORY_BY_STATUS[p.status] === 'conflict')
        .length,
    [pendingSales]
  );
  // Every OTHER reason to disable — shared by both the main button and the
  // escape button, since overriding the queue block must not also bypass
  // "offline" or "invalid counts."
  const disabledBase =
    !online || !countsValid || (needsOpenedAt && !openedAtDate) || submitting;
  const disabled = disabledBase || (blockingCount > 0 && !unsyncedAcknowledged);

  const submit = async (confirmPartial?: boolean) => {
    if (!token || !countsValid) return;
    setSubmitting(true);
    setError('');
    // confirmPartial is added to the payload ONLY on the cashier's explicit
    // confirm click (see the "Confirmar cierre parcial" button below) — never
    // sent as an implicit `undefined` key on the ordinary path. openedAt is
    // added ONLY once needsOpenedAt is already true, i.e. only AFTER the
    // server has already told us (via FIRST_CLOSE_MESSAGE) that this cashier
    // has no previous close — never guessed or sent on the first attempt.
    const payload: {
      token: string;
      countedUsd: number;
      countedBs: number;
      confirmPartial?: boolean;
      openedAt?: number;
    } = { token, countedUsd, countedBs };
    if (confirmPartial) payload.confirmPartial = true;
    if (needsOpenedAt) payload.openedAt = startOfLocalDay(openedAtDate);
    try {
      const result = await create(payload);
      setReveal({
        expectedUsd: result.expectedUsd,
        expectedBs: result.expectedBs,
        countedUsd: result.countedUsd,
        countedBs: result.countedBs,
        differenceUsd: result.differenceUsd,
        differenceBs: result.differenceBs,
        countedFrom: result.countedFrom,
      });
      setOfferPartial(false);
      // Reset for any LATER close in this same mount: a second close for this
      // cashier now has a previous row, so openedAt would be REFUSED
      // ('El cierre continúa desde tu cierre anterior...') if kept true.
      setNeedsOpenedAt(false);
      // A fresh acknowledgement is required for each close, not inherited.
      setUnsyncedAcknowledged(false);
      // sdd-verify round 5 (REAL DEFECT): clear the counts, but NOT `reveal`
      // — the cashier just asked for this result and must be able to read
      // it. Without clearing the counts, they stay valid, `disabled` goes
      // false the instant `submitting` clears, and one further accidental
      // click would write a SECOND immutable close over a seconds-long
      // window (expected ~0 against a full drawer count — a large
      // fabricated Sobrante with no delete path). `reveal` itself is cleared
      // separately, in the two count change handlers below, the moment the
      // cashier starts a NEW count — not here, or the result they just
      // asked for would vanish before they can read it.
      setCountedUsdText('');
      setCountedBsText('');
    } catch (e) {
      const msg = mutationError(e);
      setError(msg);
      setOfferPartial(msg === OVER_CAP_MESSAGE);
      if (msg === FIRST_CLOSE_MESSAGE) {
        setNeedsOpenedAt(true);
      } else if (msg === WINDOW_CONTINUATION_MESSAGE) {
        // W10: this rejection PROVES a previous close now exists (gained
        // elsewhere between the first rejection and this resubmit) — reset
        // so the NEXT resubmit stops sending openedAt, which is exactly what
        // this message is refusing.
        setNeedsOpenedAt(false);
      }
      // Any OTHER rejection (e.g. an invalid date) leaves needsOpenedAt
      // exactly as it was. Once revealed, the date field must stay up — a
      // bad date replies with 'La fecha de apertura no es válida.', not
      // FIRST_CLOSE_MESSAGE again, and resetting on that reply would hide
      // the very field the cashier needs to correct it, stranding them
      // exactly like a bare refusal would.
    } finally {
      setSubmitting(false);
    }
  };

  // sdd-verify round 5 (REAL DEFECT): the moment the cashier starts typing a
  // NEW count, the PREVIOUS close's expected figure must be off screen — the
  // `reveal &&` guard alone does not do this, since `reveal` otherwise only
  // changes on the NEXT submit. Blindness (spec R1) applies to every close
  // after the first, not just the first: a stale `Efectivo esperado` staying
  // mounted while a new count is entered is exactly the anchoring R1 exists
  // to prevent.
  const onUsdChange = (e: ChangeEvent<HTMLInputElement>) => {
    setCountedUsdText(sanitizeAmount(e.target.value));
    setReveal(null);
  };
  const onBsChange = (e: ChangeEvent<HTMLInputElement>) => {
    setCountedBsText(sanitizeAmount(e.target.value));
    setReveal(null);
  };

  return (
    <>
      <AppBar title="Cierre de caja" online={online} />
      <div className="content">
        <div className="card card-padded">
          <div className="sec-head">
            <h2>Conteo de caja</h2>
          </div>
          <label className="client-field">
            <span>
              Contado ($)<span className="req"> *</span>
            </span>
            <Input
              mono
              inputMode="decimal"
              value={countedUsdText}
              onChange={onUsdChange}
              placeholder="0.00"
            />
          </label>
          <label className="client-field">
            <span>
              Contado (Bs)<span className="req"> *</span>
            </span>
            <Input
              mono
              inputMode="decimal"
              value={countedBsText}
              onChange={onBsChange}
              placeholder="0.00"
            />
          </label>

          {error && (
            <Banner tone="danger" icon="alert-triangle" message={error} />
          )}
          {needsOpenedAt && (
            <label className="client-field">
              <span>
                Desde qué día cuenta este primer cierre
                <span className="req"> *</span>
              </span>
              <Input
                type="date"
                value={openedAtDate}
                max={TODAY_LOCAL_ISO}
                onChange={(e) => setOpenedAtDate(e.target.value)}
              />
            </label>
          )}
          {offerPartial && (
            <Button
              variant="danger"
              // Same conditions as the main button, not just `submitting`:
              // this control is a resubmit too, and must not stay clickable
              // offline or with a cleared/invalid field (which would send
              // openedAt: NaN if a first-close date was also blanked).
              disabled={disabled}
              onClick={() => void submit(true)}
            >
              Confirmar cierre parcial
            </Button>
          )}

          <Button block disabled={disabled} onClick={() => void submit()}>
            Cerrar caja
          </Button>
          {!online && (
            <div className="t-body-sm">Cerrar la caja requiere conexión.</div>
          )}
          {blockingCount > 0 && (
            <>
              <div className="t-body-sm">{blockingMessage(blockingCount)}</div>
              {/* The escape hatch (module header comment): the ONLY control
                  that bypasses the blockingCount check — every OTHER reason
                  (offline, invalid counts, an unresolved first-close date)
                  still applies via disabledBase. A deliberate click, never a
                  default: unsyncedAcknowledged starts false and is set true
                  only here. */}
              <Button
                variant="danger"
                disabled={disabledBase}
                onClick={() => {
                  setUnsyncedAcknowledged(true);
                  void submit();
                }}
              >
                Cerrar de todas formas
              </Button>
            </>
          )}
        </div>

        {conflictedCount > 0 && (
          <Banner
            tone="warn"
            icon="alert-triangle"
            title="Ventas rechazadas por el servidor"
            message={conflictMessage(conflictedCount)}
          />
        )}
        {syncingLeftoverCount > 0 && (
          <Banner
            tone="warn"
            icon="alert-triangle"
            title="Sincronización interrumpida"
            message={syncingLeftoverMessage(syncingLeftoverCount)}
          />
        )}

        {reveal && (
          <>
            {reveal.countedFrom !== undefined && (
              <Banner
                tone="warn"
                icon="alert-triangle"
                title="Cierre parcial"
                message="Este cierre es parcial: lo esperado corresponde solo a las ventas más recientes, no a todo el período. La diferencia puede mostrar un sobrante que no es real."
              />
            )}
            <div className="prod-stats">
              <div className="prod-stat">
                <span className="k">Efectivo esperado ($)</span>
                <span className="v tabular">{fmtUsd(reveal.expectedUsd)}</span>
              </div>
              <div className="prod-stat">
                <span className="k">Contado ($)</span>
                <span className="v tabular">{fmtUsd(reveal.countedUsd)}</span>
              </div>
              <div className={`prod-stat ${diffTone(reveal.differenceUsd)}`}>
                <span className="k">Diferencia ($)</span>
                <span className="v tabular">
                  {fmtUsd(reveal.differenceUsd)}
                </span>
                <span className="meta">{diffLabel(reveal.differenceUsd)}</span>
              </div>
              <div className="prod-stat">
                <span className="k">Efectivo esperado (Bs)</span>
                <span className="v tabular">{fmtBs(reveal.expectedBs)}</span>
              </div>
              <div className="prod-stat">
                <span className="k">Contado (Bs)</span>
                <span className="v tabular">{fmtBs(reveal.countedBs)}</span>
              </div>
              <div className={`prod-stat ${diffTone(reveal.differenceBs)}`}>
                <span className="k">Diferencia (Bs)</span>
                <span className="v tabular">{fmtBs(reveal.differenceBs)}</span>
                <span className="meta">{diffLabel(reveal.differenceBs)}</span>
              </div>
            </div>
          </>
        )}

        <div className="sec-head">
          <h2>Historial de cierres</h2>
        </div>
        {closesTruncated && (
          <Banner
            tone="warn"
            icon="alert-triangle"
            title="Historial incompleto"
            message="Hay más cierres de los que se pueden mostrar. Esta lista está incompleta."
          />
        )}
        {canViewOthers && (
          <label className="catalog-filter">
            <span>Cajero</span>
            <select
              className="input cat-select"
              value={cashierFilter}
              onChange={(e) => setCashierFilter(e.target.value)}
            >
              <option value="all">Todos</option>
              {cashierNames.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </label>
        )}

        {closesUnavailable ? (
          <Banner
            tone="warn"
            icon="wifi-off"
            title="Sin conexión"
            message="El historial de cierres requiere conexión."
          />
        ) : visibleCloses.length === 0 ? (
          <div className="card empty">
            <h4>Sin cierres registrados</h4>
          </div>
        ) : (
          <div className="card">
            {visibleCloses.map((c) => (
              <div className="lrow" key={c._id}>
                <div className="thumb">
                  <Icon name="coins" size={18} />
                </div>
                <div>
                  <p className="pname">{c.cashierName}</p>
                  <div className="pmeta">{fmtClosedAt(c.closedAt)}</div>
                </div>
                <div className="pright">
                  <div className="tabular">{fmtUsd(c.differenceUsd)}</div>
                  <div className="tabular">{fmtBs(c.differenceBs)}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

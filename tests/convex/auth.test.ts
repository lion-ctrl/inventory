/// <reference types="vite/client" />
// Characterization tests for the no-auth-package login (email + 6-digit PIN).
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "@convex/_generated/api";
import schema from "@convex/schema";
import { seedBase } from "./fixtures";

const modules = import.meta.glob("../../convex/**/*.ts");

async function setup() {
  const t = convexTest(schema, modules);
  const fx = await t.run(seedBase);
  return { t, fx };
}

describe("auth.login", () => {
  test("accepts correct credentials with messy email casing/whitespace", async () => {
    const { t, fx } = await setup();
    const res = await t.mutation(api.auth.login, {
      email: "  CARLOS@Mitienda.com ",
      pin: "482106",
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.employee._id).toBe(fx.owner);
      expect(res.employee.permissions).toBe("all");
      expect(typeof res.employee.lastActive).toBe("number");
    }
  });

  test("patches lastActive on successful login", async () => {
    const { t, fx } = await setup();
    const before = await t.run((ctx) => ctx.db.get("employees", fx.owner));
    expect(before!.lastActive).toBeUndefined();

    await t.mutation(api.auth.login, { email: "carlos@mitienda.com", pin: "482106" });
    const after = await t.run((ctx) => ctx.db.get("employees", fx.owner));
    expect(typeof after!.lastActive).toBe("number");
  });

  test("rejects a wrong PIN and unknown emails with the same generic error", async () => {
    const { t } = await setup();
    const wrongPin = await t.mutation(api.auth.login, {
      email: "carlos@mitienda.com",
      pin: "000000",
    });
    expect(wrongPin).toEqual({
      ok: false,
      error: "Credenciales inválidas. Verifica e intenta de nuevo.",
    });

    const unknown = await t.mutation(api.auth.login, {
      email: "nadie@mitienda.com",
      pin: "482106",
    });
    expect(unknown).toEqual({
      ok: false,
      error: "Credenciales inválidas. Verifica e intenta de nuevo.",
    });
  });

  test("rejects inactive employees even with correct credentials", async () => {
    const { t } = await setup();
    const res = await t.mutation(api.auth.login, {
      email: "carlos.rivas@mitienda.com",
      pin: "864253",
    });
    expect(res).toEqual({
      ok: false,
      error: "Usuario inactivo. Contacta al propietario.",
    });
  });
});

describe("auth.me", () => {
  test("returns the employee for a valid persisted id", async () => {
    const { t, fx } = await setup();
    const me = await t.query(api.auth.me, { employeeId: fx.owner });
    expect(me?._id).toBe(fx.owner);
  });

  test("returns null (never throws) for stale/garbage ids and inactive employees", async () => {
    const { t, fx } = await setup();
    // Garbage from an old deployment's localStorage must not crash the session boot.
    await expect(
      t.query(api.auth.me, { employeeId: "definitely-not-an-id" }),
    ).resolves.toBeNull();

    await expect(
      t.query(api.auth.me, { employeeId: fx.inactive }),
    ).resolves.toBeNull();

    const deleted = await t.run(async (ctx) => {
      const id = fx.cajeroPlain;
      await ctx.db.delete("employees", id);
      return id;
    });
    await expect(t.query(api.auth.me, { employeeId: deleted })).resolves.toBeNull();
  });
});

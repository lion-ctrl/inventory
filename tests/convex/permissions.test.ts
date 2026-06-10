/// <reference types="vite/client" />
// RBAC characterization: the pure can() helper + server-side guards through the API.
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "@convex/_generated/api";
import schema from "@convex/schema";
import { can } from "@convex/permissions";
import type { Doc } from "@convex/_generated/dataModel";
import { permsOf, seedBase } from "./fixtures";

const modules = import.meta.glob("../../convex/**/*.ts");

async function setup() {
  const t = convexTest(schema, modules);
  const fx = await t.run(seedBase);
  return { t, fx };
}

const emp = (overrides: Partial<Doc<"employees">>): Doc<"employees"> =>
  ({
    name: "X",
    email: "x@x.com",
    phone: "0",
    role: "cajero",
    permissions: permsOf(),
    pin: "000000",
    active: true,
    createdAt: 0,
    ...overrides,
  }) as Doc<"employees">;

describe("can() — pure RBAC check", () => {
  test("null/undefined users have no permissions", () => {
    expect(can(null, "view_reports")).toBe(false);
    expect(can(undefined, "manage_settings")).toBe(false);
  });

  test("'all' sentinel grants everything — and wins BEFORE the active check (prototype parity)", () => {
    expect(can(emp({ permissions: "all" }), "manage_settings")).toBe(true);
    // Characterized quirk ported from the prototype: an inactive user whose
    // permissions are 'all' still passes can() — auth.me/login are the layers
    // that lock inactive users out of the app.
    expect(can(emp({ permissions: "all", active: false }), "void_sales")).toBe(true);
  });

  test("granular map: inactive users lose everything, others get exactly what was granted", () => {
    const granted = permsOf("view_reports", "void_sales");
    expect(can(emp({ permissions: granted }), "view_reports")).toBe(true);
    expect(can(emp({ permissions: granted }), "void_sales")).toBe(true);
    expect(can(emp({ permissions: granted }), "manage_products")).toBe(false);
    expect(can(emp({ permissions: granted, active: false }), "view_reports")).toBe(false);
  });
});

describe("server-side guards (requirePerm through the API)", () => {
  test("employees.list requires manage_employees and excludes the actor", async () => {
    const { t, fx } = await setup();

    await expect(
      t.query(api.employees.list, { actorId: fx.cajeroPlain }),
    ).rejects.toThrow("Sin permisos para esta acción.");

    const list = await t.query(api.employees.list, { actorId: fx.owner });
    expect(list).toHaveLength(3); // 4 seeded minus the actor
    expect(list.some((e) => e._id === fx.owner)).toBe(false);
  });

  test("settings.update requires manage_settings", async () => {
    const { t, fx } = await setup();

    await expect(
      t.mutation(api.settings.update, {
        actorId: fx.cajeroPlain,
        patch: { bsRate: 40 },
      }),
    ).rejects.toThrow("Sin permisos para esta acción.");

    await t.mutation(api.settings.update, {
      actorId: fx.owner,
      patch: { bsRate: 40 },
    });
    const settings = await t.run((ctx) => ctx.db.get("settings", fx.settingsId));
    expect(settings!.bsRate).toBe(40);
  });
});

describe("PIN validation (6 digits, server-side)", () => {
  test("employees.create rejects malformed PINs", async () => {
    const { t, fx } = await setup();
    await expect(
      t.mutation(api.employees.create, {
        actorId: fx.owner,
        name: "Nuevo Cajero",
        email: "nuevo@mitienda.com",
        phone: "04140000000",
        role: "cajero",
        permissions: permsOf("manage_clients"),
        pin: "123",
        active: true,
      }),
    ).rejects.toThrow("El PIN debe tener 6 dígitos.");
  });

  test("employees.updateSelf validates the new PIN and patches own fields", async () => {
    const { t, fx } = await setup();

    await expect(
      t.mutation(api.employees.updateSelf, {
        actorId: fx.cajeroPlain,
        patch: { pin: "12345a" },
      }),
    ).rejects.toThrow("El PIN debe tener 6 dígitos.");

    await t.mutation(api.employees.updateSelf, {
      actorId: fx.cajeroPlain,
      patch: { pin: "111222", name: "Ana T. Actualizada" },
    });
    const ana = await t.run((ctx) => ctx.db.get("employees", fx.cajeroPlain));
    expect(ana!.pin).toBe("111222");
    expect(ana!.name).toBe("Ana T. Actualizada");
  });
});

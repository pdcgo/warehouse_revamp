// selling_service's TeamReturnConfigurationService as Storybook's stub — where a selling team's returns are
// received (the-return-warehouse-lives-in-team-return-configurations). One row per team; no row = not set.
//
// Seeded so both states can be looked at: Toko Melati (12) has Gudang Pusat (11), Toko Kenanga (13) has none.
// Any warehouse is accepted (a-team-may-pick-any-return-warehouse), as the server accepts it.
//
// WRITEABLE: a save is read back on the next detail. preview.tsx resets it in its `beforeEach`.
//
// It also serves the team's RETURN MAPS (the-return-map-is-selling-services-and-read-by-ids): one pair per team per
// borrowed product, written once. Seeded with one, so the order form's locked "from last time" row is on screen at
// first look: Toko Melati (12) maps Toko Kenanga's Gula Pasir (73) to its own Beras Pandan Wangi (74). The write
// refuses what the server refuses — a "borrowed" product that is the team's own, "our" product that is not, and a
// product nobody owns — and hands back the standing pair with `created = false` rather than overwriting it.
//
// The same maps are PRODUK TURUNAN (produk-turunan-is-the-return-map): ProductDerivedList reads one product's maps both
// ways and ACROSS TEAMS — the ones landing on it, and every team's from it — newest first, at most 200 a direction with
// its total, and refuses a warehouse role as the server does (Discover's policy). A story seeds its maps with
// `withReturnMaps(...)`, each written after the one before it.

import { Code, ConnectError } from "@connectrpc/connect";
import type { ServiceImpl } from "@connectrpc/connect";

import { Role } from "../src/gen/warehouse/role_base/v1/role_pb";
import type { TeamReturnConfigurationService } from "../src/gen/warehouse/selling/v1/return_configuration_pb";
import { products } from "./fixtures";
import { sessionScenario } from "./sessionScenario";

const SEEDED_AT = 1_790_000_000n;

const seed = (): Map<bigint, { warehouseId: bigint; updatedAtUnix: bigint }> =>
  new Map([[12n, { warehouseId: 11n, updatedAtUnix: SEEDED_AT }]]);

let table = seed();

export function resetReturnConfigurationStub() {
  table = seed();
}

/**
 * A `beforeEach`: `teamId` returns to `warehouseId` for this story — 0n takes its return warehouse away. preview.tsx's
 * reset puts the seed back before the next story. (The return accept's wrong-building and no-warehouse cases.)
 */
export function withReturnWarehouse(teamId: bigint, warehouseId: bigint) {
  return () => {
    if (warehouseId === 0n) {
      table.delete(teamId);
      return;
    }

    table.set(teamId, { warehouseId, updatedAtUnix: SEEDED_AT });
  };
}

/** The team's saved return warehouse, 0n when none — what a story asserts a save wrote. */
export function returnWarehouseOf(teamId: bigint): bigint {
  return table.get(teamId)?.warehouseId ?? 0n;
}

// ── The return maps ──────────────────────────────────────────────────────────────────────────────

type MapRow = { ownProductId: bigint; createdAtUnix: bigint };

const mapKey = (teamId: bigint, sharedProductId: bigint) => `${teamId}:${sharedProductId}`;

const seedMaps = (): Map<string, MapRow> =>
  new Map([[mapKey(12n, 73n), { ownProductId: 74n, createdAtUnix: SEEDED_AT }]]);

let maps = seedMaps();

export function resetReturnMapStub() {
  maps = seedMaps();
}

/** A pair somebody else already wrote — the state a story about `created = false` starts from. */
export function seedReturnMap(teamId: bigint, sharedProductId: bigint, ownProductId: bigint) {
  maps.set(mapKey(teamId, sharedProductId), { ownProductId, createdAtUnix: SEEDED_AT });
}

/**
 * A `beforeEach`: these maps — `[team, borrowed product, own product]` each — written one after another, so each is newer
 * than the one before it (Produk Turunan lists the newest first). preview.tsx's reset puts the seed back.
 */
export function withReturnMaps(...pairs: [bigint, bigint, bigint][]) {
  return () => {
    pairs.forEach(([teamId, sharedProductId, ownProductId], i) => {
      maps.set(mapKey(teamId, sharedProductId), { ownProductId, createdAtUnix: SEEDED_AT + 60n * BigInt(i + 1) });
    });
  };
}

/** The team's standing map of a borrowed product, 0n when none — what a story asserts a pick wrote. */
export function returnMapOf(teamId: bigint, sharedProductId: bigint): bigint {
  return maps.get(mapKey(teamId, sharedProductId))?.ownProductId ?? 0n;
}

const pairOf = (teamId: bigint, sharedProductId: bigint, row: MapRow) => ({ teamId, sharedProductId, ...row });

const productNamed = (id: bigint) => products.find((p) => p.id === id);

/** At most this many maps a direction — the server's cap (CommonPagination's largest page). */
const DERIVED_CAP = 200;
const WAREHOUSE_ROLES: Role[] = [Role.WAREHOUSE_OWNER, Role.WAREHOUSE_ADMIN, Role.WAREHOUSE_STAFF];

/** Every map in the table, newest first (written later first on a tie, as the server breaks it by id). */
function newestMaps() {
  return [...maps.entries()]
    .map(([key, row], order) => {
      const [teamId, sharedProductId] = key.split(":").map((part) => BigInt(part)) as [bigint, bigint];

      return { teamId, sharedProductId, ...row, order };
    })
    .sort((a, b) => (a.createdAtUnix === b.createdAtUnix ? b.order - a.order : a.createdAtUnix > b.createdAtUnix ? -1 : 1))
    .map(({ order: _order, ...pair }) => pair);
}

export const returnConfigurationService: Partial<ServiceImpl<typeof TeamReturnConfigurationService>> = {
  teamReturnConfigurationDetail: (req) => {
    const row = table.get(req.teamId);

    return { configuration: row ? { teamId: req.teamId, ...row } : undefined };
  },
  // Keyed by team id; a team with no row is absent — the absence root's Teams list marks.
  teamReturnConfigurationByIds: (req) => ({
    items: Object.fromEntries(
      (req.filter?.ids ?? [])
        .filter((teamId) => table.has(teamId))
        .map((teamId) => [
          teamId.toString(),
          {
            items: [
              {
                d: {
                  case: "configuration" as const,
                  value: { mapData: { [teamId.toString()]: { teamId, ...table.get(teamId)! } } },
                },
              },
            ],
          },
        ]),
    ),
  }),
  teamReturnConfigurationSet: (req) => {
    const row = { warehouseId: req.warehouseId, updatedAtUnix: BigInt(Math.floor(Date.now() / 1000)) };
    table.set(req.teamId, row);

    return { configuration: { teamId: req.teamId, ...row } };
  },
  // The server's two ownership refusals and its NotFound, then ON CONFLICT DO NOTHING: a standing pair comes back as it
  // is, `created = false`.
  productReturnMapCreate: (req) => {
    const shared = productNamed(req.sharedProductId);
    if (!shared) {
      throw new ConnectError(
        `product ${req.sharedProductId} does not exist, so it cannot be mapped for returns`,
        Code.NotFound,
      );
    }
    if (shared.teamId === req.teamId) {
      throw new ConnectError(
        `${shared.productCode} is this team's own product — only another team's product is mapped for returns`,
        Code.FailedPrecondition,
      );
    }

    const own = productNamed(req.ownProductId);
    if (!own || own.teamId !== req.teamId) {
      throw new ConnectError(
        `${own?.productCode ?? `product ${req.ownProductId}`} is not one of this team's products — a return can only come back as your own`,
        Code.FailedPrecondition,
      );
    }

    const key = mapKey(req.teamId, req.sharedProductId);
    const standing = maps.get(key);
    if (standing) return { map: pairOf(req.teamId, req.sharedProductId, standing), created: false };

    const row = { ownProductId: req.ownProductId, createdAtUnix: BigInt(Math.floor(Date.now() / 1000)) };
    maps.set(key, row);

    return { map: pairOf(req.teamId, req.sharedProductId, row), created: true };
  },
  // PRODUK TURUNAN — one product's maps both ways, EVERY team's: the scoped team only authorizes. A warehouse role is
  // refused, as Discover refuses it.
  productDerivedList: (req) => {
    if (WAREHOUSE_ROLES.includes(sessionScenario.role)) {
      throw new ConnectError("a product's derived products are read on Discover, which serves selling teams only", Code.PermissionDenied);
    }

    const productId = req.filter?.productId ?? 0n;
    const all = newestMaps();
    const from = all.filter((m) => m.ownProductId === productId);
    const to = all.filter((m) => m.sharedProductId === productId);

    return {
      derivedFrom: from.slice(0, DERIVED_CAP),
      derivedTo: to.slice(0, DERIVED_CAP),
      derivedFromTotal: BigInt(from.length),
      derivedToTotal: BigInt(to.length),
    };
  },
  // Keyed by the borrowed product; one this team has not mapped is absent — another team's pair never shows.
  productReturnMapByIds: (req) => ({
    items: Object.fromEntries(
      (req.filter?.ids ?? []).flatMap((id) => {
        const row = maps.get(mapKey(req.teamId, id));
        if (!row) return [];

        return [
          [
            id.toString(),
            {
              items: [
                {
                  d: {
                    case: "pair" as const,
                    value: { mapData: { [id.toString()]: pairOf(req.teamId, id, row) } },
                  },
                },
              ],
            },
          ],
        ];
      }),
    ),
  }),
};

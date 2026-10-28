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

import { Code, ConnectError } from "@connectrpc/connect";
import type { ServiceImpl } from "@connectrpc/connect";

import type { TeamReturnConfigurationService } from "../src/gen/warehouse/selling/v1/return_configuration_pb";
import { products } from "./fixtures";

const SEEDED_AT = 1_790_000_000n;

const seed = (): Map<bigint, { warehouseId: bigint; updatedAtUnix: bigint }> =>
  new Map([[12n, { warehouseId: 11n, updatedAtUnix: SEEDED_AT }]]);

let table = seed();

export function resetReturnConfigurationStub() {
  table = seed();
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

/** The team's standing map of a borrowed product, 0n when none — what a story asserts a pick wrote. */
export function returnMapOf(teamId: bigint, sharedProductId: bigint): bigint {
  return maps.get(mapKey(teamId, sharedProductId))?.ownProductId ?? 0n;
}

const pairOf = (teamId: bigint, sharedProductId: bigint, row: MapRow) => ({ teamId, sharedProductId, ...row });

const productNamed = (id: bigint) => products.find((p) => p.id === id);

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
        `${shared.sku} is this team's own product — only another team's product is mapped for returns`,
        Code.FailedPrecondition,
      );
    }

    const own = productNamed(req.ownProductId);
    if (!own || own.teamId !== req.teamId) {
      throw new ConnectError(
        `${own?.sku ?? `product ${req.ownProductId}`} is not one of this team's products — a return can only come back as your own`,
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

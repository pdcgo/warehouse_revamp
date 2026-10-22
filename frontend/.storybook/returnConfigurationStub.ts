// selling_service's TeamReturnConfigurationService as Storybook's stub — where a selling team's returns are
// received (the-return-warehouse-lives-in-team-return-configurations). One row per team; no row = not set.
//
// Seeded so both states can be looked at: Toko Melati (12) has Gudang Pusat (11), Toko Kenanga (13) has none.
// Any warehouse is accepted (a-team-may-pick-any-return-warehouse), as the server accepts it.
//
// WRITEABLE: a save is read back on the next detail. preview.tsx resets it in its `beforeEach`.

import type { ServiceImpl } from "@connectrpc/connect";

import type { TeamReturnConfigurationService } from "../src/gen/warehouse/selling/v1/return_configuration_pb";

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
};

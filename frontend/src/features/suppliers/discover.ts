import { type QueryClient, useQuery, useQueryClient } from "@tanstack/react-query";
import { supplierClient } from "../../api/clients";
import { key, listQuery } from "../../api/queryClient";
import type { Marketplace } from "../../gen/warehouse/marketplace/v1/marketplace_pb";
import { SupplierListScope } from "../../gen/warehouse/supplier/v1/supplier_pb";
import { teamsByIdsQuery } from "../teams/queries";
import {
  type SupplierChannelRecord,
  type SupplierRecord,
  supplierChannelsFromList,
  supplierListWithChannelsData,
  supplierRecord,
  suppliersFromList,
} from "./adapt";

// DISCOVER SUPPLIERS — every selling team's suppliers, searched across teams (discover-searches-every-teams-suppliers,
// another-team-sees-everything-of-a-supplier). The manage page lists the suppliers a team keeps; this is the
// other question — "who sells this, anywhere in the company?".
//
// Served by supplier_service: SupplierList with the EVERY_TEAM scope, and SupplierDetail, which answers for any
// team's live supplier. The owning team's NAME is not something supplier_service knows — it holds a team id —
// so it is resolved through team_service's TeamByIds, sharing the teams cache (teamsByIdsQuery).
//
// ⚠ So the search does NOT reach the team's name. `q` matches the supplier's name, address and contact and
// its live stores' names, on the server; the team is picked instead, as `owner_team_id`
// (discover-filters-by-the-team-that-keeps-it).

/** A supplier and the team that keeps it. */
export interface OwnedSupplier extends SupplierRecord {
  /** "" when the name could not be resolved — TeamItem then reads "Team #<id>". */
  teamName: string;
}

/** A discover row: the supplier, its team, and its live stores (the list's CHANNELS slice). */
export interface DiscoverSupplier extends OwnedSupplier {
  channels: SupplierChannelRecord[];
}

export interface DiscoverQuery {
  /** Matched against the supplier's name, address and contact, and its live stores' names. */
  q: string;
  /** `UNSPECIFIED` = any; otherwise suppliers with at least one live store of this type. */
  channelType: Marketplace;
  /** The team that keeps the supplier; `0n` = any team. */
  ownerTeamId: bigint;
  page: number;
  pageSize: number;
}

/**
 * Team id → name, best-effort: a name is a label, so a failed lookup leaves the rows standing with TeamItem's
 * "Team #<id>" rather than failing the whole read.
 */
async function teamNames(client: QueryClient, teamIds: bigint[]): Promise<{ [id: string]: string }> {
  if (!teamIds.some((id) => id > 0n)) {
    return {};
  }

  try {
    const teams = await client.fetchQuery(teamsByIdsQuery(teamIds));
    const out: { [id: string]: string } = {};
    for (const [id, team] of Object.entries(teams)) {
      out[id] = team.name;
    }
    return out;
  } catch {
    return {};
  }
}

/** One page of every team's suppliers, with their teams' names and their live stores. */
export async function fetchDiscoverPage(
  client: QueryClient,
  teamId: bigint,
  query: DiscoverQuery,
): Promise<{ suppliers: DiscoverSupplier[]; totalItems: number }> {
  const { q, channelType, ownerTeamId, page, pageSize } = query;

  const res = await supplierClient.supplierList({
    teamId,
    filter: { q, scope: SupplierListScope.EVERY_TEAM, channelType, ownerTeamId },
    dataRequest: supplierListWithChannelsData(),
    page: { page, limit: pageSize },
  });

  const rows = suppliersFromList(res.items, res.ids);
  const channels = supplierChannelsFromList(res.items);
  const names = await teamNames(client, rows.map((s) => s.teamId));

  const suppliers: DiscoverSupplier[] = rows.map((s) => ({
    ...s,
    teamName: names[s.teamId.toString()] ?? "",
    channels: channels.get(s.id.toString()) ?? [],
  }));

  return { suppliers, totalItems: Number(res.pageInfo?.totalItems ?? 0n) };
}

export function useDiscoverSuppliers(args: { teamId: bigint | undefined } & DiscoverQuery) {
  const { teamId, q, channelType, ownerTeamId, page, pageSize } = args;
  const client = useQueryClient();

  return useQuery({
    // A search, a filter and a page refine the same question (HARD RULE 10).
    ...listQuery,
    // ⚠ The CALLER's team stays in the key even though the answer spans every team — it is the scope the
    // request is authorised in, and two callers must never share a cached answer.
    queryKey: key.suppliers(teamId, {
      discover: true,
      q,
      channelType,
      ownerTeamId: ownerTeamId.toString(),
      page,
      pageSize,
    }),
    enabled: teamId !== undefined,
    queryFn: () => fetchDiscoverPage(client, teamId!, { q, channelType, ownerTeamId, page, pageSize }),
  });
}

// One supplier, whoever keeps it, and its team's name. Its stores are the detail's own reads — the Channels
// tab pages them on the server, and the Products tab reads the whole list (features/suppliers/queries.ts).
export function useDiscoverSupplier(args: { teamId: bigint | undefined; supplierId: bigint }) {
  const { teamId, supplierId } = args;
  const client = useQueryClient();

  return useQuery({
    queryKey: key.suppliers(teamId, { discover: supplierId.toString() }),
    enabled: teamId !== undefined && supplierId > 0n,
    queryFn: async (): Promise<OwnedSupplier | null> => {
      const res = await supplierClient.supplierDetail({ teamId: teamId!, supplierId });
      if (!res.supplier) {
        return null;
      }

      const supplier = supplierRecord(res.supplier);
      const names = await teamNames(client, [supplier.teamId]);

      return { ...supplier, teamName: names[supplier.teamId.toString()] ?? "" };
    },
  });
}

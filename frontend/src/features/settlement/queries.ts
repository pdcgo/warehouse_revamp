import { useQuery } from "@tanstack/react-query";
import { settlementClient } from "../../api/clients";
import { key } from "../../api/queryClient";

// The Liability screens' reads (#185).
//
// Reads only, and that is the design rather than a stage of it: the ledger's WRITE path is a domain
// function called in-process, because nothing outside this system may assert that one team owes
// another. Payments (#188) and terms (#189) will add writes of their own — postings will not.

export function useSettlementPositions(args: {
  teamId: bigint | undefined;
  page: number;
  pageSize: number;
  unsettledOnly: boolean;
}) {
  const { teamId, page, pageSize, unsettledOnly } = args;

  return useQuery({
    queryKey: key.settlement(teamId, { page, pageSize, unsettledOnly }),
    enabled: teamId !== undefined,
    queryFn: async () => {
      const res = await settlementClient.settlementPositionList({
        teamId: teamId!,
        page: { page, limit: pageSize },
        unsettledOnly,
      });

      return {
        positions: res.positions,
        totalItems: Number(res.pageInfo?.totalItems ?? 0n),
        awaitingConfirmation: res.awaitingConfirmation,
      };
    },
  });
}

export function useSettlementEntries(args: {
  teamId: bigint | undefined;
  counterpartyId: bigint;
  page: number;
  pageSize: number;
}) {
  const { teamId, counterpartyId, page, pageSize } = args;

  return useQuery({
    queryKey: key.settlement(teamId, {
      counterpartyId: counterpartyId.toString(),
      page,
      pageSize,
    }),
    enabled: teamId !== undefined && counterpartyId > 0n,
    queryFn: async () => {
      const res = await settlementClient.settlementEntryList({
        teamId: teamId!,
        counterpartyId,
        page: { page, limit: pageSize },
      });

      return {
        entries: res.entries,
        balance: res.balance,
        totalItems: Number(res.pageInfo?.totalItems ?? 0n),
      };
    },
  });
}

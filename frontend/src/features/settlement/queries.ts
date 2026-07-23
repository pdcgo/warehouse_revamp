import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { settlementClient, settlementPaymentClient } from "../../api/clients";
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

// The payment records for ONE relationship (#188). `awaitingMyConfirmation` is a SERVER-SIDE filter —
// a paginated list narrowed on the client would report the unfiltered total beside the wrong rows
// (see SettlementPaymentListRequest). The "my payments / team payments" split the screen draws is a
// different cut (payer side), done client-side over the loaded page.
export function useSettlementPayments(args: {
  teamId: bigint | undefined;
  counterpartyId: bigint;
  awaitingMyConfirmation: boolean;
  page: number;
  pageSize: number;
}) {
  const { teamId, counterpartyId, awaitingMyConfirmation, page, pageSize } = args;

  return useQuery({
    queryKey: key.settlement(teamId, {
      payments: true,
      counterpartyId: counterpartyId.toString(),
      awaitingMyConfirmation,
      page,
      pageSize,
    }),
    enabled: teamId !== undefined && counterpartyId > 0n,
    queryFn: async () => {
      const res = await settlementPaymentClient.settlementPaymentList({
        teamId: teamId!,
        counterpartyId,
        awaitingMyConfirmation,
        page: { page, limit: pageSize },
      });

      return {
        payments: res.payments,
        totalItems: Number(res.pageInfo?.totalItems ?? 0n),
      };
    },
  });
}

// Record a payment YOU are sending — you are the payer, the counterparty is the creditor. NO ledger
// effect until they confirm it arrived (two-phase, #188). Every settlement read is invalidated on
// success so the new pending row appears without a manual refetch.
export function useRecordPayment() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (args: {
      teamId: bigint;
      creditorTeamId: bigint;
      amount: bigint;
      note: string;
    }) =>
      settlementPaymentClient.settlementPaymentRecord({
        teamId: args.teamId,
        creditorTeamId: args.creditorTeamId,
        amount: args.amount,
        note: args.note,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["settlement"] });
    },
  });
}

// Confirm a payment the counterparty recorded — only the creditor (you) may, because only the
// creditor sees the money arrive. THIS is what posts the settling entry to the ledger, so it
// invalidates the entry reads as well as the payment reads.
export function useConfirmPayment() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (args: { teamId: bigint; paymentId: bigint }) =>
      settlementPaymentClient.settlementPaymentConfirm({
        teamId: args.teamId,
        paymentId: args.paymentId,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["settlement"] });
    },
  });
}

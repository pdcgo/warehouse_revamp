import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { liabilityClient, liabilityPaymentClient, liabilityTermsClient } from "../../api/clients";
import { key, listQuery } from "../../api/queryClient";
import {
  logsFromList,
  logRowData,
  paymentsFromList,
  paymentRowData,
  positionRowData,
  positionsFromList,
  termsChangeRowData,
  termsChangesFromList,
  termsFromList,
  termsRowData,
} from "./adapt";

// The Liability screens' reads (#185).
//
// Reads only, and that is the design rather than a stage of it: the ledger's WRITE path is a domain
// function called in-process, because nothing outside this system may assert that one team owes
// another. Payments (#188) and terms (#189) will add writes of their own — postings will not.

export function useLiabilityPositions(args: {
  teamId: bigint | undefined;
  page: number;
  pageSize: number;
  unsettledOnly: boolean;
}) {
  const { teamId, page, pageSize, unsettledOnly } = args;

  return useQuery({
    queryKey: key.liability(teamId, { page, pageSize, unsettledOnly }),
    enabled: teamId !== undefined,
    queryFn: async () => {
      const res = await liabilityClient.liabilityPositionList({
        teamId: teamId!,
        filter: { unsettledOnly },
        dataRequest: positionRowData(),
        page: { page, limit: pageSize },
      });

      return {
        positions: positionsFromList(res.items, res.ids),
        totalItems: Number(res.pageInfo?.totalItems ?? 0n),
        awaitingConfirmation: res.awaitingConfirmation,
      };
    },
  });
}

export function useLiabilityLogs(args: {
  teamId: bigint | undefined;
  counterpartyId: bigint;
  page: number;
  pageSize: number;
}) {
  const { teamId, counterpartyId, page, pageSize } = args;

  return useQuery({
    queryKey: key.liability(teamId, {
      counterpartyId: counterpartyId.toString(),
      page,
      pageSize,
    }),
    enabled: teamId !== undefined && counterpartyId > 0n,
    queryFn: async () => {
      const res = await liabilityClient.liabilityLogList({
        teamId: teamId!,
        filter: { counterpartyId },
        dataRequest: logRowData(),
        page: { page, limit: pageSize },
      });

      return {
        entries: logsFromList(res.items, res.ids),
        balance: res.balance,
        totalItems: Number(res.pageInfo?.totalItems ?? 0n),
      };
    },
  });
}

// The payment records for ONE relationship (#188). `awaitingMyConfirmation` is a SERVER-SIDE filter —
// a paginated list narrowed on the client would report the unfiltered total beside the wrong rows
// (see LiabilityPaymentListRequest). The "my payments / team payments" split the screen draws is a
// different cut (payer side), done client-side over the loaded page.
export function useLiabilityPayments(args: {
  teamId: bigint | undefined;
  counterpartyId: bigint;
  awaitingMyConfirmation: boolean;
  page: number;
  pageSize: number;
}) {
  const { teamId, counterpartyId, awaitingMyConfirmation, page, pageSize } = args;

  return useQuery({
    queryKey: key.liability(teamId, {
      payments: true,
      counterpartyId: counterpartyId.toString(),
      awaitingMyConfirmation,
      page,
      pageSize,
    }),
    enabled: teamId !== undefined && counterpartyId > 0n,
    queryFn: async () => {
      const res = await liabilityPaymentClient.liabilityPaymentList({
        teamId: teamId!,
        filter: { counterpartyId, awaitingMyConfirmation },
        dataRequest: paymentRowData(),
        page: { page, limit: pageSize },
      });

      return {
        payments: paymentsFromList(res.items, res.ids),
        totalItems: Number(res.pageInfo?.totalItems ?? 0n),
      };
    },
  });
}

// Record a payment YOU are sending — you are the payer, the counterparty is the creditor. NO ledger
// effect until they confirm it arrived (two-phase, #188). Every liability read is invalidated on
// success so the new pending row appears without a manual refetch.
export function useRecordPayment() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (args: {
      teamId: bigint;
      creditorTeamId: bigint;
      amount: bigint;
      note: string;
      // ⚠ AT LEAST ONE, and the server refuses without (a-payment-must-carry-proof). Each must
      // already be SHARED with the creditor — see useProofUpload, which does both.
      documentIds: string[];
    }) =>
      liabilityPaymentClient.liabilityPaymentRecord({
        teamId: args.teamId,
        creditorTeamId: args.creditorTeamId,
        amount: args.amount,
        note: args.note,
        documentIds: args.documentIds,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["liability"] });
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
      liabilityPaymentClient.liabilityPaymentConfirm({
        teamId: args.teamId,
        paymentId: args.paymentId,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["liability"] });
    },
  });
}

// Reject a payment the counterparty recorded — the `no` arm of `balance_context.md` §Payment Flow.
//
// ⚠ IT POSTS NOTHING, which is why it is a separate mutation from `useConfirmPayment` rather than a
// flag on it. Rejecting refuses a CLAIM that never reached the ledger; reversing undoes a
// CONFIRMATION that did. Sharing one hook would invite sharing one code path, and the two failures
// must not.
//
// It still invalidates every liability read: the row's status changes, and so does the creditor's
// awaiting-confirmation count and the nav badge that shows it.
export function useRejectPayment() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (args: { teamId: bigint; paymentId: bigint; reason: string }) =>
      liabilityPaymentClient.liabilityPaymentReject({
        teamId: args.teamId,
        paymentId: args.paymentId,
        reason: args.reason,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["liability"] });
    },
  });
}

// ─── terms (#189) ───────────────────────────────────────────────────────────────────────────────

// Every row of terms this team has SET — one per debtor, plus the DEFAULT row at counterparty 0.
//
// `listQuery` because a page turn refines the same question. ⚠ The list is a creditor's own
// configuration, so it is small in practice and paginated anyway (HARD RULE 9) — "returns a list" is
// the bar, not "is currently large".
export function useLiabilityTerms(args: {
  teamId: bigint | undefined;
  page: number;
  pageSize: number;
}) {
  const { teamId, page, pageSize } = args;

  return useQuery({
    ...listQuery,
    queryKey: key.liability(teamId, { terms: true, page, pageSize }),
    enabled: teamId !== undefined,
    queryFn: async () => {
      const res = await liabilityTermsClient.liabilityTermsList({
        teamId: teamId!,
        dataRequest: termsRowData(),
        page: { page, limit: pageSize },
      });

      return {
        terms: termsFromList(res.items, res.ids),
        totalItems: Number(res.pageInfo?.totalItems ?? 0n),
      };
    },
  });
}

// The change log for ONE pair, or for every pair when `counterpartyId` is undefined.
//
// ⚠ `counterpartyId` is `bigint | undefined`, NOT `0n` for "all" — 0 is the default row, a real
// counterparty here. Sending 0 asks for the default row's history and nothing else.
export function useTermsHistory(args: {
  teamId: bigint | undefined;
  counterpartyId: bigint | undefined;
  page: number;
  pageSize: number;
}) {
  const { teamId, counterpartyId, page, pageSize } = args;

  return useQuery({
    ...listQuery,
    queryKey: key.liability(teamId, {
      termsHistory: true,
      counterpartyId: counterpartyId === undefined ? "all" : counterpartyId.toString(),
      page,
      pageSize,
    }),
    enabled: teamId !== undefined,
    queryFn: async () => {
      const res = await liabilityTermsClient.liabilityTermsHistoryList({
        teamId: teamId!,
        filter: { counterpartyId },
        dataRequest: termsChangeRowData(),
        page: { page, limit: pageSize },
      });

      return {
        changes: termsChangesFromList(res.items, res.ids),
        totalItems: Number(res.pageInfo?.totalItems ?? 0n),
      };
    },
  });
}

// Set one pair's terms — a CREATE-OR-UPDATE on (team, counterparty).
//
// ⚠ `creditLimit: undefined` means UNLIMITED and `0n` means NO CREDIT AT ALL. They are opposites, so
// the caller must pass `undefined` deliberately rather than letting a blank input coerce to zero —
// that coercion is the bug the whole optional field exists to prevent.
export function useSetTerms() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (args: {
      teamId: bigint;
      counterpartyId: bigint;
      handlingFee: bigint;
      productMarkupBp: bigint;
      creditLimit: bigint | undefined;
      reason: string;
    }) =>
      liabilityTermsClient.liabilityTermsSet({
        teamId: args.teamId,
        counterpartyId: args.counterpartyId,
        handlingFee: args.handlingFee,
        productMarkupBp: args.productMarkupBp,
        creditLimit: args.creditLimit,
        reason: args.reason,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["liability"] });
    },
  });
}

// Delete one pair's terms, dropping that debtor back to the default row — or, with no default, to
// charging nothing and allowing anything.
//
// ⚠ THIS IS HOW "UNLIMITED" IS EXPRESSED once a limit exists, which makes it the most consequential
// write in this service rather than a tidy-up. It RAISES the ceiling, so the screen confirms it.
export function useDeleteTerms() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (args: { teamId: bigint; counterpartyId: bigint; reason: string }) =>
      liabilityTermsClient.liabilityTermsDelete({
        teamId: args.teamId,
        counterpartyId: args.counterpartyId,
        reason: args.reason,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["liability"] });
    },
  });
}

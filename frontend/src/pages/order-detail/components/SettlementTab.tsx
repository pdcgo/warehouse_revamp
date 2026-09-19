import { useCallback } from "react";
import { Alert, Spinner, Stack, Text } from "@chakra-ui/react";

import { Role } from "../../../gen/warehouse/role_base/v1/role_pb";
import { useTeam } from "../../../features/team/TeamContext";
import { useOrderSettlement, usePostSettlementEntry } from "../../../features/settlement/queries";
import { OrderLedgerPanel } from "../../order-settlement/components/OrderLedgerPanel";
import type { EntryDraft } from "../../order-settlement/components/AddEntryDialog";
import type { PostingRole, SettlementEntry } from "../../order-settlement/model";

// THE SETTLEMENT LEDGER IN ITS REAL SEAT — a third tab on the order detail page.
//
// `order-detail-manages-the-ledger` put it here rather than on a screen of its own: the ledger is a
// property OF an order, and the person adding a row is looking at that order. The `/settlement` list
// answers a different question — *which orders lost the most* — and links back here.
//
// ⚠ This is where the fields settlement cannot know are filled in. The service never learns the
// marketplace reference or the order's cogs (HARD RULE 3), so both are handed down from the order
// this tab is mounted on — which already holds them.

/** The write set, mapped to the prototype's role union. */
function postingRoleOf(role: Role | undefined): PostingRole | undefined {
  switch (role) {
    case Role.ROOT:
      return "root";
    case Role.ADMIN:
      return "admin";
    case Role.TEAM_OWNER:
      return "team_owner";
    case Role.TEAM_ADMIN:
      return "team_admin";
    case Role.TEAM_CUSTOMER_SERVICE:
      return "customer_service";
    default:
      // Everybody else reads and never writes. Returning undefined means the panel renders without
      // a form at all, rather than with a disabled one nobody can explain.
      return undefined;
  }
}

export interface SettlementTabProps {
  orderId: bigint;
  shopId: bigint;
  /**
   * What settlement cannot know, from the order this tab sits on.
   *
   * ⚠ Only these TWO, not the four the list screen needs: the panel shows a running ledger, and the
   * shop and team names appear nowhere on it. Passing them would be props nothing reads.
   */
  orderRef: string;
  cogs: bigint;
}

export function SettlementTab({
  orderId,
  shopId,
  orderRef,
  cogs,
}: SettlementTabProps) {
  const { current } = useTeam();
  const teamId = current?.teamId;
  const role = postingRoleOf(current?.role);

  const query = useOrderSettlement({
    teamId,
    orderId,
    known: { orderRef, cogs },
  });

  const post = usePostSettlementEntry(teamId);

  const addEntry = useCallback(
    (draft: EntryDraft) => {
      post.mutate({
        orderId,
        shopId,
        settlementType: draft.settlementType,
        sourceType: "manual",
        change: draft.change,
        occurredOn: draft.occurredOn,
        // ⚠ THE KEY IS THE CALLER'S, and settlement invents nothing. A person's row is keyed by the
        // moment they submitted, so a double-submit of one form is absorbed while two genuinely
        // separate entries of the same amount stay two rows.
        uniqueId: `manual-${Date.now()}`,
        note: draft.note,
      });
    },
    [post, orderId, shopId],
  );

  const reverse = useCallback(
    (entry: SettlementEntry) => {
      post.mutate({
        orderId,
        shopId,
        settlementType: entry.settlementType,
        sourceType: "manual",
        // A CORRECTION IS A NEW ROW: the exact opposite amount, pointing back at what it undoes.
        change: -entry.change,
        occurredOn: entry.occurredOn,
        uniqueId: `reverse-${entry.id}`,
        reversesId: BigInt(entry.id),
        note: `reverses #${entry.id}`,
      });
    },
    [post, orderId, shopId],
  );

  if (query.isPending) {
    return <Spinner data-testid="settlement-loading" />;
  }

  // ⚠ NEVER SETTLED IS NOT SETTLED TO ZERO. The service returns NotFound rather than a zeroed row,
  // and this says so plainly — a 0/0 panel would read as a completed settlement nobody performed.
  if (!query.data) {
    return (
      <Alert.Root status="info" data-testid="settlement-absent">
        <Alert.Indicator />
        <Alert.Content>
          <Alert.Title>Not settled yet</Alert.Title>
          <Alert.Description>
            No settlement has been recorded for this order. The account opens when the marketplace
            total is posted.
          </Alert.Description>
        </Alert.Content>
      </Alert.Root>
    );
  }

  return (
    <Stack gap="section">
      {post.isError ? (
        <Alert.Root status="error" data-testid="settlement-post-error">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Title>That entry was not recorded</Alert.Title>
            <Alert.Description>
              <Text>{String(post.error)}</Text>
            </Alert.Description>
          </Alert.Content>
        </Alert.Root>
      ) : null}

      <OrderLedgerPanel
        settlement={query.data}
        canPost={role !== undefined}
        role={role}
        onAddEntry={addEntry}
        onReverse={reverse}
      />
    </Stack>
  );
}

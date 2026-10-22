import { Badge, HStack, Span, Stack, Text } from "@chakra-ui/react";
import { useTranslation } from "react-i18next";

import {
  type OpnameDraft,
  OpnameDraftType,
  OpnamePlan,
  type OpnameRow,
  OpnameRowStatus,
  OpnameSessionStatus,
} from "../../gen/warehouse/inventory/v1/opname_pb";

// THE stock count's vocabulary, drawn the same way on every opname screen: the session list, the admin's watch page,
// the counting screen on a phone, and the finalize review (docs/business/inventory/opname.md).

export const description =
  "The stock count's vocabulary — a session's status (active blue, finished green, cancelled gray), its plan, a row's state (not counted gray, revealed orange, counted green), a difference as a signed figure (short in red, over in blue, 0 muted), and a row's drafts with their reasons. One file so every opname screen says it the same way.";

const SESSION_STATUS: Record<OpnameSessionStatus, { key: string; color: string }> = {
  [OpnameSessionStatus.UNSPECIFIED]: { key: "opnameSession.status.unspecified", color: "gray" },
  [OpnameSessionStatus.ACTIVE]: { key: "opnameSession.status.active", color: "blue" },
  [OpnameSessionStatus.FINISH]: { key: "opnameSession.status.finish", color: "green" },
  [OpnameSessionStatus.CANCEL]: { key: "opnameSession.status.cancel", color: "gray" },
};

/** A session's status — a lifecycle step, so its colour is categorical. */
export function OpnameSessionStatusBadge({ status }: { status: OpnameSessionStatus }) {
  const { t } = useTranslation();
  const meta = SESSION_STATUS[status];

  return (
    <Badge colorPalette={meta.color} data-testid={`opname-session-status-${status}`}>
      {t(meta.key)}
    </Badge>
  );
}

export const PLAN_KEY: Record<OpnamePlan, string> = {
  [OpnamePlan.UNSPECIFIED]: "opnameSession.plan.unspecified",
  [OpnamePlan.ALL]: "opnameSession.plan.all",
  [OpnamePlan.TEAM]: "opnameSession.plan.team",
  [OpnamePlan.PRODUCT]: "opnameSession.plan.product",
  [OpnamePlan.PLACEMENT]: "opnameSession.plan.placement",
};

/** A session's plan — the kind only; its target was a filter at create (the-plan-target-is-only-a-filter). */
export function OpnamePlanBadge({ plan }: { plan: OpnamePlan }) {
  const { t } = useTranslation();

  return (
    <Badge variant="outline" colorPalette="gray" data-testid={`opname-plan-${plan}`}>
      {t(PLAN_KEY[plan])}
    </Badge>
  );
}

/** A row's state: not counted, revealed (counted, the reasons still to type), or counted. */
export function OpnameRowStateBadge({ row }: { row: Pick<OpnameRow, "status" | "revealed"> }) {
  const { t } = useTranslation();
  const counted = row.status === OpnameRowStatus.COUNTED;
  const meta = counted
    ? { key: "opnameSession.rowState.counted", color: "green", id: "counted" }
    : row.revealed
      ? { key: "opnameSession.rowState.revealed", color: "orange", id: "revealed" }
      : { key: "opnameSession.rowState.created", color: "gray", id: "created" };

  return (
    <Badge colorPalette={meta.color} data-testid={`opname-row-state-${meta.id}`}>
      {t(meta.key)}
    </Badge>
  );
}

/** count − book as a signed figure: −2 short (it costs), +1 over, 0 a match. */
export function OpnameDifference({ value, testId }: { value: bigint; testId?: string }) {
  const color = value < 0n ? "error.fg" : value > 0n ? "info.fg" : "fg.muted";
  const text = value < 0n ? `−${(-value).toString()}` : value > 0n ? `+${value.toString()}` : "0";

  return (
    <Span color={color} fontWeight={value === 0n ? "normal" : "bold"} fontVariantNumeric="tabular-nums" data-testid={testId}>
      {text}
    </Span>
  );
}

const DRAFT: Record<OpnameDraftType, { key: string; color: string }> = {
  [OpnameDraftType.UNSPECIFIED]: { key: "opnameSession.draft.unspecified", color: "gray" },
  [OpnameDraftType.BROKEN]: { key: "opnameSession.draft.broken", color: "warning" },
  [OpnameDraftType.LOST]: { key: "opnameSession.draft.lost", color: "error" },
  [OpnameDraftType.SURPLUS]: { key: "opnameSession.draft.surplus", color: "info" },
};

export function OpnameDraftBadge({ type }: { type: OpnameDraftType }) {
  const { t } = useTranslation();

  return (
    <Badge colorPalette={DRAFT[type].color} data-testid={`opname-draft-${type}`}>
      {t(DRAFT[type].key)}
    </Badge>
  );
}

/**
 * A row's drafts, each with its count and its reason — what the second person reads before finalizing
 * (a-difference-needs-its-reason-on-the-draft). A draft with no reason yet says so.
 */
export function OpnameDrafts({ drafts, testId }: { drafts: OpnameDraft[]; testId?: string }) {
  const { t } = useTranslation();

  if (drafts.length === 0) return null;

  return (
    <Stack gap="1" data-testid={testId}>
      {drafts.map((d) => (
        <HStack key={d.type} gap="2" align="baseline" wrap="wrap">
          <OpnameDraftBadge type={d.type} />
          <Span fontWeight="bold" fontVariantNumeric="tabular-nums">
            {d.stockCount.toString()}
          </Span>
          {d.note ? (
            <Text as="span" fontSize="sm" color="fg.muted" fontStyle="italic">
              “{d.note}”
            </Text>
          ) : (
            <Text as="span" fontSize="sm" color="warning.fg">
              {t("opnameSession.draft.noReason")}
            </Text>
          )}
        </HStack>
      ))}
    </Stack>
  );
}

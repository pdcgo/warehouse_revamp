import { Badge, HStack, Icon, Stack, Text } from "@chakra-ui/react";
import { CircleCheck, TriangleAlert, X } from "lucide-react";
import { PriceText } from "../text/PriceText";
import type { Tone } from "../tone";
import { ProgressBar } from "../feedback/ProgressBar";

// The two thresholds at which a credit limit stops being background information.
//
// They are here as named constants rather than inline numbers because they are a POLICY, not a
// styling choice: 80% is "start collecting", 100% is "stop shipping". If the business changes when
// it starts chasing, this is the line that changes.
const WARNING_AT = 80;
const DANGER_AT = 100;

export type LimitStatus = "ok" | "warning" | "danger";

export function limitStatus(percent: number): LimitStatus {
  if (percent >= DANGER_AT) return "danger";
  if (percent >= WARNING_AT) return "warning";
  return "ok";
}

const STATUS_TONE: Record<LimitStatus, Tone> = {
  ok: "success",
  warning: "warning",
  danger: "error",
};

const STATUS_ICON = {
  ok: CircleCheck,
  warning: TriangleAlert,
  danger: TriangleAlert,
};

// LimitProgress shows how much of a credit limit has been consumed, and whether that is a problem.
//
// The component owns the JUDGEMENT, not just the geometry. A bar at 84% is meaningless on its own —
// what the reader needs is "this account is close to its ceiling", and if every screen decides its
// own thresholds then the same account reads as fine in one place and urgent in another. So the
// thresholds live here, once.
//
// ⚠ A ZERO THRESHOLD IS NOT A FULL BAR — it means the account has NO LIMIT SET, and dividing by it
// would give Infinity or NaN. That is a genuinely different state ("no limit configured"), so it
// renders as its own quiet chip rather than as a bar at any percentage. Showing it as 100% would
// read as an account that had maxed out, which is close to the opposite of the truth.
export const description =
  "How much of a credit limit is used, and whether that is a problem — the warning/danger thresholds live here once, so an account reads the same on every screen. A zero limit renders as 'not set', never as a full bar.";

export interface LimitProgressProps {
  // How much is currently outstanding.
  unpaid: bigint;
  // The ceiling. Zero means no limit is configured — see above.
  threshold: bigint;
  showIcon?: boolean;
  // Show the numbers above the bar. Off in a dense table cell, on in a detail panel.
  showValue?: boolean;
}

export function LimitProgress({ unpaid, threshold, showIcon, showValue }: LimitProgressProps) {
  if (threshold <= 0n) {
    return (
      <Badge colorPalette="gray" variant="subtle" data-testid="limit-progress-inactive">
        <Icon as={X} boxSize="3" />
        No limit set
      </Badge>
    );
  }

  // Computed in floating point deliberately: these are bigint rupiah, and the ratio is a display
  // value, not money. Number() is safe here because the division brings it into a tiny range.
  const percent = (Number(unpaid) / Number(threshold)) * 100;
  const status = limitStatus(percent);

  return (
    <Stack gap="1" data-testid="limit-progress" data-status={status}>
      {showValue && (
        <HStack justify="space-between" fontSize="xs" color="fg.muted">
          <HStack gap="1">
            <PriceText amount={unpaid} minCompact={999n} />
            <Text>/</Text>
            <PriceText amount={threshold} />
          </HStack>
          <Text fontVariantNumeric="tabular-nums">{percent.toFixed(1)}%</Text>
        </HStack>
      )}

      <HStack gap="1.5">
        {showIcon && (
          <Icon
            as={STATUS_ICON[status]}
            boxSize="3.5"
            colorPalette={STATUS_TONE[status] === "success" ? "green" : STATUS_TONE[status] === "warning" ? "orange" : "red"}
            color="colorPalette.solid"
          />
        )}
        {/* The bar clamps at 100 — an over-limit account is real, and the percentage beside it is
            what carries the overage. */}
        <ProgressBar percent={percent} tone={STATUS_TONE[status]} flex="1" />
      </HStack>
    </Stack>
  );
}

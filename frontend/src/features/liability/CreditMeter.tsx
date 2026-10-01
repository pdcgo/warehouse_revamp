import { Badge, Progress, Stack, Text } from "@chakra-ui/react";
import { useTranslation } from "react-i18next";

import { formatRupiah } from "../../lib/money";

// The threshold at which the screen warns, from
// docs/business/balance/context_decision.md#the-threshold-warns-at-eighty-percent.
//
// It exists because the BLOCK used to be the notification: with no settlement cycle and no way to
// chase, the first person to learn a team was over its limit was customer service, mid-order, with a
// customer waiting. 80% is the point at which somebody can still do something about it.
export const WARN_AT = 0.8;

// How a limit reads. THREE states, never two — and the whole component exists to keep them apart.
//
//   absent  → UNLIMITED       this creditor has not capped this debtor
//   0       → NO CREDIT       frozen entirely: the next order is refused whatever the balance
//   n       → a real ceiling
//
// ⚠ `absent` and `0` are OPPOSITES. Rendering a missing limit as "0" would show a team with infinite
// credit as one that has been frozen, and the reverse is worse: the day somebody genuinely wants to
// freeze a team, a UI that writes 0 for "no limit" grants them unlimited credit instead. That is why
// `limit` here is `bigint | undefined` rather than a number with a sentinel.
export type LimitState = "unlimited" | "frozen" | "capped";

export function limitStateOf(limit: bigint | undefined): LimitState {
  if (limit === undefined) return "unlimited";
  if (limit === 0n) return "frozen";
  return "capped";
}

interface CreditMeterProps {
  /** undefined = unlimited, 0n = frozen, n = the ceiling. */
  limit: bigint | undefined;
  /** What this debtor owes the creditor right now. Never negative here — the caller flips the sign. */
  debt: bigint;
  testId?: string;
}

// CreditMeter shows how much of a debtor's credit is used, and warns at 80%.
//
// ⚠ THE BAR IS ONLY DRAWN FOR A REAL CEILING. A percentage of unlimited is not a number, and a
// percentage of zero is a division by zero — so those two states are words, not a meter. A bar that
// renders "100%" for a frozen team and "0%" for an unlimited one would invert the meaning of the
// screen at a glance.
export function CreditMeter({ limit, debt, testId }: CreditMeterProps) {
  const { t } = useTranslation();
  const state = limitStateOf(limit);

  if (state === "unlimited") {
    return (
      <Text color="fg.subtle" data-testid={testId}>
        {t("terms.limitUnlimited")}
      </Text>
    );
  }

  if (state === "frozen") {
    return (
      <Badge colorPalette="red" data-testid={testId}>
        {t("terms.limitFrozen")}
      </Badge>
    );
  }

  const cap = limit!;
  const owed = debt > 0n ? debt : 0n;

  // Integer maths up to the ratio: these are rupiah in bigint, and Number() on a balance large
  // enough to matter is exactly where a money bug hides. Only the RATIO becomes a float, and only
  // for the width of a bar.
  const pct = Number((owed * 10000n) / cap) / 100;
  const warning = owed * 10000n >= cap * BigInt(Math.round(WARN_AT * 10000));
  const over = owed >= cap;

  return (
    <Stack gap="1" minW="36" data-testid={testId}>
      <Progress.Root
        value={Math.min(pct, 100)}
        size="xs"
        colorPalette={over ? "red" : warning ? "orange" : "brand"}
      >
        <Progress.Track>
          <Progress.Range />
        </Progress.Track>
      </Progress.Root>

      <Text fontSize="xs" color={over ? "red.fg" : warning ? "orange.fg" : "fg.subtle"}>
        {t("terms.usedOf", { used: formatRupiah(owed), limit: formatRupiah(cap) })}
        {" · "}
        <Text as="span" fontWeight={warning ? "medium" : undefined} data-testid={testId ? `${testId}-pct` : undefined}>
          {pct.toFixed(0)}%
        </Text>
      </Text>

      {/* The warning is a BADGE and not only a colour: a colour ramp alone is invisible to anyone
          reading this in a hurry, and this is the one signal the design has left. */}
      {warning && (
        <Badge
          colorPalette={over ? "red" : "orange"}
          size="sm"
          data-testid={testId ? `${testId}-warn` : undefined}
        >
          {over ? t("terms.warnOver") : t("terms.warnNear")}
        </Badge>
      )}
    </Stack>
  );
}

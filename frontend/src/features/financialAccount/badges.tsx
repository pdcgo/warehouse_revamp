import { useTranslation } from "react-i18next";
import { Badge, HStack, Icon, Text } from "@chakra-ui/react";
import { TriangleAlert } from "lucide-react";

import {
  type FinancialAccountChangeType,
  FinancialAccountProvider as P,
} from "../../gen/warehouse/financial_account/v1/financial_account_pb";
import { formatRupiahNumber } from "../../lib/money";
import { CHANGE_TYPE_KEY, CHANGE_TYPE_PALETTE, PROVIDER_KEY } from "./vocab";

// The domain's three ways of SHOWING a fact — used by the accounts list, an account's page and the
// report, so a provider, a change type and a balance read identically on all three.

const PROVIDER_PALETTE: Record<number, string> = {
  [P.BCA]: "blue",
  [P.BNI]: "teal",
  [P.JAGO]: "yellow",
  [P.SHOPEEPAY]: "orange",
  [P.CASH]: "green",
  [P.UNKNOWN]: "gray",
};

export function ProviderBadge({ provider }: { provider: P }) {
  const { t } = useTranslation();

  return (
    <Badge colorPalette={PROVIDER_PALETTE[provider] ?? "gray"} variant="subtle">
      {t(PROVIDER_KEY[provider] ?? PROVIDER_KEY[P.UNKNOWN]!)}
    </Badge>
  );
}

export function ChangeTypeBadge({ changeType }: { changeType: FinancialAccountChangeType }) {
  const { t } = useTranslation();

  return (
    <Badge colorPalette={CHANGE_TYPE_PALETTE[changeType] ?? "gray"} variant="subtle">
      {t(CHANGE_TYPE_KEY[changeType] ?? "")}
    </Badge>
  );
}

/**
 * A balance — and, BELOW ZERO, a warning beside it (below-zero-is-warned-never-refused).
 *
 * The books may go below zero: a restock paid from ShopeePay before the top-up was recorded is real,
 * and refusing it would lose it. So the screen never blocks; it says so wherever the number is shown.
 */
export function BalanceText({
  balance,
  size = "sm",
  testId,
}: {
  balance: number | undefined;
  size?: "sm" | "md" | "lg" | "2xl";
  testId?: string;
}) {
  const { t } = useTranslation();

  if (balance === undefined) {
    return (
      <Text fontSize={size} color="fg.muted" data-testid={testId}>
        —
      </Text>
    );
  }

  const below = balance < 0;

  return (
    <HStack gap="1" justify="inherit" data-testid={testId} data-below-zero={below || undefined}>
      {below && (
        <Icon
          as={TriangleAlert}
          boxSize="4"
          color="fg.error"
          aria-label={t("financialAccounts.belowZero")}
          data-testid={testId ? `${testId}-below-zero` : undefined}
        />
      )}
      <Text fontSize={size} fontWeight={size === "sm" ? undefined : "semibold"} color={below ? "fg.error" : undefined}>
        {formatRupiahNumber(balance)}
      </Text>
    </HStack>
  );
}

/** A row's signed change — green in, red out, with its sign spelled out. */
export function ChangeText({ change }: { change: number }) {
  const sign = change > 0 ? "+" : change < 0 ? "−" : "";

  return (
    <Text fontSize="sm" color={change > 0 ? "fg.success" : change < 0 ? "fg.error" : "fg.muted"}>
      {sign}
      {formatRupiahNumber(Math.abs(change))}
    </Text>
  );
}

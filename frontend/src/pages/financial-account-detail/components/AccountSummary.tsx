import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { HStack, Icon, Span, Stack, Text } from "@chakra-ui/react";
import { TriangleAlert } from "lucide-react";

import { SummaryCard, SummaryStrip } from "../../../features/orders/SummaryCard";
import { formatUnixDate, formatUnixRelative } from "../../../lib/datetime";
import { formatRupiahNumber } from "../../../lib/money";

// THE ACCOUNT'S FIGURES, AS THE ORDER LIST'S CARDS (owner, `the-account-page-follows-the-screen-rules`, per
// `a-list-summary-is-the-order-lists-card-strip`) — the balance LEADING in pale blue, as Total saldo leads the accounts
// page, and when it was last checked beside it. They were a bordered box drawn by hand.
//
// ⚠ THE FIGURE IS A SPAN, not `BalanceText`: a card's value is a paragraph, and BalanceText is a flex row of paragraphs.
// Below zero it keeps BalanceText's ⚠ and red, and the explanation goes under the strip — a card's lines are one line
// each, too short for a sentence (below-zero-is-warned-never-refused).
export function AccountSummary({
  balance,
  reconciledAt,
  unknown,
  beside,
}: {
  balance: number | undefined;
  reconciledAt: { seconds: bigint } | undefined;
  /** No statement to read, so nothing is ever checked. */
  unknown: boolean;
  /** A panel in the same row — Toko terhubung (`linked-shops-sit-beside-the-cards`). It places itself on the grid. */
  beside?: ReactNode;
}) {
  const { t } = useTranslation();
  const below = balance !== undefined && balance < 0;

  return (
    <Stack gap="2">
      <SummaryStrip testId="account-detail-summary">
        <SummaryCard
          label={t("financialAccounts.col.balance")}
          value={
            <Span color={below ? "fg.error" : undefined} data-testid="account-detail-balance" data-below-zero={below || undefined}>
              {below && (
                <Icon
                  as={TriangleAlert}
                  boxSize="4"
                  me="1"
                  verticalAlign="-0.125em"
                  aria-label={t("financialAccounts.belowZero")}
                  data-testid="account-detail-balance-below-zero"
                />
              )}
              {balance === undefined ? "—" : formatRupiahNumber(balance)}
            </Span>
          }
          emphasis
          testId="account-detail-balance-card"
        />
        <SummaryCard
          label={t("financialAccounts.col.lastChecked")}
          value={
            <Span data-testid="account-detail-checked">
              {unknown
                ? t("financialAccounts.noStatement")
                : reconciledAt
                  ? formatUnixRelative(reconciledAt.seconds)
                  : t("financialAccounts.neverChecked")}
            </Span>
          }
          line={!unknown && reconciledAt ? formatUnixDate(reconciledAt.seconds) : undefined}
          muted={unknown || !reconciledAt}
          testId="account-detail-checked-card"
        />
        {beside}
      </SummaryStrip>

      {below && (
        <HStack gap="1.5" align="start" color="fg.error" data-testid="account-detail-below-zero">
          <Icon as={TriangleAlert} boxSize="4" mt="0.5" flexShrink="0" />
          <Text fontSize="sm">{t("financialAccounts.belowZeroExplained")}</Text>
        </HStack>
      )}
    </Stack>
  );
}

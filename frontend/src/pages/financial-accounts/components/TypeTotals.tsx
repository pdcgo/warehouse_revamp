import { useTranslation } from "react-i18next";
import { Box, Flex, Text } from "@chakra-ui/react";

import { BalanceText } from "../../../features/financialAccount/badges";
import type { TypeTotal } from "../../../features/financialAccount/adapt";
import { TYPE_TOTAL_KEY } from "../../../features/financialAccount/vocab";

// What the team holds, by type — bank, wallet, cash, and the money sitting in unknown accounts — and the
// whole of it. Active accounts only; an archived one holds zero by rule.
//
// Asked of the server (FinancialAccountOverview TYPE_TOTAL), never summed from the rows below: the list
// is paginated, and a total that summed the visible page would change as somebody turned it.
export function TypeTotals({ totals }: { totals: TypeTotal[] | undefined }) {
  const { t } = useTranslation();

  const all = totals ?? [];
  const team = all.reduce((sum, x) => sum + x.balance, 0);
  const accounts = all.reduce((sum, x) => sum + x.accountCount, 0);

  return (
    <Flex gap="card" wrap="wrap" borderWidth="1px" borderRadius="md" p="card" data-testid="account-totals">
      {all.map((x) => (
        <Box key={x.type} minW="10rem" flex="1" data-testid={`account-total-${x.type}`}>
          <Text fontSize="xs" color="fg.muted">
            {t(TYPE_TOTAL_KEY[x.type] ?? "")}
          </Text>
          <BalanceText balance={x.balance} size="lg" testId={`account-total-${x.type}-value`} />
          <Text fontSize="xs" color="fg.muted">
            {t("financialAccounts.totals.accounts", { count: x.accountCount })}
            {x.belowZeroCount > 0 && ` · ${t("financialAccounts.totals.belowZero", { count: x.belowZeroCount })}`}
          </Text>
        </Box>
      ))}

      <Box minW="10rem" flex="1" data-testid="account-total-team">
        <Text fontSize="xs" color="fg.muted">
          {t("financialAccounts.totals.team")}
        </Text>
        <BalanceText balance={totals ? team : undefined} size="lg" testId="account-total-team-value" />
        <Text fontSize="xs" color="fg.muted">
          {t("financialAccounts.totals.accounts", { count: accounts })}
        </Text>
      </Box>
    </Flex>
  );
}

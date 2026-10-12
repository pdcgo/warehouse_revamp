import { useTranslation } from "react-i18next";
import { Box, Flex, HStack, Stack, Text } from "@chakra-ui/react";

import type { Metric } from "../../../features/financialAccount/analytics";
import { BalanceText, ChangeTypeBadge } from "../../../features/financialAccount/badges";
import { CHANGE_TYPES } from "../../../features/financialAccount/vocab";
import { FIELD_OF, signed } from "./MetricColumns";

// The window in its numbers: where the money stood when it opened, what moved it — by type — and where it
// stands at its end. `close − open` equals the sum of the types, by construction of the daily row.
//
// A TRANSFER nets to zero for the whole team — both legs are its own accounts — so it shows as zero here
// and as its two sides when one account is filtered.
export function ReportSummary({ metric }: { metric: Metric | undefined }) {
  const { t } = useTranslation();

  return (
    <Stack gap="card" borderWidth="1px" borderRadius="md" p="card" data-testid="account-report-summary">
      <Flex gap="card" wrap="wrap">
        <Tile label={t("financialAccounts.report.open")} testId="account-report-open">
          <BalanceText balance={metric?.openBalance} size="lg" testId="account-report-open-value" />
        </Tile>
        <Tile label={t("financialAccounts.report.change")} testId="account-report-change">
          <Text fontSize="lg" fontWeight="semibold" data-testid="account-report-change-value">
            {metric ? signed(metric.change) : "—"}
          </Text>
        </Tile>
        <Tile label={t("financialAccounts.report.close")} testId="account-report-close">
          <BalanceText balance={metric?.closeBalance} size="lg" testId="account-report-close-value" />
        </Tile>
      </Flex>

      <Flex gap="2" wrap="wrap">
        {CHANGE_TYPES.map((c) => {
          const v = metric ? metric[FIELD_OF[c]!] : 0;
          if (v === 0) return null;

          return (
            <HStack key={c} gap="1" borderWidth="1px" borderRadius="md" px="2" py="1" data-testid={`account-report-type-${c}`}>
              <ChangeTypeBadge changeType={c} />
              <Text fontSize="sm">{signed(v)}</Text>
            </HStack>
          );
        })}
      </Flex>
    </Stack>
  );
}

function Tile({ label, testId, children }: { label: string; testId: string; children: React.ReactNode }) {
  return (
    <Box minW="10rem" flex="1" data-testid={testId}>
      <Text fontSize="xs" color="fg.muted">
        {label}
      </Text>
      {children}
    </Box>
  );
}

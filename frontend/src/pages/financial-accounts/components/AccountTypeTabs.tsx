import { useTranslation } from "react-i18next";
import { Badge, Tabs } from "@chakra-ui/react";

import type { TypeTotal } from "../../../features/financialAccount/adapt";
import { FinancialAccountType } from "../../../gen/warehouse/financial_account/v1/financial_account_pb";
import { TYPE_TOTAL_KEY } from "../../../features/financialAccount/vocab";

const ALL = "all";

// In the totals' order and in the totals' words, so a tab and the card it lights up say the same thing.
const TYPES = [
  FinancialAccountType.BANK_ACCOUNT,
  FinancialAccountType.WALLET,
  FinancialAccountType.CASH,
  FinancialAccountType.UNKNOWN,
];

// THE TYPE IS A TAB ROW (owner, `the-accounts-type-is-a-tab-row`) — a view of the same list, not a form value,
// read the way the order list's status tabs are: each with its count. A type the team holds no active
// account in has no tab, as it has no card — unless it is the one picked, so the row never loses its
// selection. The counts are the totals' (active accounts), asked of the server over the whole team.
export function AccountTypeTabs({
  value,
  onChange,
  totals,
}: {
  value: FinancialAccountType | undefined;
  onChange: (type: FinancialAccountType | undefined) => void;
  totals: TypeTotal[] | undefined;
}) {
  const { t } = useTranslation();

  const all = totals ?? [];
  const countOf = (type: FinancialAccountType) => all.find((x) => x.type === type)?.accountCount;
  const shown = TYPES.filter((type) => countOf(type) !== undefined || type === value);

  return (
    <Tabs.Root
      value={value === undefined ? ALL : String(value)}
      onValueChange={(e) => onChange(e.value === ALL ? undefined : (Number(e.value) as FinancialAccountType))}
      data-testid="account-type-tabs"
    >
      <Tabs.List flexWrap="wrap" rowGap="1">
        <Tabs.Trigger value={ALL} flexShrink="0" whiteSpace="nowrap" data-testid="account-type-tab-all">
          {t("financialAccounts.allTypes")}
          {totals && (
            <Badge size="xs" variant="subtle">
              {all.reduce((sum, x) => sum + x.accountCount, 0)}
            </Badge>
          )}
        </Tabs.Trigger>
        {shown.map((type) => (
          <Tabs.Trigger
            key={type}
            value={String(type)}
            flexShrink="0"
            whiteSpace="nowrap"
            data-testid={`account-type-tab-${type}`}
          >
            {t(TYPE_TOTAL_KEY[type]!)}
            <Badge size="xs" variant="subtle">
              {countOf(type) ?? 0}
            </Badge>
          </Tabs.Trigger>
        ))}
      </Tabs.List>
    </Tabs.Root>
  );
}

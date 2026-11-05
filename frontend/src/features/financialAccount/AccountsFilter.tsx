import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Combobox, HStack, Span, useFilter, useListCollection } from "@chakra-ui/react";

import type { FinancialAccountProvider } from "../../gen/warehouse/financial_account/v1/financial_account_pb";
import { searchOnlyWhatIsTyped } from "../../lib/comboboxSearch";
import { ProviderBadge } from "./badges";
import { useFinancialAccounts } from "./queries";

interface AccountItem {
  label: string;
  value: string;
  provider: FinancialAccountProvider;
}

// THE ACCOUNT FILTER of the Finance metrics (finance-filters-by-account) — ONE ACCOUNT OR SEVERAL of the team's own, a
// SEARCH SELECT since a team's accounts grow with no ceiling. Every account is offered, archived and Lainnya included:
// a report reads the past, and those accounts have one. None picked is EVERY ACCOUNT — the placeholder says so.
//
// Loaded whole (one page of 200 — a team's account list is small) and filtered in the field; a pick keeps the panel
// open, so several are ticked in one go.
export function AccountsFilter({
  teamId,
  value,
  onChange,
  testId = "accounts-filter",
}: {
  teamId: bigint;
  /** Account ids, as strings — the URL's own. [] = every account. */
  value: string[];
  onChange: (accountIds: string[]) => void;
  testId?: string;
}) {
  const { t } = useTranslation();
  const accounts = useFinancialAccounts({ teamId, q: "", includeArchived: true, page: 1, pageSize: 200 });

  const items: AccountItem[] = useMemo(
    () => (accounts.data?.accounts ?? []).map((a) => ({ label: a.name, value: a.id.toString(), provider: a.provider })),
    [accounts.data],
  );

  // ⚠ ARK FILTERS ONLY WITH A MATCHER — without `filter` the field looks like a search and searches nothing.
  const { contains } = useFilter({ sensitivity: "base" });
  const { collection, filter, set } = useListCollection<AccountItem>({
    initialItems: [],
    itemToString: (item) => item.label,
    itemToValue: (item) => item.value,
    filter: contains,
  });

  // The ShopSelect fix: the collection fills in, then the Root remounts, so a prefilled value is not left blank.
  const [filled, setFilled] = useState(false);
  useEffect(() => {
    if (!accounts.isSuccess) return;
    set(items);
    setFilled(true);
  }, [items, accounts.isSuccess, set]);

  const picked = value.length;
  const placeholder =
    picked === 0
      ? t("analytic.all.account")
      : picked === 1
        ? (items.find((i) => i.value === value[0])?.label ?? t("analytic.accountsPicked", { count: 1 }))
        : t("analytic.accountsPicked", { count: picked });

  return (
    <Combobox.Root
      key={filled ? "ready" : "loading"}
      collection={collection}
      multiple
      closeOnSelect={false}
      // Only a keystroke searches; a pick, a blur or a click-to-open starts over (a-search-select-reopens-whole).
      {...searchOnlyWhatIsTyped(filter)}
      openOnClick
      value={value}
      onValueChange={(e) => onChange(e.value)}
      data-testid={testId}
    >
      <Combobox.Control>
        {/* The field shows what is picked as its placeholder: a multi-pick keeps the input for the search. */}
        <Combobox.Input
          data-testid={`${testId}-input`}
          placeholder={placeholder}
          _placeholder={picked > 0 ? { color: "fg" } : undefined}
        />
        <Combobox.IndicatorGroup>
          <Combobox.ClearTrigger data-testid={`${testId}-clear`} />
          <Combobox.Trigger />
        </Combobox.IndicatorGroup>
      </Combobox.Control>
      {/* Inline, like every search select on a page that may host a dialog over it. */}
      <Combobox.Positioner>
        <Combobox.Content>
          <Combobox.Empty>{t("financialAccounts.emptySearch")}</Combobox.Empty>
          {collection.items.map((item) => (
            <Combobox.Item item={item} key={item.value} data-testid={`${testId}-option-${item.value}`}>
              <HStack gap="2">
                <Span>{item.label}</Span>
                <ProviderBadge provider={item.provider} />
              </HStack>
              <Combobox.ItemIndicator />
            </Combobox.Item>
          ))}
        </Combobox.Content>
      </Combobox.Positioner>
    </Combobox.Root>
  );
}

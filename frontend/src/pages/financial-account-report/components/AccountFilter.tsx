import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Combobox, HStack, Span, useListCollection } from "@chakra-ui/react";

import { ProviderBadge } from "../../../features/financialAccount/badges";
import type { FinancialAccount, FinancialAccountProvider } from "../../../gen/warehouse/financial_account/v1/financial_account_pb";
import { searchOnlyWhatIsTyped } from "../../../lib/comboboxSearch";

interface AccountItem {
  label: string;
  value: string;
  provider: FinancialAccountProvider;
}

// The whole team, or one account — a SEARCH SELECT, since a team's accounts grow with no ceiling (CLAUDE.md, a picker
// over data that grows). Loaded whole by the page, filtered in the field. Every account is offered, archived and
// Lainnya included, unlike a picker that records a fact: a report reads the past, and those accounts have one.
//
// No account picked is EVERY ACCOUNT — the placeholder reads "Semua akun", as the shop filter's reads "Semua toko"
// (owner: *"placeholder select akun itu bukan seluruh tim"*), and clearing the field emits 0n.
export function AccountFilter({
  accounts,
  value,
  onChange,
  loaded,
}: {
  accounts: FinancialAccount[];
  value: bigint;
  onChange: (accountId: bigint) => void;
  /** The accounts have arrived — the combobox remounts once, so a prefilled value is not left blank. */
  loaded: boolean;
}) {
  const { t } = useTranslation();

  const items: AccountItem[] = useMemo(
    () => accounts.map((a) => ({ label: a.name, value: a.id.toString(), provider: a.provider })),
    [accounts],
  );

  const { collection, filter, set } = useListCollection<AccountItem>({
    initialItems: [],
    itemToString: (item) => item.label,
    itemToValue: (item) => item.value,
  });

  // ⚠ The ShopSelect fix: Zag derives the field's text once, so the collection fills in, then the Root remounts.
  const [filled, setFilled] = useState(false);
  useEffect(() => {
    if (!loaded) return;
    set(items);
    setFilled(true);
  }, [items, loaded, set]);

  return (
    <Combobox.Root
      key={filled ? "ready" : "loading"}
      collection={collection}
      // Only a keystroke searches; a pick, a blur or a click-to-open starts over (a-search-select-reopens-whole).
      {...searchOnlyWhatIsTyped(filter)}
      selectionBehavior="replace"
      openOnClick
      value={value > 0n ? [value.toString()] : []}
      onValueChange={(e) => onChange(e.value[0] ? BigInt(e.value[0]) : 0n)}
    >
      <Combobox.Control>
        <Combobox.Input data-testid="account-report-account" placeholder={t("financialAccounts.report.allAccounts")} />
        <Combobox.IndicatorGroup>
          <Combobox.ClearTrigger />
          <Combobox.Trigger />
        </Combobox.IndicatorGroup>
      </Combobox.Control>
      {/* Inline, like every search select on a page that may host a dialog over it. */}
      <Combobox.Positioner>
        <Combobox.Content>
          <Combobox.Empty>{t("financialAccounts.emptySearch")}</Combobox.Empty>
          {collection.items.map((item) => (
            <Combobox.Item item={item} key={item.value} data-testid={`account-report-account-option-${item.value}`}>
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

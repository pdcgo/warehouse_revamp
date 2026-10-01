import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Select, createListCollection } from "@chakra-ui/react";

import type { FinancialAccountChangeType } from "../../../gen/warehouse/financial_account/v1/financial_account_pb";
import { CHANGE_TYPES, CHANGE_TYPE_KEY } from "../../../features/financialAccount/vocab";

const ALL = "all";

// One change type, or all of them — the statement's filter. Inline (no Portal), like every Select on a
// page that may later host a dialog over it.
export function ChangeTypeFilter({
  value,
  onChange,
}: {
  value: FinancialAccountChangeType | undefined;
  onChange: (changeType: FinancialAccountChangeType | undefined) => void;
}) {
  const { t } = useTranslation();

  const collection = useMemo(
    () =>
      createListCollection({
        items: [
          { label: t("financialAccounts.log.allTypes"), value: ALL },
          ...CHANGE_TYPES.map((c) => ({ label: t(CHANGE_TYPE_KEY[c]!), value: String(c) })),
        ],
      }),
    [t],
  );

  return (
    <Select.Root
      collection={collection}
      width="14rem"
      value={[value === undefined ? ALL : String(value)]}
      onValueChange={(e) => {
        const picked = e.value[0];
        onChange(!picked || picked === ALL ? undefined : (Number(picked) as FinancialAccountChangeType));
      }}
    >
      <Select.HiddenSelect />
      <Select.Control>
        <Select.Trigger data-testid="account-log-type-filter">
          <Select.ValueText />
        </Select.Trigger>
        <Select.IndicatorGroup>
          <Select.Indicator />
        </Select.IndicatorGroup>
      </Select.Control>
      <Select.Positioner>
        <Select.Content>
          {collection.items.map((item) => (
            <Select.Item item={item} key={item.value} data-testid={`account-log-type-option-${item.value}`}>
              {item.label}
              <Select.ItemIndicator />
            </Select.Item>
          ))}
        </Select.Content>
      </Select.Positioner>
    </Select.Root>
  );
}

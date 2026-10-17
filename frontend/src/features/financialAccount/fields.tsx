import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Select, createListCollection } from "@chakra-ui/react";

import { RadioPills } from "../../components/inputs/RadioPills";

import type {
  FinancialAccountProvider,
  FinancialAccountType,
} from "../../gen/warehouse/financial_account/v1/financial_account_pb";
import { PICKABLE_TYPES, PROVIDER_KEY, TYPE_KEY } from "./vocab";

// The two controls an account's identity is picked with — on New Account, and when an unknown account is filled
// in. THE TYPE DECIDES THE PROVIDER (`the-type-decides-the-provider`): the caller hands the picker the type's own
// options (`PROVIDERS_BY_TYPE`), and a cash box or type Lainnya shows no picker at all.

/** Bank account · Wallet · Cash. Never `unknown` — only a withdrawal makes one. */
export function TypeSegment({
  value,
  onChange,
  types = PICKABLE_TYPES,
  testId = "account-type",
}: {
  value: FinancialAccountType;
  onChange: (type: FinancialAccountType) => void;
  /** The types offered — New Account's four, or Tentukan Rekening's three. */
  types?: FinancialAccountType[];
  testId?: string;
}) {
  const { t } = useTranslation();

  // Radio pills, not a segmented switch (`a-dialog-choice-is-a-radio-pill`).
  return (
    <RadioPills
      value={String(value)}
      onChange={(v) => onChange(Number(v) as FinancialAccountType)}
      ariaLabel={t("financialAccounts.form.type")}
      testId={testId}
      options={types.map((type) => ({ value: String(type), label: t(TYPE_KEY[type]!), testId: `${testId}-${type}` }))}
    />
  );
}

/** The providers of one type — the banks for a bank account, ShopeePay for a digital wallet. */
export function ProviderPicker({
  value,
  onChange,
  options,
  testId = "account-provider",
}: {
  value: FinancialAccountProvider;
  onChange: (provider: FinancialAccountProvider) => void;
  options: FinancialAccountProvider[];
  testId?: string;
}) {
  const { t } = useTranslation();

  const collection = useMemo(
    () =>
      createListCollection({
        items: options.map((p) => ({ label: t(PROVIDER_KEY[p]!), value: String(p) })),
      }),
    [t, options],
  );

  return (
    <Select.Root
      collection={collection}
      value={value ? [String(value)] : []}
      onValueChange={(e) => {
        const picked = e.value[0];
        if (picked) onChange(Number(picked) as FinancialAccountProvider);
      }}
    >
      <Select.HiddenSelect />
      <Select.Control>
        <Select.Trigger data-testid={testId}>
          <Select.ValueText placeholder={t("financialAccounts.form.providerPlaceholder")} />
        </Select.Trigger>
        <Select.IndicatorGroup>
          <Select.Indicator />
        </Select.IndicatorGroup>
      </Select.Control>
      {/* Inline, not portalled — it lives inside a modal Dialog (ShopSelect's reasoning). */}
      <Select.Positioner>
        <Select.Content>
          {collection.items.map((item) => (
            <Select.Item item={item} key={item.value} data-testid={`${testId}-option-${item.value}`}>
              {item.label}
              <Select.ItemIndicator />
            </Select.Item>
          ))}
        </Select.Content>
      </Select.Positioner>
    </Select.Root>
  );
}

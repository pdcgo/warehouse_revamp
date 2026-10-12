import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { SegmentGroup, Select, createListCollection } from "@chakra-ui/react";

import type {
  FinancialAccountProvider,
  FinancialAccountType,
} from "../../gen/warehouse/financial_account/v1/financial_account_pb";
import { PICKABLE_PROVIDERS, PICKABLE_TYPES, PROVIDER_KEY, TYPE_KEY } from "./vocab";

// The two controls an account's identity is picked with — on New Account, and when an unknown account
// is filled in. Picked APART: neither constrains the other, and a mismatched pair saves
// (type-and-provider-are-picked-apart).

/** Bank account · Wallet · Cash. Never `unknown` — only a withdrawal makes one. */
export function TypeSegment({
  value,
  onChange,
  testId = "account-type",
}: {
  value: FinancialAccountType;
  onChange: (type: FinancialAccountType) => void;
  testId?: string;
}) {
  const { t } = useTranslation();

  return (
    <SegmentGroup.Root
      value={String(value)}
      onValueChange={(e) => onChange(e.value ? (Number(e.value) as FinancialAccountType) : value)}
      aria-label={t("financialAccounts.form.type")}
      data-testid={testId}
    >
      <SegmentGroup.Indicator />
      {PICKABLE_TYPES.map((type) => (
        <SegmentGroup.Item key={type} value={String(type)} data-testid={`${testId}-${type}`}>
          <SegmentGroup.ItemText>{t(TYPE_KEY[type]!)}</SegmentGroup.ItemText>
          <SegmentGroup.ItemHiddenInput />
        </SegmentGroup.Item>
      ))}
    </SegmentGroup.Root>
  );
}

/** BCA · BNI · Jago · ShopeePay · Cash. Never `unknown`. */
export function ProviderPicker({
  value,
  onChange,
  testId = "account-provider",
}: {
  value: FinancialAccountProvider;
  onChange: (provider: FinancialAccountProvider) => void;
  testId?: string;
}) {
  const { t } = useTranslation();

  const collection = useMemo(
    () =>
      createListCollection({
        items: PICKABLE_PROVIDERS.map((p) => ({ label: t(PROVIDER_KEY[p]!), value: String(p) })),
      }),
    [t],
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

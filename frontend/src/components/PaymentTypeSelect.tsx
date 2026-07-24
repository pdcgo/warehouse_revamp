import { useMemo } from "react";
import { Portal, Select, createListCollection } from "@chakra-ui/react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { RestockPaymentType } from "../gen/warehouse/inventory/v1/restock_request_pb";

// paymentTypeLabel is the shared display name for a payment type — used by the picker below and by
// callers that show a recorded payment read-only (the restock detail page). It takes `t` because —
// unlike marketplaceLabel, whose names are brand names — these labels are translated.
//
// UNSPECIFIED returns "" on purpose: it means "not recorded", not "a third kind of payment", so a
// read-only caller falls back to its own empty state (the detail page's muted "—").
export function paymentTypeLabel(t: TFunction, type: RestockPaymentType): string {
  switch (type) {
    case RestockPaymentType.SHOPEE_PAY:
      return t("restock.form.paymentShopeePay");
    case RestockPaymentType.BANK_ACCOUNT:
      return t("restock.form.paymentBankAccount");
    default:
      return "";
  }
}

// The payment types that can actually be PICKED — UNSPECIFIED is excluded here because it is not a
// kind of payment; it is the "none" option the component renders separately below.
export const PAYMENT_TYPES: RestockPaymentType[] = [
  RestockPaymentType.SHOPEE_PAY,
  RestockPaymentType.BANK_ACCOUNT,
];

// The value used for "not recorded". A sentinel string rather than "" because Chakra's Select treats
// an empty value array as "nothing selected", which is a different state: here, having recorded no
// payment type is a CHOICE somebody can make and come back to.
const NONE = "none";

export interface PaymentTypeSelectProps {
  value?: RestockPaymentType;
  onChange?: (type: RestockPaymentType) => void;
  /** Label for the "not recorded" option; defaults to the translated "none". */
  placeholder?: string;
  disabled?: boolean;
}

// PaymentTypeSelect is the shared payment-type picker (#132/#165). It emits a RestockPaymentType, so
// callers work in the enum rather than coercing strings at every call site.
//
// Chakra's composable Select (#165, owner), not NativeSelect. An earlier note here argued NativeSelect
// was enough for three options and that Select's weight "isn't earned" — but Select is already in the
// bundle for the other pickers, so there is no weight to earn, and a native dropdown does not look or
// behave like the rest of the form around it.
export const description =
  'Payment-type picker (Chakra Select). Emits a RestockPaymentType; the "not recorded" option is selectable, because having recorded no payment is a real answer.';

export function PaymentTypeSelect({ value, onChange, placeholder, disabled }: PaymentTypeSelectProps) {
  const { t } = useTranslation();

  const noneLabel = placeholder ?? t("restock.form.paymentTypeNone");

  const collection = useMemo(
    () =>
      createListCollection({
        // "Not recorded" is an ITEM, not a disabled placeholder — unlike the pickers where an
        // unanswered field is invalid. A person must be able to go back to having recorded no payment
        // type, and #131 is the bug that taught this: a picker you cannot un-set is write-once.
        items: [
          { label: noneLabel, value: NONE },
          ...PAYMENT_TYPES.map((type) => ({
            label: paymentTypeLabel(t, type),
            value: String(type),
          })),
        ],
      }),
    [t, noneLabel],
  );

  return (
    <Select.Root
      collection={collection}
      disabled={disabled}
      value={[
        value === undefined || value === RestockPaymentType.UNSPECIFIED ? NONE : String(value),
      ]}
      onValueChange={(e) => {
        const picked = e.value[0];
        if (picked === undefined) return;

        onChange?.(
          picked === NONE
            ? RestockPaymentType.UNSPECIFIED
            : (Number(picked) as RestockPaymentType),
        );
      }}
    >
      <Select.HiddenSelect />

      <Select.Control>
        <Select.Trigger data-testid="restock-payment-type">
          <Select.ValueText placeholder={noneLabel} />
        </Select.Trigger>
        <Select.IndicatorGroup>
          <Select.Indicator />
        </Select.IndicatorGroup>
      </Select.Control>

      <Portal>
        <Select.Positioner>
          <Select.Content>
            {collection.items.map((item) => (
              <Select.Item item={item} key={item.value} data-testid={`payment-type-${item.value}`}>
                <Select.ItemText>{item.label}</Select.ItemText>
                <Select.ItemIndicator />
              </Select.Item>
            ))}
          </Select.Content>
        </Select.Positioner>
      </Portal>
    </Select.Root>
  );
}

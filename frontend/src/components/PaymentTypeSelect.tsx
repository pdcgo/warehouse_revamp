import { NativeSelect } from "@chakra-ui/react";
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

export interface PaymentTypeSelectProps {
  value?: RestockPaymentType;
  onChange?: (type: RestockPaymentType) => void;
  /** Label for the "not recorded" option; defaults to the translated "none". */
  placeholder?: string;
  disabled?: boolean;
}

// PaymentTypeSelect is the shared payment-type picker (#132). It emits a RestockPaymentType, so
// callers work in the enum rather than coercing strings at every call site.
//
// NativeSelect, not the composable Select the other pickers use: this is a three-option list with no
// search, and NativeSelect is already in the bundle — Select's extra weight isn't earned here.
export const description =
  "Payment-type picker (Chakra NativeSelect). Emits a RestockPaymentType; the empty option is selectable and means \"not recorded\".";

export function PaymentTypeSelect({ value, onChange, placeholder, disabled }: PaymentTypeSelectProps) {
  const { t } = useTranslation();

  return (
    <NativeSelect.Root disabled={disabled}>
      <NativeSelect.Field
        data-testid="restock-payment-type"
        value={value === undefined || value === RestockPaymentType.UNSPECIFIED ? "" : String(value)}
        onChange={(e) =>
          onChange?.(
            e.target.value
              ? (Number(e.target.value) as RestockPaymentType)
              : RestockPaymentType.UNSPECIFIED,
          )
        }
      >
        {/* UNSPECIFIED is a legitimate value ("not recorded"), so — unlike the pickers whose empty
            option is a disabled placeholder — this one stays selectable: a user must be able to go
            back to having recorded no payment type. */}
        <option value="">{placeholder ?? t("restock.form.paymentTypeNone")}</option>
        {PAYMENT_TYPES.map((type) => (
          <option key={type} value={String(type)}>
            {paymentTypeLabel(t, type)}
          </option>
        ))}
      </NativeSelect.Field>
      <NativeSelect.Indicator />
    </NativeSelect.Root>
  );
}

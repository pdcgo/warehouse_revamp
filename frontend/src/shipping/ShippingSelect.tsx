import { NativeSelect } from "@chakra-ui/react";
import { useTranslation } from "react-i18next";
import { useShippingCatalogue } from "./catalogue";

export interface ShippingSelectProps {
  /** Selected courier CODE (Shipping.code — the stable key a shipment stores, not the name). */
  value?: string;
  onChange?: (code: string) => void;
  placeholder?: string;
  disabled?: boolean;
}

// ShippingSelect is a reusable courier picker backed by the shared courier catalogue (#126) — it no
// longer fetches for itself, so a screen with a picker AND badges makes ONE ShippingList call. The
// value it emits is a courier CODE, so callers persist a stable key rather than a display label.
export const description = "Courier picker backed by the shipping catalogue. Emits a courier code.";

export function ShippingSelect({
  value,
  onChange,
  placeholder,
  disabled,
}: ShippingSelectProps) {
  const { t } = useTranslation();
  const resolvedPlaceholder = placeholder ?? t("catalog.shippingSelect.placeholder");
  const { couriers, error } = useShippingCatalogue();

  return (
    <NativeSelect.Root disabled={disabled}>
      <NativeSelect.Field
        data-testid="shipping-select"
        value={value ?? ""}
        onChange={(e) => onChange?.(e.target.value)}
      >
        {/* Selectable, not a disabled placeholder: no courier ("") is a legitimate value — neither
            restock nor order requires one. A force-a-choice placeholder was harmless while this only
            fed create forms, but it made the field WRITE-ONCE once an edit form existed (#131): a
            courier picked by mistake could never be unset, though the contract allows it. */}
        <option value="">{error ? t("catalog.shippingSelect.unavailable") : resolvedPlaceholder}</option>
        {couriers.map((courier) => (
          <option key={courier.code} value={courier.code}>
            {courier.name}
          </option>
        ))}
      </NativeSelect.Field>
      <NativeSelect.Indicator />
    </NativeSelect.Root>
  );
}

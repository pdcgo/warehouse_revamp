import { useEffect, useState } from "react";
import { NativeSelect } from "@chakra-ui/react";
import { useTranslation } from "react-i18next";
import { rpcError, shippingClient } from "../api/clients";
import type { Shipping } from "../gen/warehouse/shipping/v1/shipping_pb";

export interface ShippingSelectProps {
  /** Selected courier CODE (Shipping.code — the stable key a shipment stores, not the name). */
  value?: string;
  onChange?: (code: string) => void;
  placeholder?: string;
  disabled?: boolean;
}

// ShippingSelect is a reusable courier picker backed by ShippingList. It loads the seeded courier
// catalogue once; the value it emits is a courier CODE, so callers persist a stable key rather than
// a display label.
export const description = "Courier picker backed by the shipping catalogue. Emits a courier code.";

export function ShippingSelect({
  value,
  onChange,
  placeholder,
  disabled,
}: ShippingSelectProps) {
  const { t } = useTranslation();
  const resolvedPlaceholder = placeholder ?? t("catalog.shippingSelect.placeholder");
  const [couriers, setCouriers] = useState<Shipping[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;

    shippingClient
      .shippingList({})
      .then((res) => {
        if (alive) setCouriers(res.data);
      })
      .catch((err) => {
        if (alive) setError(rpcError(err));
      });

    return () => {
      alive = false;
    };
  }, []);

  return (
    <NativeSelect.Root disabled={disabled}>
      <NativeSelect.Field
        data-testid="shipping-select"
        value={value ?? ""}
        onChange={(e) => onChange?.(e.target.value)}
      >
        <option value="" disabled>
          {error ? t("catalog.shippingSelect.unavailable") : resolvedPlaceholder}
        </option>
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

import { useEffect, useState } from "react";
import { NativeSelect } from "@chakra-ui/react";
import { useTranslation } from "react-i18next";
import { rpcError, supplierClient } from "../api/clients";
import type { Supplier } from "../gen/warehouse/inventory/v1/supplier_pb";

export interface SupplierSelectProps {
  /** The team whose suppliers to list — a supplier is team-scoped, so this is required. */
  teamId: bigint;
  /** Selected supplier id (0n = none). */
  value?: bigint;
  onChange?: (supplierId: bigint) => void;
  placeholder?: string;
  disabled?: boolean;
}

// SupplierSelect is the shared supplier picker for a team (#109). A team buys from a handful of
// suppliers, so — like ShopSelect over the team's shops — it loads them all once into a NativeSelect
// rather than paging or searching. It emits a supplier id; the label shows the supplier's name and
// its code so two suppliers with similar names stay distinguishable.
export const description = "Supplier picker for a team (NativeSelect over SupplierList). Emits a supplier id; labels each supplier with its code.";

export function SupplierSelect({
  teamId,
  value,
  onChange,
  placeholder,
  disabled,
}: SupplierSelectProps) {
  const { t } = useTranslation();
  const resolvedPlaceholder = placeholder ?? t("suppliers.select.placeholder");
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    if (teamId <= 0n) {
      setSuppliers([]);
      return;
    }

    let alive = true;

    supplierClient
      .supplierList({ teamId, q: "", page: { page: 1, limit: 100 } })
      .then((res) => {
        if (alive) setSuppliers(res.suppliers);
      })
      .catch((err) => {
        if (alive) setError(rpcError(err));
      });

    return () => {
      alive = false;
    };
  }, [teamId]);

  return (
    <NativeSelect.Root disabled={disabled}>
      <NativeSelect.Field
        data-testid="supplier-select"
        value={value && value > 0n ? value.toString() : ""}
        onChange={(e) => onChange?.(e.target.value ? BigInt(e.target.value) : 0n)}
      >
        {/* Selectable, not a disabled placeholder: "no supplier" (0) is a legitimate value, not the
            absence of an answer. A force-a-choice placeholder was harmless while this only fed a
            create form — nothing was recorded yet — but it made the field WRITE-ONCE the moment an
            edit form existed (#131): a supplier recorded by mistake could never be removed, though
            the contract, the handler and its test all support clearing it. */}
        <option value="">{error ? t("suppliers.select.unavailable") : resolvedPlaceholder}</option>
        {suppliers.map((supplier) => (
          <option key={supplier.id.toString()} value={supplier.id.toString()}>
            {supplier.code ? `${supplier.name} (${supplier.code})` : supplier.name}
          </option>
        ))}
      </NativeSelect.Field>
      <NativeSelect.Indicator />
    </NativeSelect.Root>
  );
}

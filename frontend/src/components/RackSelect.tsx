import { useEffect, useState } from "react";
import { NativeSelect } from "@chakra-ui/react";
import { useTranslation } from "react-i18next";
import { rackClient, rpcError } from "../api/clients";
import type { Rack } from "../gen/warehouse/inventory/v1/rack_pb";

/**
 * The value meaning "the not-yet-shelved pile" — stock that arrived before anyone put it away.
 * A REAL place, not an absence: it can be counted and miscounted like any shelf, and today it is
 * where everything sits. Distinct from `""`, which means the question has not been answered.
 */
export const UNPLACED = "unplaced";

export interface RackSelectProps {
  /** The warehouse whose racks to list — a rack stands in exactly one warehouse, so this is required. */
  warehouseId: bigint;
  /** `""` = not answered yet · `UNPLACED` = the not-yet-shelved pile · otherwise a rack id as a string. */
  value: string;
  onChange: (value: string) => void;
  /** Label for the not-answered-yet option; defaults to the translated "select a place". */
  placeholder?: string;
  disabled?: boolean;
}

// RackSelect is the shared place picker for a warehouse (#139) — the racks plus the unplaced pile.
// Like SupplierSelect over a team's suppliers, a warehouse has a handful of racks, so it loads them
// all once into a NativeSelect rather than paging or searching. It emits a plain string, so a caller
// converts to whatever its own contract wants (StockAdjust wants a oneof) without this component
// knowing about any one RPC.
//
// The option semantics are the whole point, and the two "empty-looking" options are NOT the same:
//   - "Unplaced" is SELECTABLE — it is a legal answer (cf. PaymentTypeSelect's empty option).
//   - the placeholder is DISABLED — "not answered yet" is not a value, and submitting it is the
//     precise bug this picker exists to prevent.
export const description =
  "Place picker for a warehouse (Chakra NativeSelect over RackList): the racks plus a selectable \"Unplaced\" pile. Emits \"\" (unanswered) | \"unplaced\" | a rack id string; the unanswered placeholder is disabled on purpose.";

export function RackSelect({ warehouseId, value, onChange, placeholder, disabled }: RackSelectProps) {
  const { t } = useTranslation();
  const resolvedPlaceholder = placeholder ?? t("racks.select.placeholder");
  const [racks, setRacks] = useState<Rack[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    if (warehouseId <= 0n) {
      setRacks([]);
      return;
    }

    let alive = true;

    // RackList scopes racks by `team_id` — a warehouse IS a team (one of type WAREHOUSE), and the
    // handler matches it against the rack's `warehouse_id`. Deleted racks are filtered server-side,
    // and the list comes back ordered by code, which is how someone walking the aisles reads it.
    rackClient
      .rackList({ teamId: warehouseId, q: "", page: { page: 1, limit: 200 } })
      .then((res) => {
        if (alive) setRacks(res.racks);
      })
      .catch((err) => {
        if (alive) setError(rpcError(err));
      });

    return () => {
      alive = false;
    };
  }, [warehouseId]);

  return (
    <NativeSelect.Root disabled={disabled}>
      <NativeSelect.Field
        data-testid="rack-select"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {/* Disabled, unlike the selectable empty option on SupplierSelect / PaymentTypeSelect — and
            for the same underlying reason, applied to a different question. There, "" meant "no
            supplier" / "no payment type recorded": a VALUE, so it had to stay reachable or the field
            became write-once (#131). Here "" means the count has no place yet, which is not a place —
            "unplaced" is the option for that. A stock-take that silently corrected the wrong shelf
            would be believed, so the answer is refused rather than guessed. This is the one
            legitimate use of a disabled placeholder. */}
        <option value="" disabled>
          {error ? t("racks.select.unavailable") : resolvedPlaceholder}
        </option>

        {/* Rendered even when the rack list failed to load: "unplaced" is answerable without it. */}
        <option value={UNPLACED}>{t("racks.select.unplaced")}</option>

        {racks.map((rack) => (
          <option key={rack.id.toString()} value={rack.id.toString()}>
            {rack.name ? `${rack.code} — ${rack.name}` : rack.code}
          </option>
        ))}
      </NativeSelect.Field>
      <NativeSelect.Indicator />
    </NativeSelect.Root>
  );
}

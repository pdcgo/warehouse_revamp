import { useMemo } from "react";
import { Select, createListCollection } from "@chakra-ui/react";
import { useTranslation } from "react-i18next";
import { useRacks } from "../features/racks/queries";

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
// all once rather than paging or searching. It emits a plain string, so a caller converts to whatever
// its own contract wants (StockAdjust wants a oneof) without this component knowing about any one RPC.
//
// Chakra's composable Select, not NativeSelect (owner) — the last shared picker to make the move,
// after PaymentTypeSelect (#165). The reasoning there applies here unchanged: Select is already in
// the bundle for every other picker, so there is no weight to earn, and a native dropdown does not
// look or behave like the rest of the form around it. Beside a Chakra Input in the accept screen's
// put-away panel, the native chrome was the odd one out.
//
// The option semantics are the whole point, and the two "empty-looking" states are NOT the same:
//   - "Unplaced" is a SELECTABLE ITEM — it is a legal answer (cf. PaymentTypeSelect's "none").
//   - "not answered yet" is the PLACEHOLDER — not a value, and submitting it is the precise bug this
//     picker exists to prevent.
// Under NativeSelect that second rule needed a `<option value="" disabled>` and eight lines defending
// it. Select models it directly: an empty value array IS "nothing selected", so the hack is gone
// while the semantics are identical.
export const description =
  "Place picker for a warehouse (Chakra Select over RackList): the racks plus a selectable \"Unplaced\" pile. Emits \"\" (unanswered) | \"unplaced\" | a rack id string; unanswered is the placeholder, never a pickable option.";

export function RackSelect({ warehouseId, value, onChange, placeholder, disabled }: RackSelectProps) {
  const { t } = useTranslation();
  const resolvedPlaceholder = placeholder ?? t("racks.select.placeholder");

  // Read through the cache rather than fetching in an effect — see useRacks for why that mattered.
  const query = useRacks({ warehouseId });
  const racks = query.data ?? [];
  const error = query.isError;

  const collection = useMemo(
    () =>
      createListCollection({
        items: [
          // Rendered even when the rack list failed to load: "unplaced" is answerable without it.
          { label: t("racks.select.unplaced"), value: UNPLACED },
          ...racks.map((rack) => ({
            label: rack.name ? `${rack.code} — ${rack.name}` : rack.code,
            value: rack.id.toString(),
          })),
        ],
      }),
    [racks, t],
  );

  return (
    <Select.Root
      collection={collection}
      disabled={disabled}
      value={value === "" ? [] : [value]}
      onValueChange={(e) => {
        const picked = e.value[0];
        // Guard the undefined case rather than emitting "": a Select that clears itself would put the
        // field back to "unanswered", which is not something a person can mean by picking a shelf.
        if (picked === undefined) return;
        onChange(picked);
      }}
    >
      <Select.HiddenSelect />

      <Select.Control>
        <Select.Trigger data-testid="rack-select">
          <Select.ValueText
            placeholder={error ? t("racks.select.unavailable") : resolvedPlaceholder}
          />
        </Select.Trigger>
        <Select.IndicatorGroup>
          <Select.Indicator />
        </Select.IndicatorGroup>
      </Select.Control>

      {/* No Portal on purpose: this picker is used inside modal Dialogs (AdjustStockDialog,
          MoveStockDialog), and a portalled listbox renders OUTSIDE the dialog where the modal makes
          it inert/aria-hidden — invisible to the a11y tree and unclickable. Rendering inline keeps it
          inside the dialog. (Same reasoning as ShopSelect and MarketplaceSelect.) */}
      <Select.Positioner>
        <Select.Content>
          {collection.items.map((item) => (
            <Select.Item item={item} key={item.value} data-testid={`rack-select-option-${item.value}`}>
              <Select.ItemText>{item.label}</Select.ItemText>
              <Select.ItemIndicator />
            </Select.Item>
          ))}
        </Select.Content>
      </Select.Positioner>
    </Select.Root>
  );
}

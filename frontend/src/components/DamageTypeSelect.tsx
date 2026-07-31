import { useMemo } from "react";
import { Select, createListCollection } from "@chakra-ui/react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { RestockDamageType } from "../gen/warehouse/inventory/v1/restock_request_pb";

// damageTypeLabel is the shared display name for a damage type — used by the picker below and by
// callers that show a recorded loss read-only (the restock detail page's problem lines).
//
// UNSPECIFIED returns "" on purpose: it means "not recorded", not "a third kind of loss", so a
// read-only caller falls back to its own empty state.
export function damageTypeLabel(t: TFunction, type: RestockDamageType): string {
  switch (type) {
    case RestockDamageType.BROKEN:
      return t("restock.accept.problemBroken");
    case RestockDamageType.LOST:
      return t("restock.accept.problemLost");
    default:
      return "";
  }
}

// The damage types that can be PICKED. UNSPECIFIED is excluded because it is not a kind of loss —
// and unlike PaymentTypeSelect there is no "none" option either: the proto refuses type 0, and the
// person at the door always knows which of the two it was.
export const DAMAGE_TYPES: RestockDamageType[] = [RestockDamageType.BROKEN, RestockDamageType.LOST];

export interface DamageTypeSelectProps {
  value: RestockDamageType;
  onChange: (type: RestockDamageType) => void;
  disabled?: boolean;
}

// DamageTypeSelect is the shared picker for HOW a received unit failed to become stock (#154):
// BROKEN (arrived unsellable) or LOST (never arrived). It was an inline NativeSelect on the accept
// page with its two <option>s written out by hand — which is how a second screen reporting the same
// loss ends up with a different vocabulary for it. It emits the enum, so callers work in
// RestockDamageType rather than coercing "broken" / "lost" strings at every call site.
//
// Chakra's composable Select, like every other picker in here (owner). Two options is not a reason
// to drop to a native dropdown: PaymentTypeSelect settled that argument in #165 — Select is already
// in the bundle, so there is no weight to earn, and the native control does not match the form
// around it.
//
// The two are a DELIBERATE pair, not a severity scale: "how much did they send us broken" and "how
// much did they short us" are different questions a supplier report separates, and neither is the
// other's lesser case. Both are excluded from stock entirely.
export const description =
  "Picker for how a received unit failed to become stock (Chakra Select): BROKEN (arrived unsellable) or LOST (never arrived). Emits a RestockDamageType. Neither ever enters stock — they are separate questions a supplier report keeps apart, not a severity scale.";

export function DamageTypeSelect({ value, onChange, disabled }: DamageTypeSelectProps) {
  const { t } = useTranslation();

  const collection = useMemo(
    () =>
      createListCollection({
        items: DAMAGE_TYPES.map((type) => ({
          label: damageTypeLabel(t, type),
          value: String(type),
        })),
      }),
    [t],
  );

  return (
    <Select.Root
      collection={collection}
      disabled={disabled}
      value={[String(value)]}
      onValueChange={(e) => {
        const picked = e.value[0];
        // There is no "not recorded" state to fall back to — the proto refuses type 0 — so a cleared
        // selection keeps whatever was already chosen rather than emitting UNSPECIFIED.
        if (picked === undefined) return;
        onChange(Number(picked) as RestockDamageType);
      }}
    >
      <Select.HiddenSelect />

      <Select.Control>
        <Select.Trigger data-testid="damage-type-select">
          <Select.ValueText />
        </Select.Trigger>
        <Select.IndicatorGroup>
          <Select.Indicator />
        </Select.IndicatorGroup>
      </Select.Control>

      {/* No Portal, for the same reason as RackSelect and ShopSelect: this belongs on screens that
          may render it inside a modal Dialog, where a portalled listbox lands outside the dialog and
          the modal makes it inert. */}
      <Select.Positioner>
        <Select.Content>
          {collection.items.map((item) => (
            <Select.Item item={item} key={item.value} data-testid={`damage-type-option-${item.value}`}>
              <Select.ItemText>{item.label}</Select.ItemText>
              <Select.ItemIndicator />
            </Select.Item>
          ))}
        </Select.Content>
      </Select.Positioner>
    </Select.Root>
  );
}

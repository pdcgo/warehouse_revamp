import { useMemo } from "react";
import { Select, createListCollection } from "@chakra-ui/react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { RestockCostKind } from "../../gen/warehouse/inventory/v1/restock_request_pb";

// costKindLabel is the shared display name for a cost kind — used by the picker below and by the two
// detail screens that show a recorded cost read-only.
//
// It lives here, beside the picker, for the reason damageTypeLabel does: three screens name these,
// and a kind spelled one way where it is TYPED and another way where it is READ reads as two
// different costs to the team being charged.
//
// An unrecognised kind falls back to a neutral label rather than "" — unlike a damage type, a cost
// carries MONEY, and a build that hid a line it did not recognise would show a total that does not
// add up.
export function costKindLabel(t: TFunction, kind: RestockCostKind): string {
  switch (kind) {
    case RestockCostKind.COD_SHIPPING:
      return t("restock.cost.kind.codShipping");
    case RestockCostKind.OTHER:
      return t("restock.cost.kind.other");
    default:
      return t("restock.cost.kind.unknown");
  }
}

// The kinds that can be PICKED. UNSPECIFIED is excluded because it is not a kind of cost — the proto
// refuses it, and the handler refuses it again.
export const COST_KINDS: RestockCostKind[] = [
  RestockCostKind.COD_SHIPPING,
  RestockCostKind.OTHER,
];

export interface CostKindSelectProps {
  value: RestockCostKind;
  onChange: (kind: RestockCostKind) => void;
  disabled?: boolean;
}

// CostKindSelect is the picker for WHAT a warehouse paid to receive a delivery (00021): the courier's
// fee at the door, or anything else with a note beside it.
//
// The list is deliberately SHORT and expected to grow. Adding a kind is one proto value and one
// label, never a migration — the column is text — so the picker starts at what actually happens today
// rather than at a speculative taxonomy nobody fills in.
//
// Chakra's composable Select, like every other picker here (owner). Two options is not a reason to
// drop to a native dropdown: PaymentTypeSelect settled that in #165.
export const description =
  "Picker for what a warehouse paid to receive a delivery (Chakra Select): the COD fee at the door, or OTHER — which requires a note, because an untyped amount charged to another team is a number they cannot argue with. Emits a RestockCostKind.";

export function CostKindSelect({
  value,
  onChange,
  disabled,
}: CostKindSelectProps) {
  const { t } = useTranslation();

  const collection = useMemo(
    () =>
      createListCollection({
        items: COST_KINDS.map((kind) => ({
          label: costKindLabel(t, kind),
          value: String(kind),
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
        // There is no "not recorded" state to fall back to — the handler refuses kind 0 — so a
        // cleared selection keeps whatever was already chosen rather than emitting UNSPECIFIED.
        if (picked === undefined) return;
        onChange(Number(picked) as RestockCostKind);
      }}
    >
      <Select.HiddenSelect />

      <Select.Control>
        <Select.Trigger data-testid="cost-kind-select">
          <Select.ValueText />
        </Select.Trigger>
        <Select.IndicatorGroup>
          <Select.Indicator />
        </Select.IndicatorGroup>
      </Select.Control>

      {/* No Portal, for the same reason as RackSelect and DamageTypeSelect: this renders on the
          accept screen, which may put it inside a modal Dialog — where a portalled listbox lands
          outside the dialog and the modal makes it inert. */}
      <Select.Positioner>
        <Select.Content>
          {collection.items.map((item) => (
            <Select.Item
              item={item}
              key={item.value}
              data-testid={`cost-kind-option-${item.value}`}
            >
              <Select.ItemText>{item.label}</Select.ItemText>
              <Select.ItemIndicator />
            </Select.Item>
          ))}
        </Select.Content>
      </Select.Positioner>
    </Select.Root>
  );
}

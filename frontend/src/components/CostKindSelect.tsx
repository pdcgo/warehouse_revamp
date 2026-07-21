import { useMemo } from "react";
import { Portal, Select, createListCollection } from "@chakra-ui/react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { CostKind } from "../gen/warehouse/cost/v1/cost_pb";

// costKindLabel is the shared display name for a cost kind — used by the picker below and by callers
// that show a recorded kind read-only (the cost list's rows and its summary cards).
//
// UNSPECIFIED returns "" on purpose: it is not a kind of cost, it is the absence of an answer, and a
// read-only caller falls back to its own empty state.
export function costKindLabel(t: TFunction, kind: CostKind): string {
  switch (kind) {
    case CostKind.ADS:
      return t("costs.kind.ads");
    case CostKind.PAYROLL:
      return t("costs.kind.payroll");
    case CostKind.OPERATIONAL:
      return t("costs.kind.operational");
    case CostKind.OTHER:
      return t("costs.kind.other");
    default:
      return "";
  }
}

// The kinds that can be PICKED. UNSPECIFIED is excluded because it is not a kind of spending — the
// contract refuses it on create, so offering it would be offering a choice the server rejects.
export const COST_KINDS: CostKind[] = [
  CostKind.ADS,
  CostKind.PAYROLL,
  CostKind.OPERATIONAL,
  CostKind.OTHER,
];

// The value used for "any kind" when this picker is a FILTER rather than a form field.
const ANY = "any";

export interface CostKindSelectProps {
  value?: CostKind;
  onChange?: (kind: CostKind) => void;
  /**
   * When true, the picker offers an "any kind" option and UNSPECIFIED means it — for filtering a list.
   * When false (the default) it is a form field and every option is a real kind.
   */
  filter?: boolean;
  placeholder?: string;
  disabled?: boolean;
  /**
   * Distinguishes two instances on ONE page. The costs screen carries this picker twice — once as a
   * list filter, once inside the record form — and a single hardcoded testid makes both the trigger
   * and every option ambiguous, so a test has to select by position and breaks when the order shifts.
   */
  testId?: string;
}

// CostKindSelect is the shared cost-kind picker (#170). It emits a CostKind, so callers work in the
// enum rather than coercing strings at every call site.
//
// Chakra's composable Select, matching PaymentTypeSelect after #165 — a native dropdown does not look
// or behave like the form around it, and Select is already in the bundle.
export const description =
  'Cost-kind picker (Chakra Select). Emits a CostKind. With `filter`, it also offers "any kind" for narrowing a list; without it, every option is a real kind because the contract refuses UNSPECIFIED on create.';

export function CostKindSelect({
  value,
  onChange,
  filter = false,
  placeholder,
  disabled,
  testId = "cost-kind-select",
}: CostKindSelectProps) {
  const { t } = useTranslation();

  const anyLabel = placeholder ?? t("costs.kind.any");

  const collection = useMemo(() => {
    const kinds = COST_KINDS.map((kind) => ({
      label: costKindLabel(t, kind),
      value: String(kind),
    }));

    // The "any" option exists ONLY for the filter. On a form it would be a choice the server refuses,
    // which is worse than not offering it: the person picks it, submits, and is told no.
    return createListCollection({
      items: filter ? [{ label: anyLabel, value: ANY }, ...kinds] : kinds,
    });
  }, [t, filter, anyLabel]);

  const selected = value === undefined || value === CostKind.UNSPECIFIED ? ANY : String(value);

  return (
    <Select.Root
      collection={collection}
      disabled={disabled}
      // On a FORM, an unset value shows the placeholder rather than silently selecting the first kind
      // — picking a kind is the person's decision, and pre-selecting "Ads" would file rent as ads for
      // anybody who did not look.
      value={selected === ANY && !filter ? [] : [selected]}
      onValueChange={(e) => {
        const picked = e.value[0];
        if (picked === undefined) return;

        onChange?.(picked === ANY ? CostKind.UNSPECIFIED : (Number(picked) as CostKind));
      }}
    >
      <Select.HiddenSelect />

      <Select.Control>
        <Select.Trigger data-testid={testId}>
          <Select.ValueText placeholder={filter ? anyLabel : t("costs.kind.choose")} />
        </Select.Trigger>
        <Select.IndicatorGroup>
          <Select.Indicator />
        </Select.IndicatorGroup>
      </Select.Control>

      <Portal>
        <Select.Positioner>
          <Select.Content>
            {collection.items.map((item) => (
              <Select.Item item={item} key={item.value} data-testid={`${testId}-${item.value}`}>
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

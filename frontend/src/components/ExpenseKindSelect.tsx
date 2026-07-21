import { useMemo } from "react";
import { Portal, Select, createListCollection } from "@chakra-ui/react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { ExpenseKind } from "../gen/warehouse/expense/v1/expense_pb";

// expenseKindLabel is the shared display name for a cost kind — used by the picker below and by callers
// that show a recorded kind read-only (the cost list's rows and its summary cards).
//
// UNSPECIFIED returns "" on purpose: it is not a kind of cost, it is the absence of an answer, and a
// read-only caller falls back to its own empty state.
export function expenseKindLabel(t: TFunction, kind: ExpenseKind): string {
  switch (kind) {
    case ExpenseKind.ADS:
      return t("expenses.kind.ads");
    case ExpenseKind.PAYROLL:
      return t("expenses.kind.payroll");
    case ExpenseKind.OPERATIONAL:
      return t("expenses.kind.operational");
    case ExpenseKind.OTHER:
      return t("expenses.kind.other");
    default:
      return "";
  }
}

// The kinds that can be PICKED. UNSPECIFIED is excluded because it is not a kind of spending — the
// contract refuses it on create, so offering it would be offering a choice the server rejects.
export const COST_KINDS: ExpenseKind[] = [
  ExpenseKind.ADS,
  ExpenseKind.PAYROLL,
  ExpenseKind.OPERATIONAL,
  ExpenseKind.OTHER,
];

// The value used for "any kind" when this picker is a FILTER rather than a form field.
const ANY = "any";

export interface ExpenseKindSelectProps {
  value?: ExpenseKind;
  onChange?: (kind: ExpenseKind) => void;
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

// ExpenseKindSelect is the shared cost-kind picker (#170). It emits a ExpenseKind, so callers work in the
// enum rather than coercing strings at every call site.
//
// Chakra's composable Select, matching PaymentTypeSelect after #165 — a native dropdown does not look
// or behave like the form around it, and Select is already in the bundle.
export const description =
  'Cost-kind picker (Chakra Select). Emits a ExpenseKind. With `filter`, it also offers "any kind" for narrowing a list; without it, every option is a real kind because the contract refuses UNSPECIFIED on create.';

export function ExpenseKindSelect({
  value,
  onChange,
  filter = false,
  placeholder,
  disabled,
  testId = "expense-kind-select",
}: ExpenseKindSelectProps) {
  const { t } = useTranslation();

  const anyLabel = placeholder ?? t("expenses.kind.any");

  const collection = useMemo(() => {
    const kinds = COST_KINDS.map((kind) => ({
      label: expenseKindLabel(t, kind),
      value: String(kind),
    }));

    // The "any" option exists ONLY for the filter. On a form it would be a choice the server refuses,
    // which is worse than not offering it: the person picks it, submits, and is told no.
    return createListCollection({
      items: filter ? [{ label: anyLabel, value: ANY }, ...kinds] : kinds,
    });
  }, [t, filter, anyLabel]);

  const selected = value === undefined || value === ExpenseKind.UNSPECIFIED ? ANY : String(value);

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

        onChange?.(picked === ANY ? ExpenseKind.UNSPECIFIED : (Number(picked) as ExpenseKind));
      }}
    >
      <Select.HiddenSelect />

      <Select.Control>
        <Select.Trigger data-testid={testId}>
          <Select.ValueText placeholder={filter ? anyLabel : t("expenses.kind.choose")} />
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

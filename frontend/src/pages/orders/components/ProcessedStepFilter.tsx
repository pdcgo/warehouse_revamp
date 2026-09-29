import { Button, Flex } from "@chakra-ui/react";
import { useTranslation } from "react-i18next";

import { NotImplemented } from "../../../features/pending/NotImplemented";
import { ORDERS_LIST_PENDING } from "../pending";
import { PROCESSED_STEPS } from "../stages";
import type { ProcessedStep } from "../stages";

// NARROWING `processed` TO ONE OF ITS FOUR STEPS (owner).
//
// It appears only while `processed` is the chosen status, because that is the only tab it means
// anything under — a "Packed" filter left hanging over the Shipped tab would be a control filtering
// something nobody is looking at.
//
// ⚠ IT CARRIES NO COUNTS (owner). A per-step count line was built and taken out: what a seller does
// with these is NARROW to one, not read four numbers, and the numbers that matter about the pile are
// already the summary's job. Four more figures beside them would be four more to keep in step.
//
// ⚠ THREE OF THE FOUR REALLY WORK. `confirm`, `picking` and `packed` are each a single enum value, so
// `OrderListFilter.status` can take them and the table genuinely narrows — unlike `processed` itself,
// which is three at once. HANDED OVER has no value at all, so its button is DISABLED rather than
// inert: a control that provably cannot do its job should refuse, not pretend.
//
// ⚠ IT IS "HANDED OVER", NOT "READY TO HAND OVER" (owner) — the parcel HAS changed hands. It is the
// warehouse's last step rather than a queue waiting for one, and `shipped` begins when the parcel
// starts MOVING.
export function ProcessedStepFilter({
  value,
  onChange,
}: {
  /** The chosen step, or undefined for all four. */
  value?: ProcessedStep["id"];
  onChange: (id: ProcessedStep["id"] | undefined) => void;
}) {
  const { t } = useTranslation();

  return (
    <Flex gap="1" wrap="wrap" align="center" data-testid="processed-step-filter">
      <Button
        size="xs"
        variant={value === undefined ? "subtle" : "ghost"}
        colorPalette="gray"
        data-testid="processed-step-filter-all"
        onClick={() => onChange(undefined)}
      >
        {t("orders.step.all")}
      </Button>

      {PROCESSED_STEPS.map((step) => (
        <Button
          key={step.id}
          size="xs"
          variant={value === step.id ? "subtle" : "ghost"}
          colorPalette="gray"
          disabled={step.status === undefined}
          data-testid={`processed-step-filter-${step.id}`}
          onClick={() => onChange(step.id)}
        >
          {t(`orders.step.${step.id}`)}
          {step.status === undefined && <NotImplemented list={ORDERS_LIST_PENDING} id="statusSet" />}
        </Button>
      ))}
    </Flex>
  );
}

import { Badge, Icon } from "@chakra-ui/react";
import { useTranslation } from "react-i18next";
import { TriangleAlert } from "lucide-react";

import type { PendingId } from "../pending";
import { pendingNumber } from "../pending";

// THE MARK ON A CARD THAT IS AHEAD OF THE SYSTEM — an icon and a NUMBER, and nothing else (owner).
//
// The number is the row it points at in the list at the top of the screen. That is the whole design:
// the explanation is written ONCE, where somebody reads it before they start, and each card carries a
// pointer into it. Repeating the sentence on every card put four lines of build-status text between
// the person and the form they were trying to read.
//
// A card with three unwired parts therefore shows three small numbers — legible in a way three
// stacked sentences were not.
//
// ⚠ A WARNING SHAPE, IN A NEUTRAL COLOUR. The triangle is the owner's (it reads as "careful" at a
// glance); the gray is deliberate. Amber and red on this screen already mean a short line, a creditor
// near its limit, and a margin under 35% — a build-status mark in the same palette would make the
// three real alarms unreadable. Shape carries the attention, colour stays out of the way.
//
// The label and the reason ride in `title`, so hovering answers "which one is 7?" without a trip to
// the top — a convenience, never the only route, which is why the number is what is painted.
export function NotImplemented({ id }: { id: PendingId }) {
  const { t } = useTranslation();

  const n = pendingNumber(id);
  const label = t(`orderForm.pending.${id}.label`);

  return (
    <Badge
      variant="outline"
      colorPalette="gray"
      borderStyle="dashed"
      size="sm"
      gap="1"
      title={`${n}. ${label} — ${t(`orderForm.pending.${id}.reason`)}`}
      aria-label={t("orderForm.markAria", { n, label })}
      data-testid={`not-implemented-${id}`}
    >
      <Icon as={TriangleAlert} boxSize="3" />
      {n}
    </Badge>
  );
}

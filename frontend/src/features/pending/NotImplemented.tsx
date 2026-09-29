import { Badge, Icon } from "@chakra-ui/react";
import { useTranslation } from "react-i18next";
import { TriangleAlert } from "lucide-react";

import type { PendingList } from "./registry";
import { pendingNumber } from "./registry";

// THE MARK ON A CARD THAT IS AHEAD OF THE SYSTEM — an icon and a NUMBER, and nothing else (owner).
//
// The number is the row it points at in the summary at the top of the screen. That is the whole
// design: the explanation is written ONCE, where somebody reads it before they start, and each
// control carries a pointer into it. Repeating the sentence beside every field put four lines of
// build-status text between the person and the form they were trying to read.
//
// ⚠ A WARNING SHAPE, IN A NEUTRAL COLOUR. The triangle reads as "careful" at a glance; the gray is
// deliberate. Amber and red on these screens already mean something true about the ORDER — a short
// line, a creditor near its limit, a margin under the floor — and a build-status mark in the same
// palette makes the real alarms unreadable. Shape carries the attention, colour stays out of the way.
export function NotImplemented<Id extends string>({
  list,
  id,
}: {
  list: PendingList<Id>;
  id: Id;
}) {
  const { t } = useTranslation();

  const n = pendingNumber(list, id);
  const label = t(`${list.ns}.pending.${id}.label`);

  return (
    <Badge
      variant="outline"
      colorPalette="gray"
      borderStyle="dashed"
      size="sm"
      gap="1"
      // The label and the reason ride in `title`, so hovering answers "which one is 7?" without a
      // trip to the top — a convenience, never the only route, which is why the number is painted.
      title={`${n}. ${label} — ${t(`${list.ns}.pending.${id}.reason`)}`}
      aria-label={t("pending.markAria", { n, label })}
      data-testid={`not-implemented-${id}`}
    >
      <Icon as={TriangleAlert} boxSize="3" />
      {n}
    </Badge>
  );
}

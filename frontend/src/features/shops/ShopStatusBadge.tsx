import { useTranslation } from "react-i18next";
import { Badge, Icon } from "@chakra-ui/react";
import { Lock } from "lucide-react";

import { formatUnixDate } from "../../lib/datetime";

export const description =
  "A closed shop's badge (a-shop-is-closed-never-deleted) — Closed, in the plain gray tone with a lock, optionally with the day it closed. An open shop gets no badge: open is the normal case, and the list shows open shops by default.";

// A CLOSED SHOP SAYS SO wherever it is listed or opened: under its
// name on the shops list, beside the title of its page, and on a picker's option that may still offer it (the statement
// import). Gray — closed is a state, not a warning: its payouts and grants still work (a-closed-shop-refuses-only-new-
// selling). The lock says what changed: the shop is locked against new selling and against edits
// (a-closed-shop-locks-all-but-its-grants).
export function ShopStatusBadge({
  closedAtUnix,
  size = "sm",
  testId,
}: {
  /** When it closed (unix seconds) — shown as "Closed · 3 Nov 2026"; absent or 0 shows "Closed" alone. */
  closedAtUnix?: bigint;
  size?: "xs" | "sm" | "md";
  testId?: string;
}) {
  const { t } = useTranslation();
  const since = closedAtUnix !== undefined && closedAtUnix > 0n ? formatUnixDate(closedAtUnix) : "";

  return (
    <Badge colorPalette="gray" variant="subtle" size={size} data-testid={testId} flexShrink={0}>
      <Icon as={Lock} boxSize="3" />
      {since ? t("shops.status.closedOn", { date: since }) : t("shops.status.closed")}
    </Badge>
  );
}

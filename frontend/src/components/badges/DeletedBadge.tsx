import { Badge, type BadgeProps } from "@chakra-ui/react";
import { useTranslation } from "react-i18next";

// DeletedBadge marks a record that has been deleted but is still shown — because something that happened before the
// delete still names it. A restock line keeps its supplier and store after either is gone
// (a-deleted-supplier-still-shows-with-a-badge): the name stays readable, and this says why it is no longer pickable.
//
// Muted rather than red: a deleted supplier is history, not an error — the line is still right about where it was
// bought.
export const description =
  "Marks a deleted record that is still shown because history names it — a restock line's deleted supplier or store. Muted, never an error colour.";

export function DeletedBadge(props: Omit<BadgeProps, "children">) {
  const { t } = useTranslation();

  return (
    <Badge colorPalette="gray" variant="outline" size="sm" data-testid="deleted-badge" {...props}>
      {t("common.deleted")}
    </Badge>
  );
}

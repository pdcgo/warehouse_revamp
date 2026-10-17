import { useTranslation } from "react-i18next";
import { Icon, SegmentGroup } from "@chakra-ui/react";
import { LayoutGrid, Table as TableIcon } from "lucide-react";

export type DiscoverView = "cards" | "table";

// CARDS OR A TABLE — Discover's two views (`discover-is-cards-or-a-table`), cards first. A segmented choice, drawn as
// every segmented choice in the app (a-segmented-choice-is-in-the-main-tone): a field's height, the chosen segment pale
// rose, an icon per option — both options seen at once, since the choice reframes everything under it.
export function DiscoverViewSwitch({ value, onChange }: { value: DiscoverView; onChange: (view: DiscoverView) => void }) {
  const { t } = useTranslation();

  return (
    <SegmentGroup.Root
      value={value}
      // Ark emits null when the chosen segment is clicked again — a view has no "off", so that is ignored.
      onValueChange={(e) => onChange((e.value as DiscoverView | null) ?? value)}
      aria-label={t("suppliers.discover.view.label")}
      data-testid="discover-suppliers-view"
    >
      <SegmentGroup.Indicator />
      <SegmentGroup.Item value="cards" data-testid="discover-suppliers-view-cards">
        <Icon as={LayoutGrid} boxSize="3.5" />
        <SegmentGroup.ItemText>{t("suppliers.discover.view.cards")}</SegmentGroup.ItemText>
        <SegmentGroup.ItemHiddenInput />
      </SegmentGroup.Item>
      <SegmentGroup.Item value="table" data-testid="discover-suppliers-view-table">
        <Icon as={TableIcon} boxSize="3.5" />
        <SegmentGroup.ItemText>{t("suppliers.discover.view.table")}</SegmentGroup.ItemText>
        <SegmentGroup.ItemHiddenInput />
      </SegmentGroup.Item>
    </SegmentGroup.Root>
  );
}

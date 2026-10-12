import { Stack, Text } from "@chakra-ui/react";
import { Boxes, MapPin, Store } from "lucide-react";
import { MarketplaceBadge } from "../../../../components/badges/MarketplaceBadge";
import { DataTable, type TableColumn } from "../../../components/display/DataTable";
import { ListSummary } from "../../../components/display/ListSummary";
import { PopBox } from "../../../components/feedback/PopBox";
import type { SupplierMarketplaceRow, SupplierRow } from "../../../fixtures";

// A supplier's detail is a PANEL, not a page — the one decision from the legacy screen most worth
// preserving.
//
// What a person actually does here is check a supplier against the row they were just reading:
// which marketplaces does this one sell on, is the shop I am looking at really theirs. That is a
// question asked WHILE working through the list, and a full page would take the list's filters,
// scroll position and page with it on the way there and back.
//
// A route would be right if the supplier were the destination. It is not; the list is.
export const description =
  "A supplier's marketplace accounts in a side panel — checked against the row you were already reading, so the list keeps its filters, scroll and page.";

export interface SupplierDetailPanelProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  supplier?: SupplierRow;
  marketplaces: SupplierMarketplaceRow[];
}

export function SupplierDetailPanel({
  open,
  onOpenChange,
  supplier,
  marketplaces,
}: SupplierDetailPanelProps) {
  const columns: Array<TableColumn<SupplierMarketplaceRow>> = [
    {
      name: "Marketplace",
      render: (row) => <MarketplaceBadge marketplace={row.marketplace} size="sm" />,
    },
    { name: "Shop", key: "shopName" },
  ];

  return (
    <PopBox
      open={open}
      onOpenChange={onOpenChange}
      size="md"
      title={supplier?.name ?? "Supplier"}
    >
      <Stack gap="section" data-testid="supplier-detail">
        <ListSummary
          items={[
            {
              icon: MapPin,
              content: <Text>{[supplier?.city, supplier?.province].filter(Boolean).join(", ")}</Text>,
              tooltip: "Ships from",
            },
            {
              icon: Store,
              content: <Text>{supplier?.marketplaceCount ?? 0} shops</Text>,
              tooltip: "Marketplace accounts",
            },
            {
              icon: Boxes,
              content: <Text>{supplier?.productCount ?? 0} products</Text>,
              tooltip: "Products sourced here",
            },
          ]}
        />

        <DataTable
          columns={columns}
          items={marketplaces}
          size="sm"
          emptyTitle="No marketplace accounts"
          emptyContent="This supplier has not been linked to a storefront yet."
          aria-label="Marketplace accounts"
        />
      </Stack>
    </PopBox>
  );
}

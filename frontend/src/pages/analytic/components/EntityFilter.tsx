import { Tag } from "@chakra-ui/react";
import { useTranslation } from "react-i18next";

import { ProductSelect } from "../../../components/products/ProductSelect";
import { SupplierSearchSelect } from "../../../components/pickers/SupplierSearchSelect";
import { SupplierSelect } from "../../../components/pickers/SupplierSelect";
import { type ProductSearchScope, useProductsByIds } from "../../../features/products/queries";
import { useSuppliersByIds } from "../../../features/suppliers/queries";
import { TeamType } from "../../../gen/warehouse/team/v1/team_pb";

/** The two filters that name a product or a supplier — read only by Lost stock today (metrics/inventory/lost). */
export type EntityFilterKind = "product" | "supplier";

/**
 * WHICH PRODUCTS THE FILTER SEARCHES, by the reading team — the search each team may already run elsewhere:
 * a warehouse what it holds or has held, any seller's (WarehouseProductSearch, a-warehouse-picks-only-what-it-has-held —
 * a warehouse's losses are only ever of those); a seller its own catalogue (ProductList — a seller's losses are only
 * ever of its own stock); root, and the admin team, every team's (ProductDiscover). A warehouse may not discover.
 */
export function productScopeOf(teamType: TeamType | undefined): ProductSearchScope {
  if (teamType === TeamType.WAREHOUSE) return "warehouse";
  if (teamType === TeamType.SELLING) return "team";

  return "all";
}

export interface EntityFilterProps {
  kind: EntityFilterKind;
  /** The reading team — the scope every read is authorised in. */
  teamId: bigint;
  teamType: TeamType | undefined;
  /** The chosen id as the URL carries it; "" = every one. */
  value: string;
  onChange: (id: string) => void;
  placeholder: string;
  /** The filter's own name, for the chip's remove button. */
  label: string;
  /** False inside the phone's filter sheet, a modal Drawer: a portalled list would land outside it, inert. */
  portalled?: boolean;
}

// EntityFilter — the Analytic composer's PRODUCT and SUPPLIER filters, over the team's real entities (backlog #19, which
// replaced the sample entries). Nothing chosen, it is the app's own searchable picker; chosen, it is a CHIP naming the
// pick by the by-ids lookup the rows use (ProductByIds / SupplierByIds — any team's, archived or deleted ones included),
// so a link or a refresh opened with `product=205` reads "Sepatu Kanvas", never an empty search box. The chip's × reads
// every one again. One id each: the contract's ProductFilter and SupplierFilter name one (a-filter-names-one-id-and-
// shares-its-types-number).
//
// Suppliers: a seller picks from its own (SupplierSelect, the whole list); a team with none of its own — a warehouse,
// whose shelves hold several sellers' stock, each batch naming its seller's supplier, or root — searches every team's
// (SupplierSearchSelect), each option naming the team that keeps it.
export function EntityFilter({ kind, teamId, teamType, value, onChange, placeholder, label, portalled = true }: EntityFilterProps) {
  const { t } = useTranslation();
  const id = value ? BigInt(value) : 0n;

  const products = useProductsByIds({ teamId, productIds: kind === "product" && id > 0n ? [id] : [] });
  const suppliers = useSuppliersByIds({ teamId, supplierIds: kind === "supplier" && id > 0n ? [id] : [] });

  if (id > 0n) {
    const name = kind === "product" ? products.data?.get(value)?.name : suppliers.data?.get(value)?.name;

    return (
      <Tag.Root size="lg" variant="surface" w="full" h="10" justifyContent="space-between" data-testid={`analytic-${kind}-chip`}>
        <Tag.Label title={name}>{name ?? `#${value}`}</Tag.Label>
        <Tag.EndElement>
          <Tag.CloseTrigger
            aria-label={t("analytic.removeFilter", { filter: label })}
            onClick={() => onChange("")}
            data-testid={`analytic-${kind}-chip-remove`}
          />
        </Tag.EndElement>
      </Tag.Root>
    );
  }

  if (kind === "product") {
    return (
      <ProductSelect
        teamId={teamId}
        scope={productScopeOf(teamType)}
        onChange={(p) => onChange(p.id.toString())}
        placeholder={placeholder}
        portalled={portalled}
      />
    );
  }

  if (teamType === TeamType.SELLING) {
    return (
      <SupplierSelect
        teamId={teamId}
        onChange={(picked) => onChange(picked > 0n ? picked.toString() : "")}
        placeholder={placeholder}
        portalled={portalled}
      />
    );
  }

  return (
    <SupplierSearchSelect
      teamId={teamId}
      onChange={(s) => onChange(s.id.toString())}
      placeholder={placeholder}
      portalled={portalled}
    />
  );
}

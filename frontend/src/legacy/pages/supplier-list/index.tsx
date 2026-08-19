import { useMemo, useState } from "react";
import { Heading, HStack, Stack } from "@chakra-ui/react";
import { Pencil, Plus, Trash2, Eye } from "lucide-react";
import { ActionCell } from "../../components/cells/ActionCell";
import { DateCell } from "../../components/cells/DateCell";
import { SupplierCell } from "../../components/cells/SupplierCell";
import { DataTable, type TableColumn, type TableSort } from "../../components/display/DataTable";
import { Button } from "../../components/inputs/Button";
import { SearchInput } from "../../components/inputs/SearchInput";
import { Pagination } from "../../../components/chrome/Pagination";
import type { SupplierRow } from "../../fixtures";
import { SupplierDetailPanel } from "./components/SupplierDetailPanel";
import { SupplierFilters } from "./components/SupplierFilters";
import { SupplierFormDialog } from "./components/SupplierFormDialog";
import type { SupplierMarketplaceRow } from "../../fixtures";

// ── THE SUPPLIER LIST — a legacy screen, ported as a REFERENCE ───────────────────────────────────
//
// The original was 24 files: a page, a context provider, a dataview, an action set, a query-string
// binding, a section wrapper and one file per dialog. Most of that was DATA PLUMBING for a backend
// this repo does not have, so it is gone; what is ported is the SCREEN — its shape, its controls and
// the decisions embedded in them.
//
// ⚠ IT DOES NOT FETCH. Rows arrive as props and the story supplies them. That is deliberate for a
// reference screen (see legacy/fixtures.ts) — and it is also what a promotion would build on: adding
// a `features/suppliers/queries.ts` hook above this is additive, where unpicking a fetch from inside
// it would not be.
//
// What the original screen actually decided, and is preserved here:
//
//  1. THE LIST IS THE SCREEN, and every action happens over it — create and edit in a dialog, detail
//     in a side panel. You never leave the list, because the job is working THROUGH suppliers, not
//     visiting one.
//  2. DETAIL IS A PANEL, NOT A PAGE. A supplier's detail is mostly its marketplace accounts, which
//     you check against the row you were already reading. A full page would lose the list's filters
//     and scroll on the way back.
//  3. FILTERS ARE GEOGRAPHIC. Suppliers are chosen by where they ship from, so province and city are
//     the primary narrowing — not the name.
export const description =
  "The legacy supplier list, ported as a reference screen: a filtered table with create/edit in a dialog and detail in a side panel, so the operator never leaves the list. Takes its rows as props — it does not fetch.";

export interface SupplierListPageProps {
  suppliers: SupplierRow[];
  // The marketplace accounts of whichever supplier is open in the detail panel.
  marketplaces?: SupplierMarketplaceRow[];
  loading?: boolean;
  isError?: boolean;
}

export function SupplierListPage({
  suppliers,
  marketplaces = [],
  loading,
  isError,
}: SupplierListPageProps) {
  const [search, setSearch] = useState("");
  const [province, setProvince] = useState<string>();
  const [city, setCity] = useState<string>();
  const [sort, setSort] = useState<TableSort>();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const [editing, setEditing] = useState<SupplierRow | null>(null);
  const [creating, setCreating] = useState(false);
  const [detail, setDetail] = useState<SupplierRow | null>(null);

  // Filtering and sorting run in the browser because there is no server to ask. A promoted version
  // pushes both into the RPC — which is why they are expressed as plain state above rather than
  // baked into the rows.
  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();

    const filtered = suppliers.filter((s) => {
      if (q && !s.name.toLowerCase().includes(q) && !s.code.toLowerCase().includes(q)) return false;
      if (province && s.province !== province) return false;
      if (city && s.city !== city) return false;
      return true;
    });

    if (!sort?.key) return filtered;

    const direction = sort.desc ? -1 : 1;
    return [...filtered].sort((a, b) => {
      const av = a[sort.key as keyof SupplierRow];
      const bv = b[sort.key as keyof SupplierRow];
      if (av === bv) return 0;
      return (av > bv ? 1 : -1) * direction;
    });
  }, [suppliers, search, province, city, sort]);

  const paged = rows.slice((page - 1) * pageSize, page * pageSize);

  const columns: Array<TableColumn<SupplierRow>> = [
    {
      name: "Supplier",
      sortKey: "name",
      sticky: "left",
      render: (row) => <SupplierCell supplier={row} />,
    },
    { name: "Province", key: "province", sortKey: "province" },
    { name: "City", key: "city" },
    { name: "Shops", key: "marketplaceCount", align: "end", sortKey: "marketplaceCount" },
    { name: "Products", key: "productCount", align: "end", sortKey: "productCount" },
    {
      name: "Added",
      sortKey: "createdAt",
      render: (row) => <DateCell value={row.createdAt} grain="date" />,
    },
    {
      name: "",
      width: "1%",
      sticky: "right",
      render: (row) => (
        <ActionCell
          items={[
            { title: "View", icon: Eye, onAction: () => setDetail(row) },
            { title: "Edit", icon: Pencil, onAction: () => setEditing(row) },
            { title: "Delete", icon: Trash2, tone: "error" },
          ]}
        />
      ),
    },
  ];

  return (
    <Stack gap="section" data-testid="supplier-list-page">
      <HStack justify="space-between" wrap="wrap" gap="card">
        <Heading size="md">Suppliers</Heading>
        <Button icon={Plus} onClick={() => setCreating(true)} data-testid="supplier-create">
          New Supplier
        </Button>
      </HStack>

      <HStack gap="card" wrap="wrap" align="center">
        <SearchInput
          value={search}
          onChange={(v) => {
            setSearch(v);
            // Any narrowing returns to page 1 — staying on page 4 of a list that now has one page
            // shows an empty table and reads as "no results".
            setPage(1);
          }}
          placeholder="Search name or code"
          maxW="64"
        />
        <SupplierFilters
          province={province}
          city={city}
          onProvinceChange={(p) => {
            setProvince(p);
            // The city list depends on the province, so a province change drops a city that is no
            // longer in it — the same rule ShopSelect follows for a filtered marketplace.
            setCity(undefined);
            setPage(1);
          }}
          onCityChange={(c) => {
            setCity(c);
            setPage(1);
          }}
        />
      </HStack>

      <DataTable
        columns={columns}
        items={paged}
        loading={loading}
        isError={isError}
        sort={sort}
        onSort={setSort}
        headerSticky
        emptyTitle="No suppliers match this filter"
        emptyContent="Try a wider province, or clear the search."
        errorTitle="Could not load suppliers"
        aria-label="Suppliers"
      />

      <Pagination
        count={rows.length}
        page={page}
        pageSize={pageSize}
        onPageChange={setPage}
        pageSizeOptions={[10, 20, 50]}
        onPageSizeChange={(size) => {
          setPageSize(size);
          setPage(1);
        }}
        showRange
      />

      <SupplierFormDialog
        open={creating || editing !== null}
        supplier={editing ?? undefined}
        onOpenChange={(open) => {
          if (!open) {
            setCreating(false);
            setEditing(null);
          }
        }}
      />

      <SupplierDetailPanel
        supplier={detail ?? undefined}
        marketplaces={marketplaces}
        open={detail !== null}
        onOpenChange={(open) => !open && setDetail(null)}
      />
    </Stack>
  );
}

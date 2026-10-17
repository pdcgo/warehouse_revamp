import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { Badge, Box, Button, Flex, HStack, Heading, Icon, Spinner, Stack, Table, Text } from "@chakra-ui/react";
import { Pencil, Trash2 } from "lucide-react";
import { rpcError } from "../../api/clients";
import { Marketplace } from "../../gen/warehouse/marketplace/v1/marketplace_pb";
import { TeamType } from "../../gen/warehouse/team/v1/team_pb";
import { useTeam } from "../../features/team/TeamContext";
import { ChannelTypes } from "../../features/suppliers/ChannelTypes";
import {
  type ManagedSupplier,
  type SupplierSortKey,
  useDeleteSupplier,
  useSuppliers,
} from "../../features/suppliers/queries";
import { useIsMobile } from "../../layouts/shell";
import { useDebounced } from "../../lib/useDebounced";
import { ConfirmDialog } from "../../components/feedback/ConfirmDialog";
import { FilterBar, FilterField, FilterSearch } from "../../components/chrome/FilterBar";
import { GrowingPager } from "../../components/chrome/GrowingPager";
import { SortableHeader, type SortState } from "../../components/chrome/SortableHeader";
import { RefreshOverlay } from "../../components/feedback/RefreshOverlay";
import { toaster } from "../../components/feedback/Toaster";
import { MarketplaceSelect } from "../../components/pickers/MarketplaceSelect";
import { SupplierFormDialog } from "../../features/suppliers/SupplierFormDialog";
import { SupplierSortSelect } from "./components/SupplierSortSelect";

const PAGE_SIZE_OPTIONS = [10, 20, 50];

// A ROW LIGHTS UP UNDER THE POINTER (owner: *"hoverable"*, `a-supplier-row-lights-up`) — as the account's statement does:
// set on every cell, by Chakra's `_hover`, which a story can drive with `data-hover`.
const LIGHTS_UP = { _hover: { "& > td": { bg: "bg.muted" } } } as const;

// SuppliersPage manages the CURRENT team's suppliers — the vendors it buys stock from
// (docs/business/supplier, manage-and-discover-are-two-pages: this is the MANAGE page; searching every team's
// suppliers is Discover Suppliers, a page of its own).
//
// Only a selling team has suppliers (only-a-selling-team-has-suppliers), so only a selling team gets New,
// Edit and Delete. Every RPC carries `current.teamId` in its body — the team is the scope.
//
// THE SCREEN RULES (owner: *"sekarang ke suppliers, coba terapkan keputusan"*, `the-suppliers-list-follows-the-screen-rules`):
//
//   Pemasok  [Toko Melati]                                   [+ Tambah Pemasok]
//   Pemasok yang dikelola tim ini — …
//   [⌕ Cari pemasok, alamat, atau toko] [Semua jenis toko ⌄]   Hapus filter   ← the shared FilterBar
//   Pemasok ⇅           · Toko pemasok     · Kontak        · [✎ Ubah] [🗑 Hapus]   ← the name sorts, A to Z first
//   PT Sumber Makmur      [Shopee] ×2        0812-…
//   Jl. Kopo 9, Bandung
//                                            Per halaman [20 ⌄]  ‹ [1] ›          ← the growing pager
//
// The columns are Discover's, minus the team — the supplier and where it is, two lines; its stores as one badge per
// type (ChannelTypes, shared); its contact. On a phone a supplier is a block, and the sort is the Filter sheet's.
export function SuppliersPage() {
  const { current } = useTeam();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const canManage = current?.teamType === TeamType.SELLING;

  const [q, setQ] = useState("");
  const [channelType, setChannelType] = useState<Marketplace>(Marketplace.UNSPECIFIED);
  // `null` = the list's own order, newest first — no heading stands for it.
  const [sort, setSort] = useState<SortState<SupplierSortKey> | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [editing, setEditing] = useState<ManagedSupplier | null>(null);

  // Typed, then settled — a word is one request to the server, not one per key.
  const term = useDebounced(q.trim());
  const filtering = (q.trim() !== "" ? 1 : 0) + (channelType !== Marketplace.UNSPECIFIED ? 1 : 0);
  // What the rows on screen were asked with, which is what "nothing matches" is about.
  const narrowed = term !== "" || channelType !== Marketplace.UNSPECIFIED;

  const teamId = current?.teamId;

  const query = useSuppliers({ teamId, q: term, channelType, sort, page, pageSize });
  const deleteSupplier = useDeleteSupplier();

  const suppliers = query.data?.suppliers ?? [];
  const totalItems = query.data?.totalItems ?? 0;
  const loading = query.isPending;
  const error = query.isError ? rpcError(query.error) : "";

  // A filter or a sort is a new question, so it starts again at page one.
  function refilter(change: () => void) {
    change();
    setPage(1);
  }
  const sortBy = (next: SortState<SupplierSortKey> | null) => refilter(() => setSort(next));

  // `mutateAsync`, not `mutate`, because ConfirmDialog AWAITS its onConfirm to hold the button in its
  // loading state — a fire-and-forget `mutate` would resolve instantly and the dialog would close
  // while the delete was still in flight. mutateAsync REJECTS on failure, so the catch is not optional
  // here the way it would be with mutate's onError.
  async function remove(supplier: ManagedSupplier) {
    if (teamId === undefined) {
      return;
    }

    try {
      await deleteSupplier.mutateAsync({ teamId, supplierId: supplier.id });
      toaster.create({ type: "success", title: t("suppliers.deleted", { name: supplier.name }) });
    } catch (err) {
      toaster.create({ type: "error", title: t("suppliers.deleteFailed"), description: rpcError(err) });
    }
  }

  // No current team means there is no scope to list against — the whole page is meaningless.
  if (!current) {
    return (
      <Stack gap="section">
        <Heading size="md">{t("suppliers.title")}</Heading>
        <Text color="fg.muted" data-testid="suppliers-no-team">
          {t("suppliers.selectTeam")}
        </Text>
      </Stack>
    );
  }

  // Edit and Delete, the same pair on a table row and on a phone block. Two actions stay inline — each a LABELLED button
  // (owner: *"actionnya kasih label"*, `a-supplier-action-is-labelled`), as the accounts list's row buttons are.
  function actions(supplier: ManagedSupplier) {
    return (
      <HStack justify="end" gap="1.5">
        <Button
          size="xs"
          variant="outline"
          data-testid={`edit-supplier-${supplier.id}`}
          onClick={() => setEditing(supplier)}
        >
          <Icon as={Pencil} boxSize="4" />
          {t("suppliers.editAction")}
        </Button>

        <ConfirmDialog
          title={t("suppliers.deleteSupplier")}
          // A soft delete (a-deleted-supplier-is-kept-for-its-figures): gone from this list and every picker, kept for past restocks and the figures.
          message={t("suppliers.deleteConfirm", { name: supplier.name })}
          confirmLabel={t("suppliers.delete")}
          onConfirm={() => remove(supplier)}
          trigger={
            <Button size="xs" variant="outline" colorPalette="error" data-testid={`delete-supplier-${supplier.id}`}>
              <Icon as={Trash2} boxSize="4" />
              {t("suppliers.delete")}
            </Button>
          }
        />
      </HStack>
    );
  }

  const open = (supplier: ManagedSupplier) => navigate(`/inventories/suppliers/${supplier.id}`);

  function list() {
    if (suppliers.length === 0 && !error) {
      return (
        <Text color="fg.muted" data-testid={narrowed ? "suppliers-none-match" : "suppliers-empty"}>
          {narrowed ? t("suppliers.none") : t("suppliers.empty")}
        </Text>
      );
    }

    if (isMobile) {
      // A PHONE READS EACH SUPPLIER AS A BLOCK (`a-phone-reads-each-line-as-a-block`): the name at full width, then its
      // stores — never three clamped columns. The sort is the Filter sheet's. No contact and no address (owner:
      // *"suppliers mobil tidak perlu kontak dan alamat"*, `a-phone-supplier-is-its-name-and-stores`): the block is for
      // finding the supplier, and its page carries both.
      return (
        <Stack gap="2" data-testid="suppliers-table">
          {suppliers.map((supplier) => (
            <Stack
              key={supplier.id.toString()}
              data-testid={`supplier-row-${supplier.id}`}
              borderWidth="1px"
              borderRadius="md"
              p="3"
              gap="1.5"
              cursor="pointer"
              // The block lights up too — under a pointer, and while a thumb presses it.
              _hover={{ bg: "bg.muted" }}
              _active={{ bg: "bg.muted" }}
              onClick={() => open(supplier)}
            >
              <Text fontWeight="bold">{supplier.name}</Text>
              {/* A store-less supplier SAYS so, in words (owner: *"tidak ada toko tertaut tulis teks"*) — the line is
                  never skipped and never a bare dash. */}
              {supplier.channels.length > 0 ? (
                <ChannelTypes channels={supplier.channels} />
              ) : (
                <Text fontSize="sm" color="fg.muted" data-testid={`supplier-row-${supplier.id}-no-stores`}>
                  {t("suppliers.noStores")}
                </Text>
              )}
              {/* The labelled buttons at the block's FOOT — beside the name they squeezed it into a narrow column. */}
              {canManage && (
                <Box pt="1" onClick={(e) => e.stopPropagation()}>
                  {actions(supplier)}
                </Box>
              )}
            </Stack>
          ))}
        </Stack>
      );
    }

    return (
      <Table.Root size="sm" data-testid="suppliers-table">
        <Table.Header>
          <Table.Row>
            {/* THE SORT IS IN THE HEADING (`a-table-sorts-from-its-headings`) — the one the contract can order by, A to
                Z first. Its stores and contact would mean nothing in order. */}
            <SortableHeader
              column="name"
              label={t("suppliers.table.supplier")}
              sort={sort}
              onSortChange={sortBy}
              firstDir="asc"
              testId="supplier-sort-name"
            />
            <Table.ColumnHeader>{t("suppliers.table.channels")}</Table.ColumnHeader>
            <Table.ColumnHeader>{t("suppliers.table.contact")}</Table.ColumnHeader>
            {canManage && <Table.ColumnHeader textAlign="end">{t("suppliers.table.actions")}</Table.ColumnHeader>}
          </Table.Row>
        </Table.Header>

        <Table.Body>
          {suppliers.map((supplier) => (
            <Table.Row
              key={supplier.id.toString()}
              data-testid={`supplier-row-${supplier.id}`}
              cursor="pointer"
              css={LIGHTS_UP}
              onClick={() => open(supplier)}
            >
              <Table.Cell>
                {/* Two lines, one context: the supplier, and where it is — as on Discover. */}
                <Stack gap="0">
                  <Text fontWeight="bold">{supplier.name}</Text>
                  <Text fontSize="xs" color="fg.muted" lineClamp={1}>
                    {supplier.address || "—"}
                  </Text>
                </Stack>
              </Table.Cell>
              <Table.Cell>
                <ChannelTypes channels={supplier.channels} />
              </Table.Cell>
              <Table.Cell>{supplier.contact || "—"}</Table.Cell>

              {canManage && (
                // Stop the row's navigate from firing when a row action is used.
                <Table.Cell textAlign="end" onClick={(e) => e.stopPropagation()}>
                  {actions(supplier)}
                </Table.Cell>
              )}
            </Table.Row>
          ))}
        </Table.Body>
      </Table.Root>
    );
  }

  return (
    <Stack gap="section" data-testid="suppliers-page">
      <Flex align="start" gap="card" wrap="wrap">
        {/* The title block takes a basis, so New Supplier wraps under it rather than squeezing it. */}
        <Stack gap="1" flex="1 1 16rem" minW="0">
          <HStack gap="card" wrap="wrap">
            <Heading size="md">{t("suppliers.title")}</Heading>
            <Badge colorPalette="brand">{current.teamName || `Team #${current.teamId}`}</Badge>
          </HStack>
          <Text color="fg.muted" fontSize="sm">
            {t("suppliers.lead")}
          </Text>
        </Stack>
        {canManage && <SupplierFormDialog />}
      </Flex>

      {!canManage && (
        <Text color="fg.muted" data-testid="suppliers-selling-only">
          {t("suppliers.sellingOnly")}
        </Text>
      )}

      {/* THE SHARED FILTER STRIP (`a-phone-filters-from-a-sheet`, `clear-filters-is-red-and-bold`) — the search stays in
          the row on a phone; the store type, and the sort, are in the sheet. */}
      <FilterBar
        testId="suppliers-filter"
        active={filtering > 0}
        count={filtering}
        onClear={() =>
          refilter(() => {
            setQ("");
            setChannelType(Marketplace.UNSPECIFIED);
          })
        }
      >
        <FilterSearch
          value={q}
          onChange={(value) => refilter(() => setQ(value))}
          placeholder={t("suppliers.search")}
          testId="supplier-search"
        />

        {/* "Which of ours sell on Shopee?" — seven types, static, a plain list. Empty = any type. */}
        <FilterField w="15rem" testId="suppliers-type-filter">
          <MarketplaceSelect
            value={channelType}
            placeholder={t("suppliers.typeAll")}
            onChange={(m) => refilter(() => setChannelType(m))}
          />
        </FilterField>

        {isMobile && (
          <FilterField testId="suppliers-sort-field">
            <SupplierSortSelect value={sort} onChange={sortBy} />
          </FilterField>
        )}
      </FilterBar>

      {error && (
        <Text color="error.fg" data-testid="suppliers-error">
          {error}
        </Text>
      )}

      {loading ? (
        <Spinner colorPalette="brand" />
      ) : (
        <RefreshOverlay busy={query.isFetching && !query.isPending}>{list()}</RefreshOverlay>
      )}

      {/* THE PAGES GROW AS THEY ARE OPENED, as on the accounts list and the report. */}
      <GrowingPager
        page={page}
        onPageChange={setPage}
        hasNext={query.isPlaceholderData ? undefined : page * pageSize < totalItems}
        resetKey={[term, channelType, sort ? `${sort.by}:${sort.dir}` : "", pageSize].join("|")}
        pageSize={pageSize}
        pageSizeOptions={PAGE_SIZE_OPTIONS}
        onPageSizeChange={(n) => {
          setPageSize(n);
          setPage(1);
        }}
        testId="suppliers-pager"
      />

      {/* One edit dialog, driven by the row's Edit action. Keyed so it re-initialises per supplier. */}
      {editing && (
        <SupplierFormDialog
          key={editing.id.toString()}
          supplier={editing}
          open
          onOpenChange={(o) => {
            if (!o) setEditing(null);
          }}
        />
      )}
    </Stack>
  );
}

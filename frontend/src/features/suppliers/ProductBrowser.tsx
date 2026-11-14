import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Box, Button, HStack, Stack, Table, Text } from "@chakra-ui/react";
import { Package, SearchX, Warehouse } from "lucide-react";
import { rpcError } from "../../api/clients";
import type { SupplierChannelRecord } from "./adapt";
import { ChannelName, LIGHTS_UP } from "./ChannelBrowser";
import { NO_STORE, type SupplierProductRow, useSupplierProductPage } from "./products";
import { TeamType } from "../../gen/warehouse/team/v1/team_pb";
import { formatUnixDate } from "../../lib/datetime";
import { useDebounced } from "../../lib/useDebounced";
import { idCodec, textCodec, type UrlCodec, useUrlState } from "../../lib/urlState";
import { useIsMobile } from "../../layouts/shell";
import { FilterBar, FilterField, FilterSearch } from "../../components/chrome/FilterBar";
import { GrowingPager } from "../../components/chrome/GrowingPager";
import { RefreshOverlay } from "../../components/feedback/RefreshOverlay";
import { EmptyHint } from "../../components/feedback/EmptyHint";
import { ListSkeleton } from "../../components/feedback/ListSkeleton";
import { MarketplaceBadge } from "../../components/badges/MarketplaceBadge";
import { ProductListItem } from "../../components/products/ProductListItem";
import { TeamItem } from "../../components/entity/TeamItem";
import { useTeamsByIds } from "../teams/queries";
import { useCanWrite } from "../team/TeamContext";
import { RestockTeamFilter } from "./FigureParts";
import { SupplierStoreSelect } from "./SupplierStoreSelect";
import { NO_FIGURE_MARKS, SupplierFigureCells, SupplierFigureHeaders, SupplierFigureLines } from "./SupplierFigures";
import { SupplierTabExport } from "./SupplierTabExport";
import { useProductExport } from "./exports";

const PAGE_SIZE_OPTIONS = [10, 20, 50];

// The store filter in the URL: a store's id, or `none` for the rows bought with no store.
const storeCodec: UrlCodec<bigint> = {
  encode: (v) => (v === NO_STORE ? "none" : v.toString()),
  decode: (raw) => (raw === "none" ? NO_STORE : /^\d+$/.test(raw) ? BigInt(raw) : undefined),
};

// WHEN IT WAS BOUGHT — the last restock, and the first under it when they differ: one fact read twice, so one cell
// (one-context-per-column-and-never-three-lines). Bought once, it is one date.
function Bought({ row }: { row: SupplierProductRow }) {
  const { t } = useTranslation();
  const last = formatUnixDate(row.lastBoughtAt);
  const first = formatUnixDate(row.firstBoughtAt);

  return (
    <Stack gap="0.5">
      <Text>{last}</Text>
      {first !== last && (
        <Text fontSize="sm" color="fg.muted">
          {t("supplierChannel.products.firstBought", { date: first })}
        </Text>
      )}
    </Stack>
  );
}

// THE STORE IT WAS BOUGHT AT — the Toko tab's cell, not bold: here the product is the row's subject; a dash for a line
// that named the supplier alone (a-line-with-no-store-links-under-the-supplier).
function StoreCell({ row }: { row: SupplierProductRow }) {
  if (!row.store) {
    return <Text color="fg.muted">—</Text>;
  }

  return <ChannelName channel={row.store} bold={false} />;
}

export interface ProductBrowserProps {
  /** The CALLER's team — the scope the read is authorised in, not the team that keeps the supplier. */
  teamId: bigint;
  /** Any team's live supplier — reads cross teams. */
  supplierId: bigint;
  /** The supplier's whole store list — the store filter's options (the page's own read). */
  channels: SupplierChannelRecord[];
  /**
   * The page's Gudang terkait chip (a-supplier-page-is-scoped-by-its-warehouses) — only the rows whose goods were received
   * at that warehouse, each with that warehouse's Terjual and Siap. 0n (the default) = every warehouse.
   */
  warehouseId?: bigint;
  /** Back to every warehouse — offered when the chip alone leaves no row. The page owns the chip. */
  onClearWarehouse?: () => void;
}

// ProductBrowser is a supplier's PRODUCTS tab — on the manage detail and on the discover detail alike
// (supplier-detail-has-channels-and-products-tabs): every product bought from it, by any team
// (every-accepted-line-links-its-own-product) — the product with its picture and SKU, the team whose product it is,
// the store it was bought at (a dash for none), and when: the last restock and the first
// (a-link-remembers-its-last-restock), newest first. Searched, narrowed to one team, one store or the rows bought with
// no store, and paged (the-products-tab-searches-and-pages, the-products-tab-filters-by-team-and-store).
//
//   Produk                        Tim               Toko pemasok              Terakhir dibeli      Terjual             Siap
//   [▦] Kain Katun Jepang 1 rol   [TM] Toko Melati  Sumber Makmur Official    8 Okt 2026              412               37
//       KTN-JP-01                      Penjual      [Shopee]                  pertama 9 Sep 2026  pesanan 6 Okt 2026
//
// ITS TERJUAL AND SIAP (the-detail-tabs-show-sold-and-ready) — the store × product's: the last two columns, the last
// order under Terjual. No restock date under Siap — *Terakhir dibeli*, just left of it, is that date. A product none of
// whose goods arrived (every unit broke on the way) reads a dash.
//
// REAL since 2026-11-14: it reads for itself — the search, the team, the store and the page go to
// SupplierChannelService.SupplierProductList, which searches, narrows and pages ON THE SERVER, and names each row and
// fills its figures for that page only. The search is debounced; the previous rows stay up behind the RefreshOverlay
// while the answer loads (HARD RULE 10). Every selling team reads the same rows and figures
// (another-team-sees-everything-of-a-supplier, every-selling-team-sees-every-teams-figures).
//
// UNDER THE PAGE'S WAREHOUSE CHIP (a-supplier-page-is-scoped-by-its-warehouses, since 2026-11-14): only the rows whose
// product has goods of this supplier, bought at the row's store (or none), received at that warehouse — narrowed on the
// server before the count and the page — with that warehouse's Terjual and Siap; *Terakhir dibeli* stays the row's own.
// Its Export writes the same.
export function ProductBrowser({ teamId, supplierId, channels, warehouseId = 0n, onClearWarehouse }: ProductBrowserProps) {
  const { t } = useTranslation();
  const isMobile = useIsMobile();

  // THE FILTERS LIVE IN THE URL (a-lists-filters-live-in-the-url) — `product.`-prefixed, since the Toko and Statistik
  // tabs share the detail page's route and keep their own.
  const [q, setQ] = useUrlState("product.q", "", textCodec);
  // One of the supplier's stores (NO_STORE = bought with none), and one selling team — 0n is every one.
  const [storeId, setStoreId] = useUrlState("product.store", 0n, storeCodec);
  const [productTeamId, setProductTeamId] = useUrlState("product.team", 0n, idCodec);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const term = useDebounced(q.trim());

  // A filter change is a new question, so it starts again at page one.
  function refilter(change: () => void) {
    change();
    setPage(1);
  }
  const clearFilters = () =>
    refilter(() => {
      setQ("");
      setStoreId(0n);
      setProductTeamId(0n);
    });

  // So is another warehouse chip — the page holds it, so the page turns back to one when it changes.
  const [pagedFor, setPagedFor] = useState(warehouseId);
  if (pagedFor !== warehouseId) {
    setPagedFor(warehouseId);
    setPage(1);
  }

  const query = useSupplierProductPage({ teamId, supplierId, q: term, productTeamId, storeId, warehouseId, page, pageSize });
  const rows = query.data?.rows ?? [];
  const totalItems = query.data?.totalItems ?? 0;
  const error = query.isError ? rpcError(query.error) : "";

  // Whose products — named in one batch for the page (a team the reader is not in).
  const teams = useTeamsByIds({ ids: rows.map((row) => row.teamId) });
  const teamName = (id: bigint) => teams.data?.[id.toString()]?.name ?? `#${id}`;

  const filtering = q.trim() !== "" || storeId !== 0n || productTeamId !== 0n;
  // What the rows on screen were asked with — the settled search, not the one still being typed.
  const narrowed = term !== "" || storeId !== 0n || productTeamId !== 0n;
  // One team picked, the Team column would say the same name on every row — it goes, as on the Statistik tab.
  const showTeam = productTeamId === 0n;

  // THE TAB AS A FILE (each-supplier-tab-exports-its-own-table): the rows the list holds with the settled search, the team
  // and the store, every page. It stores a file, so a monitored team's reader has no Export
  // (the-admin-team-monitors-read-only).
  const writable = useCanWrite();
  const exporter = useProductExport(teamId);
  const exportButton = writable ? (
    <SupplierTabExport
      testId="products-export"
      progress={exporter.progress}
      onExport={() => void exporter.start({ supplierId, q: term, teamId: productTeamId, storeId, warehouseId })}
    />
  ) : null;

  function list() {
    if (rows.length === 0 && !error) {
      // AN EMPTY LIST SAYS WHAT NEXT (an-empty-list-shows-a-hint). The warehouse chip alone leaving nothing: none of the
      // products' goods were received there — back to every warehouse.
      if (!narrowed && warehouseId !== 0n) {
        return (
          <EmptyHint
            icon={Warehouse}
            size="sm"
            title={t("supplierChannel.products.noneAtWarehouse")}
            description={t("supplierChannel.products.noneAtWarehouseHint")}
            action={
              onClearWarehouse && (
                <Button variant="outline" colorPalette="gray" onClick={onClearWarehouse}>
                  {t("suppliers.relatedWarehouses.showAll")}
                </Button>
              )
            }
            testId="products-none-at-warehouse"
          />
        );
      }

      return narrowed ? (
        <EmptyHint
          icon={SearchX}
          size="sm"
          title={t("supplierChannel.products.none")}
          description={t("emptyHint.noMatch")}
          action={<Button variant="outline" colorPalette="gray" onClick={clearFilters}>
              {t("common.clearFilters")}
            </Button>}
          testId="products-none-match"
        />
      ) : (
        <EmptyHint
          icon={Package}
          size="sm"
          title={t("supplierChannel.products.empty")}
          description={t("supplierChannel.products.emptyHint")}
          testId="products-empty"
        />
      );
    }

    if (isMobile) {
      // A phone reads each product as a block (a-phone-reads-each-line-as-a-block): the product with its team beside
      // the SKU, then the store it was bought at, then when.
      return (
        <Stack gap="2" data-testid="products-table">
          {rows.map((row) => (
            <Stack key={row.id.toString()} data-testid={`product-row-${row.id}`} borderWidth="1px" borderRadius="md" p="3" gap="2">
              <ProductListItem product={row.product} teamName={showTeam ? teamName(row.teamId) : undefined} />
              <HStack gap="2" fontSize="sm" minW="0" data-testid={`product-row-${row.id}-store`}>
                {row.store ? (
                  <>
                    <Text lineClamp={1}>{row.store.name}</Text>
                    <MarketplaceBadge marketplace={row.store.channelType} />
                  </>
                ) : (
                  <Text color="fg.muted">—</Text>
                )}
              </HStack>
              {/* The first restock on its OWN line, as on a desktop (owner: *"oke"*, `the-first-restock-has-its-own-line`)
                  — after a dot it wrapped mid-date, the year alone on the next line. */}
              <Stack gap="0" fontSize="sm" color="fg.muted">
                <Text data-testid={`product-row-${row.id}-last`}>
                  {t("supplierChannel.products.lastBought")} {formatUnixDate(row.lastBoughtAt)}
                </Text>
                {formatUnixDate(row.firstBoughtAt) !== formatUnixDate(row.lastBoughtAt) && (
                  <Text data-testid={`product-row-${row.id}-first`}>
                    {t("supplierChannel.products.firstBought", { date: formatUnixDate(row.firstBoughtAt) })}
                  </Text>
                )}
              </Stack>
              <SupplierFigureLines figures={row.figures} marks={NO_FIGURE_MARKS} testId={`product-row-${row.id}-figures`} />
            </Stack>
          ))}
        </Stack>
      );
    }

    return (
      <Table.Root size="sm" data-testid="products-table">
        <Table.Header>
          <Table.Row>
            <Table.ColumnHeader>{t("supplierChannel.products.product")}</Table.ColumnHeader>
            {showTeam && <Table.ColumnHeader>{t("supplierChannel.products.team")}</Table.ColumnHeader>}
            <Table.ColumnHeader>{t("supplierChannel.products.channel")}</Table.ColumnHeader>
            <Table.ColumnHeader>{t("supplierChannel.products.lastBought")}</Table.ColumnHeader>
            <SupplierFigureHeaders marks={NO_FIGURE_MARKS} />
          </Table.Row>
        </Table.Header>

        <Table.Body>
          {rows.map((row) => (
            <Table.Row key={row.id.toString()} data-testid={`product-row-${row.id}`} css={LIGHTS_UP}>
              <Table.Cell>
                <Box minW="15rem">
                  <ProductListItem product={row.product} />
                </Box>
              </Table.Cell>
              {showTeam && (
                <Table.Cell>
                  <Box maxW="15rem">
                    <TeamItem team={{ teamName: teamName(row.teamId), teamType: TeamType.SELLING }} />
                  </Box>
                </Table.Cell>
              )}
              <Table.Cell data-testid={`product-row-${row.id}-store`}>
                <StoreCell row={row} />
              </Table.Cell>
              <Table.Cell>
                <Bought row={row} />
              </Table.Cell>
              <SupplierFigureCells figures={row.figures} id={row.id} testIdPrefix="product" />
            </Table.Row>
          ))}
        </Table.Body>
      </Table.Root>
    );
  }

  return (
    <Stack gap="card" data-testid="products-section">
      <FilterBar
        testId="products-filter"
        actions={isMobile ? undefined : exportButton}
        active={filtering}
        count={(q.trim() !== "" ? 1 : 0) + (storeId !== 0n ? 1 : 0) + (productTeamId !== 0n ? 1 : 0)}
        onClear={clearFilters}
      >
        <FilterSearch
          value={q}
          onChange={(value) => refilter(() => setQ(value))}
          placeholder={t("supplierChannel.products.search")}
          testId="products-search"
        />

        {/* Tim, then Toko — the order of the table's columns (owner: *"tim dulu, lalu toko"*). */}
        {/* Whose product — the Statistik tab's team picker: every selling team (the-team-filter-picks-any-selling-team). */}
        <FilterField w="15rem" testId="products-team-filter">
          <RestockTeamFilter value={productTeamId} onChange={(id) => refilter(() => setProductTeamId(id))} />
        </FilterField>

        {/* One of the supplier's stores — or "no store", the rows bought at none, whose cell reads "—". */}
        <FilterField w="15rem" testId="products-store-filter">
          <SupplierStoreSelect
            stores={channels}
            value={storeId}
            onChange={(id) => refilter(() => setStoreId(id))}
            placeholder={t("supplierChannel.products.storeAll")}
            noStoreLabel={t("supplierChannel.products.noStore")}
            testId="products-store"
          />
        </FilterField>
        {/* On a phone the Export is in the Filter sheet, full width — its row has no room (each-supplier-tab-exports-its-own-table). */}
        {isMobile && exportButton}
      </FilterBar>

      {error && (
        <Text color="error.fg" data-testid="products-error">
          {error}
        </Text>
      )}

      {/* The first load shows the list's shape, and the rows fade in over it — once; a refresh keeps them mounted
          (`motion-is-small-quick-and-shared`). */}
      {query.isPending ? (
        <ListSkeleton rows={3} testId="products-loading" />
      ) : (
        <Box animationStyle="swap">
          <RefreshOverlay busy={query.isFetching && !query.isPending}>{list()}</RefreshOverlay>
        </Box>
      )}

      {/* every-list-pages-with-the-growing-pager — the pages opened so far, one click back to any of them. */}
      <GrowingPager
        page={page}
        onPageChange={setPage}
        hasNext={query.isPlaceholderData ? undefined : page * pageSize < totalItems}
        resetKey={[term, storeId, productTeamId, warehouseId, pageSize].join("|")}
        pageSize={pageSize}
        pageSizeOptions={PAGE_SIZE_OPTIONS}
        onPageSizeChange={(n) => {
          setPageSize(n);
          setPage(1);
        }}
        testId="products-pager"
      />
    </Stack>
  );
}

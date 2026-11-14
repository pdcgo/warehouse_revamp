import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router-dom";
import { fromHere } from "../../lib/cameFrom";
import { Badge, Button, Flex, HStack, Heading, Icon, Stack, Text } from "@chakra-ui/react";
import { Archive, ArrowLeft, Plus } from "lucide-react";
import { TeamType } from "../../gen/warehouse/team/v1/team_pb";
import { canWrite, useTeam } from "../../features/team/TeamContext";
import { useTeams } from "../../features/teams/queries";
import { TeamSelect } from "../../components/teams/TeamSelect";
import { FilterBar, FilterField, FilterSearch } from "../../components/chrome/FilterBar";
import { CompactActions } from "../../components/chrome/CompactActions";
import type { SortState } from "../../components/chrome/SortableHeader";
import { type ProductLockPick, type ProductSortKey, useProductStats } from "../../features/products/queries";
import { WarehouseStockList } from "../../features/inventory/WarehouseStockList";
import { useIsMobile } from "../../layouts/shell";
import { useDebounced } from "../../lib/useDebounced";
import { idCodec, nullableCodec, oneOfCodec, optionalCodec, sortCodec, textCodec, useUrlState } from "../../lib/urlState";
import { ChoiceFilter } from "../../components/pickers/ChoiceFilter";
import { ProductStats } from "./components/ProductStats";
import { ProductsTable } from "./components/ProductsTable";

// The column the contract orders the catalogue by that the row shows first.
const SORT_CODEC = nullableCodec(sortCodec(["name"] as const));
// The lock's three ways (one-lock-three-ways), and "a minimum in force right now".
const LOCK_FILTERS = ["open", "min", "always", "lockedNow"] as const satisfies readonly ProductLockPick[];
type LockFilter = (typeof LOCK_FILTERS)[number];
const LOCK_CODEC = optionalCodec(oneOfCodec(LOCK_FILTERS));
// The stock's age, at least this many days — the warning tone starts at 60 (STALE_STOCK_DAYS).
const AGE_FILTERS = ["30", "60", "90"] as const;
type AgeFilter = (typeof AGE_FILTERS)[number];
const AGE_CODEC = optionalCodec(oneOfCodec(AGE_FILTERS));

// /products is TWO screens, chosen by the current team's type — on RestockRoute's rule (router.tsx): the team switcher
// changes the team without navigating, so one path re-renders the right screen.
//
//   a selling team   its CATALOGUE (CatalogueProductsPage) — what it sells, with the stock, cost and sales behind it
//   a warehouse      WHAT IT HOLDS (WarehouseProductsPage) — a-warehouses-products-is-what-it-holds
export function ProductsPage({ archived = false }: { archived?: boolean }) {
  const { current } = useTeam();

  // A warehouse has no archive — it owns no products — so /products/archived is its held list too, where an archived
  // product it still holds is labelled.
  return current?.teamType === TeamType.WAREHOUSE ? <WarehouseProductsPage /> : <CatalogueProductsPage archived={archived} />;
}

// A WAREHOUSE'S PRODUCTS IS WHAT IT HOLDS (a-warehouses-products-is-what-it-holds): every product with a batch in this
// building — any team's, archived ones labelled, at 0 too — with its owner, its units on hand and its Adjust and Move,
// searched by name or code on the server (WarehouseStockList, the-stock-screen-lists-what-the-warehouse-has-held). A row
// opens the warehouse product page. No picker — it is the warehouse's own building — and none of the seller's columns:
// Cross markup, Lock, the cost range and the catalogue's figures are the owning team's, not the warehouse's.
//
//   Products [Gudang Pusat]
//   Every product this warehouse holds or has held — any team's, at 0 too.
//   [⌕ Search products by product code or name                ×]
//   Product code   · Product                     · Owner          · On hand · Actions
//
// It used to be the arrangement list (#142): what the warehouse was ASKED to hold, with the seller's catalogue columns
// read as "—", the owner as "Team #1", and no search. The RPC behind it is deleted (warehouse-product-list-is-deleted).
function WarehouseProductsPage() {
  const { current } = useTeam();
  const { t } = useTranslation();

  if (!current) {
    return null;
  }

  return (
    <Stack gap="section" animationStyle="enter" data-testid="warehouse-products-page">
      <Stack gap="1" minW="0">
        <HStack gap="card" wrap="wrap">
          <Heading size="md">{t("products.heading")}</Heading>
          <Badge colorPalette="brand">{current.teamName || `Team #${current.teamId}`}</Badge>
        </HStack>
        <Text color="fg.muted" fontSize="sm">
          {t("inventory.stockLead")}
        </Text>
      </Stack>

      <WarehouseStockList warehouseId={current.teamId} opensProduct />
    </Stack>
  );
}

// CatalogueProductsPage lists the CURRENT TEAM's catalogue — at `/products` the live products, at `/products/archived`
// the archived ones. Every RPC carries `current.teamId` in its body — the team is the scope, and a team only ever sees its
// own products. Create and edit are a dedicated PAGE (issue #60), reached from here.
//
// IT FOLLOWS THE SCREEN RULES (owner: *"sekarang kita ke product, coba terapkan keputusan sebelumnya"*,
// `the-product-screens-follow-the-screen-rules`):
//
//   Produk [Toko Anggrek]                                        [🗃 Arsip] [＋ Produk Baru]
//   Katalog tim ini — yang dijual, yang ada di rak, dan yang sedang dikirim.
//   [Total produk 44] [Siap 79 pcs] [Dikirim 12 pcs] [Pesanan terakhir …] [Restock terakhir …]
//   [⌕ Cari SKU atau nama ×] [Semua gudang ▾] [Semua kunci ▾] [Semua umur stok ▾]
//   Produk ↕ │ Cross │ Rentang HPP │ Kunci │ Siap │ Dikirim │ Umur stok │ [✎ Ubah] [🗃 Arsipkan]
//
// THE ARCHIVE IS A PAGE OF ITS OWN (owner: *"[arsip] dibuat beda halaman, lalu masuk ke halamannya lewat button di
// atas"*, `the-archive-is-a-page-of-its-own`) — no longer a tab under the live list. Arsip in the header opens it; it is
// the archived products alone, searchable, each offering Pulihkan, and a way back. Archiving is a soft delete: the row is
// not gone, which is why every word here says Archive rather than Delete.
//
// A WAREHOUSE never reaches this page: its Products is WarehouseProductsPage above.
function CatalogueProductsPage({ archived }: { archived: boolean }) {
  const { current } = useTeam();
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useTranslation();
  const isMobile = useIsMobile();

  // THE SEARCH, THE WAREHOUSE LENS AND THE SORT LIVE IN THE URL (a-lists-filters-live-in-the-url) — a refresh, or Back
  // from a product, opens the same narrowed list.
  const [q, setQ] = useUrlState("q", "", textCodec);
  // `null` = the list's own order, newest first — no heading stands for it.
  const [sort, setSort] = useUrlState<SortState<ProductSortKey> | null>("sort", null, SORT_CODEC);

  // The WAREHOUSE lens. 0n = all of them.
  //
  // It is not a row filter — it does not remove products from your catalogue, because the catalogue is yours wherever
  // the goods sit. It changes what every stock figure MEANS: ready, ongoing, the cost range and the oldest batch become
  // that one warehouse's, and the column headers say so. Stock is held per warehouse, so a total is only ever an answer
  // to "everywhere".
  const [warehouseId, setWarehouseId] = useUrlState("warehouse", 0n, idCodec);
  // Just for the labels — a cache hit on the list TeamSelect has already loaded.
  const warehouses = useTeams({ teamType: TeamType.WAREHOUSE, page: 1, pageSize: 100, reference: true });
  const warehouseName =
    warehouseId === 0n
      ? undefined
      : warehouses.data?.teams.find((w) => w.id === warehouseId)?.name;

  // THE LOCK AND THE STOCK'S AGE (owner: *"kasih filter lock dan umur stok unimplemented"*, then built —
  // lock-and-stock-age-filter-ahead-of-the-contract) — each held in the URL and SENT: the server narrows its own count
  // and page, asking inventory for the minimums in force now and the stock's age. The age is read in the lens's
  // warehouse; the lock reads every warehouse. Not on the archive: an archived product is out of every other team's
  // reach, so its lock says nothing.
  const [lock, setLock] = useUrlState<LockFilter | undefined>("lock", undefined, LOCK_CODEC);
  const [age, setAge] = useUrlState<AgeFilter | undefined>("age", undefined, AGE_CODEC);

  // Typed, then settled — a word is one request, not one per key.
  const term = useDebounced(q.trim());

  const filterCount = [
    q.trim() !== "",
    warehouseId > 0n,
    !archived && lock !== undefined,
    !archived && age !== undefined,
  ].filter(Boolean).length;
  const clearFilters = () => {
    setQ("");
    setWarehouseId(0n);
    setLock(undefined);
    setAge(undefined);
  };

  // The figures describe the LIVE CATALOGUE, so only the live list carries them; their own query, so searching does not
  // change what the headline says you own. The warehouse lens DOES reach them, because "ready stock" narrowed to one
  // building is still a fact about the catalogue.
  const stats = useProductStats({
    teamId: archived ? undefined : current?.teamId,
    warehouseId,
  });

  // No current team means there is no scope to list against — the whole page is meaningless.
  if (!current) {
    return (
      <Stack gap="section">
        <Heading size="md">{t("products.heading")}</Heading>
        <Text color="fg.muted" data-testid="products-no-team">
          {t("products.noTeam")}
        </Text>
      </Stack>
    );
  }

  // The list as it stands rides along, so the form's Back returns to it filtered (the-form-returns-where-it-was-opened).
  const openCreate = () => navigate("/products/new", { state: fromHere(location) });
  const writable = canWrite(current);
  const openArchive = () => navigate("/products/archived");

  return (
    // The page arrives — a fade and a short rise (motion-is-small-quick-and-shared).
    <Stack gap="section" animationStyle="enter" data-testid={archived ? "products-archive-page" : "products-page"}>
      {/* The archive's way back, above its title — as a product's page has it. */}
      {archived && (
        <Button
          size="xs"
          variant="ghost"
          alignSelf="flex-start"
          data-testid="products-archive-back"
          onClick={() => navigate("/products")}
        >
          <Icon as={ArrowLeft} boxSize="4" />
          {t("products.backToProducts")}
        </Button>
      )}

      {/* THE TITLE AND THE SUBTITLE AS ONE BLOCK, the actions on its row — Arsip and Produk Baru, their icons alone on a
          phone (a-phone-header-action-is-an-icon). There is no top bar over the page to name it any more
          (the-desktop-shell-has-no-top-bar), so the page says what it is. */}
      <Flex align="start" gap="card" wrap={isMobile ? "nowrap" : "wrap"}>
        <Stack gap="1" flex="1 1 16rem" minW="0">
          <HStack gap="card" wrap="wrap">
            <Heading size="md">{archived ? t("products.archiveView.title") : t("products.heading")}</Heading>
            <Badge colorPalette="brand">{current.teamName || `Team #${current.teamId}`}</Badge>
          </HStack>
          <Text color="fg.muted" fontSize="sm">
            {archived ? t("products.archiveView.lead") : t("products.lead")}
          </Text>
        </Stack>

        {/* The archive has no actions of its own. */}
        {!archived &&
          (isMobile ? (
            <CompactActions
              menuLabel={t("products.table.actions")}
              actions={[
                { id: "archive", label: t("products.archiveView.open"), icon: Archive, testId: "open-archived-products", onClick: openArchive },
                ...(writable
                  ? [{ id: "create", label: t("products.newProduct"), icon: Plus, primary: true, testId: "open-create-product", onClick: openCreate }]
                  : []),
              ]}
            />
          ) : (
            <HStack gap="1.5" flexShrink={0}>
              <Button size="xs" variant="outline" data-testid="open-archived-products" onClick={openArchive}>
                <Icon as={Archive} boxSize="4" />
                {t("products.archiveView.open")}
              </Button>
              {writable && (
                <Button size="xs" colorPalette="brand" data-testid="open-create-product" onClick={openCreate}>
                  <Icon as={Plus} boxSize="4" />
                  {t("products.newProduct")}
                </Button>
              )}
            </HStack>
          ))}
      </Flex>

      {/* The archive holds what left the catalogue — a product count is not its headline. */}
      {!archived && (
        <ProductStats
          totalItems={stats.data?.activeProducts ?? 0}
          ready={stats.data?.ready}
          ongoing={stats.data?.ongoing}
          lastOrderUnix={stats.data?.lastOrderUnix}
          lastRestockUnix={stats.data?.lastRestockUnix}
          warehouseName={warehouseName}
        />
      )}

      {/* THE SHARED FILTER STRIP (a-phone-filters-from-a-sheet) — the search with its icon and its ×, the warehouse lens
          with its own × (every-filter-clears-from-its-own-x); the sort is the headings'. */}
      <FilterBar testId="products-filter" active={filterCount > 0} count={filterCount} onClear={clearFilters}>
        <FilterSearch
          value={q}
          onChange={setQ}
          placeholder={t("products.searchPlaceholder")}
          testId="product-search"
        />

        {/* The shared team picker, restricted to WAREHOUSE teams — every option is one, so the pick reads as its name
            alone (a-one-type-picker-shows-the-name-alone). */}
        <FilterField w="16rem" testId="product-warehouse-filter">
          <TeamSelect
            value={warehouseId > 0n ? warehouseId : undefined}
            onChange={setWarehouseId}
            teamType={TeamType.WAREHOUSE}
            showType={false}
            placeholder={t("products.allWarehouses")}
          />
        </FilterField>

        {!archived && (
          <>
            {/* THE LOCK — the three ways, and the minimums in force right now (one-lock-three-ways,
                a-minimum-closes-only-under-it). */}
            <FilterField w="13rem" testId="product-lock-filter">
              <ChoiceFilter
                value={lock}
                onChange={setLock}
                placeholder={t("products.filter.lockAll")}
                testId="product-lock-select"
                options={[
                  { value: "open", label: t("products.lock.mode.open") },
                  { value: "min", label: t("products.lock.mode.min") },
                  { value: "always", label: t("products.lock.mode.always") },
                  { value: "lockedNow", label: t("products.filter.lockedNow") },
                ]}
              />
            </FilterField>

            {/* THE STOCK'S AGE — at least this many days on a shelf (the-dates-read-as-ages), in the lens's warehouse. */}
            <FilterField w="13rem" testId="product-age-filter">
              <ChoiceFilter
                value={age}
                onChange={setAge}
                placeholder={t("products.filter.stockAgeAll")}
                testId="product-age-select"
                options={AGE_FILTERS.map((days) => ({
                  value: days,
                  label: t("products.filter.stockAgeAtLeast", { days }),
                }))}
              />
            </FilterField>
          </>
        )}
      </FilterBar>

      <ProductsTable
        mode={archived ? "archived" : "active"}
        teamId={current.teamId}
        q={term}
        warehouseId={warehouseId}
        warehouseName={warehouseName}
        sort={sort}
        lock={archived ? undefined : lock}
        minStockAgeDays={archived || age === undefined ? 0 : Number(age)}
        onSortChange={setSort}
        filtered={filterCount > 0}
        onClearFilters={clearFilters}
        onCreate={archived || !writable ? undefined : openCreate}
      />
    </Stack>
  );
}

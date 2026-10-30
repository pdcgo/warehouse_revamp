import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router-dom";
import { fromHere } from "../../lib/cameFrom";
import { Badge, Box, Button, Flex, HStack, Heading, Icon, Stack, Text } from "@chakra-ui/react";
import { Archive, ArrowLeft, Plus } from "lucide-react";
import { TeamType } from "../../gen/warehouse/team/v1/team_pb";
import { useTeam } from "../../features/team/TeamContext";
import { useTeams } from "../../features/teams/queries";
import { TeamSelect } from "../../components/teams/TeamSelect";
import { FilterBar, FilterField, FilterSearch } from "../../components/chrome/FilterBar";
import { CompactActions } from "../../components/chrome/CompactActions";
import type { SortState } from "../../components/chrome/SortableHeader";
import { type ProductSortKey, useProductStats } from "../../features/products/queries";
import { useIsMobile } from "../../layouts/shell";
import { useDebounced } from "../../lib/useDebounced";
import { idCodec, nullableCodec, oneOfCodec, optionalCodec, sortCodec, textCodec, useUrlState } from "../../lib/urlState";
import { NotImplemented } from "../../features/pending/NotImplemented";
import { NotImplementedSummary } from "../../features/pending/NotImplementedSummary";
import { ChoiceFilter } from "./components/ChoiceFilter";
import { ProductStats } from "./components/ProductStats";
import { ProductsTable } from "./components/ProductsTable";
import { PRODUCTS_LIST_PENDING } from "./pending";

// The column the contract orders the catalogue by that the row shows first.
const SORT_CODEC = nullableCodec(sortCodec(["name"] as const));
// The lock's three ways (one-lock-three-ways), and "a minimum in force right now".
const LOCK_FILTERS = ["open", "min", "always", "lockedNow"] as const;
type LockFilter = (typeof LOCK_FILTERS)[number];
const LOCK_CODEC = optionalCodec(oneOfCodec(LOCK_FILTERS));
// The stock's age, at least this many days — the warning tone starts at 60 (STALE_STOCK_DAYS).
const AGE_FILTERS = ["30", "60", "90"] as const;
type AgeFilter = (typeof AGE_FILTERS)[number];
const AGE_CODEC = optionalCodec(oneOfCodec(AGE_FILTERS));

// ProductsPage lists the CURRENT TEAM's catalogue — at `/products` the live products, at `/products/archived` the
// archived ones. Every RPC carries `current.teamId` in its body — the team is the scope, and a selling/warehouse team only
// ever sees its own products. Create and edit are a dedicated PAGE (issue #60), reached from here.
//
// IT FOLLOWS THE SCREEN RULES (owner: *"sekarang kita ke product, coba terapkan keputusan sebelumnya"*,
// `the-product-screens-follow-the-screen-rules`):
//
//   Produk [Toko Anggrek]                                        [🗃 Arsip] [＋ Produk Baru]
//   Katalog tim ini — yang dijual, yang ada di rak, dan yang sedang dikirim.
//   [Total produk 44] [Siap 79 pcs] [Dikirim 12 pcs] [Pesanan terakhir …] [Restock terakhir …]
//   [⌕ Cari SKU atau nama ×] [Semua gudang ▾] [Semua kunci ▾ ⚠] [Semua umur stok ▾ ⚠]
//   Produk ↕ │ Cross │ Rentang HPP │ Kunci │ Siap │ Dikirim │ Umur stok │ [✎ Ubah] [🗃 Arsipkan]
//
// THE ARCHIVE IS A PAGE OF ITS OWN (owner: *"[arsip] dibuat beda halaman, lalu masuk ke halamannya lewat button di
// atas"*, `the-archive-is-a-page-of-its-own`) — no longer a tab under the live list. Arsip in the header opens it; it is
// the archived products alone, searchable, each offering Pulihkan, and a way back. Archiving is a soft delete: the row is
// not gone, which is why every word here says Archive rather than Delete.
//
// A WAREHOUSE gets no archive, no figures and no filters. It owns no products, so it has nothing to archive — what it sees
// is the arrangement of other teams' goods on its shelves, which is a different RPC (see useProducts).
export function ProductsPage({ archived = false }: { archived?: boolean }) {
  const { current } = useTeam();
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useTranslation();
  const isMobile = useIsMobile();

  const isWarehouse = current?.teamType === TeamType.WAREHOUSE;

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
  const warehouses = useTeams({ teamType: TeamType.WAREHOUSE, page: 1, pageSize: 100, enabled: !isWarehouse, reference: true });
  const warehouseName =
    warehouseId === 0n
      ? undefined
      : warehouses.data?.teams.find((w) => w.id === warehouseId)?.name;

  // THE LOCK AND THE STOCK'S AGE, AHEAD OF THE CONTRACT (owner: *"kasih filter lock dan umur stok unimplemented"*) — each
  // held in the URL and marked ⚠, its pick THROWN AWAY: ProductListFilter has only `q` and `status` (PRODUCTS_LIST_PENDING).
  // Not on the archive: an archived product is out of every other team's reach, so its lock says nothing.
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
    teamId: isWarehouse || archived ? undefined : current?.teamId,
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
            {archived ? t("products.archiveView.lead") : isWarehouse ? t("products.leadWarehouse") : t("products.lead")}
          </Text>
        </Stack>

        {/* A warehouse team stocks products but does not create or archive them (#101) — no actions; the archive has
            none of its own. */}
        {!isWarehouse &&
          !archived &&
          (isMobile ? (
            <CompactActions
              menuLabel={t("products.table.actions")}
              actions={[
                { id: "archive", label: t("products.archiveView.open"), icon: Archive, testId: "open-archived-products", onClick: openArchive },
                { id: "create", label: t("products.newProduct"), icon: Plus, primary: true, testId: "open-create-product", onClick: openCreate },
              ]}
            />
          ) : (
            <HStack gap="1.5" flexShrink={0}>
              <Button size="xs" variant="outline" data-testid="open-archived-products" onClick={openArchive}>
                <Icon as={Archive} boxSize="4" />
                {t("products.archiveView.open")}
              </Button>
              <Button size="xs" colorPalette="brand" data-testid="open-create-product" onClick={openCreate}>
                <Icon as={Plus} boxSize="4" />
                {t("products.newProduct")}
              </Button>
            </HStack>
          ))}
      </Flex>

      {/* What this list cannot do yet — the two filters it holds and throws away. */}
      {!isWarehouse && !archived && <NotImplementedSummary list={PRODUCTS_LIST_PENDING} />}

      {/* The warehouse list is somebody else's catalogue on our shelves — a product count is not the headline there; the
          archive holds what left the catalogue. */}
      {!isWarehouse && !archived && (
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
          with its own × (every-filter-clears-from-its-own-x); the sort is the headings'. No strip for a warehouse
          (#142): WarehouseProductList takes no query, and a dead control is worse than an absent one. */}
      {!isWarehouse && (
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
              {/* THE LOCK — the three ways, and the minimums in force right now (one-lock-three-ways). Held, marked, not
                  sent. */}
              <FilterField w="13rem" testId="product-lock-filter">
                <Flex align="center" gap="1">
                  <Box flex="1" minW="0">
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
                  </Box>
                  <NotImplemented list={PRODUCTS_LIST_PENDING} id="lockFilter" />
                </Flex>
              </FilterField>

              {/* THE STOCK'S AGE — at least this many days on a shelf (the-dates-read-as-ages). Held, marked, not sent. */}
              <FilterField w="13rem" testId="product-age-filter">
                <Flex align="center" gap="1">
                  <Box flex="1" minW="0">
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
                  </Box>
                  <NotImplemented list={PRODUCTS_LIST_PENDING} id="stockAgeFilter" />
                </Flex>
              </FilterField>
            </>
          )}
        </FilterBar>
      )}

      {isWarehouse ? (
        <ProductsTable
          mode="warehouse"
          teamId={current.teamId}
          q=""
          warehouseId={0n}
          filtered={false}
          onClearFilters={clearFilters}
        />
      ) : (
        <ProductsTable
          mode={archived ? "archived" : "active"}
          teamId={current.teamId}
          q={term}
          warehouseId={warehouseId}
          warehouseName={warehouseName}
          sort={sort}
          onSortChange={setSort}
          filtered={filterCount > 0}
          onClearFilters={clearFilters}
          onCreate={archived ? undefined : openCreate}
        />
      )}
    </Stack>
  );
}

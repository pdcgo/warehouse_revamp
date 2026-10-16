import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import {
  Badge,
  Box,
  Button,
  Flex,
  HStack,
  Heading,
  Icon,
  IconButton,
  Menu,
  Portal,
  Skeleton,
  Stack,
  Table,
  Text,
} from "@chakra-ui/react";
import { MoreHorizontal, Pencil, SearchX, Store, Trash2, UserCog } from "lucide-react";
import { rpcError } from "../../api/clients";
import { Marketplace } from "../../gen/warehouse/marketplace/v1/marketplace_pb";
import type { Shop } from "../../gen/warehouse/selling/v1/selling_pb";
import { useTeam } from "../../features/team/TeamContext";
import { useActors } from "../../features/users/queries";
import { NotImplemented } from "../../features/pending/NotImplemented";
import { NotImplementedSummary } from "../../features/pending/NotImplementedSummary";
import { useIsMobile } from "../../layouts/shell";
import { useDebounced } from "../../lib/useDebounced";
import { PRESSABLE } from "../../lib/motion";
import {
  boolCodec,
  enumCodec,
  idCodec,
  nullableCodec,
  optionalCodec,
  sortCodec,
  textCodec,
  useUrlState,
} from "../../lib/urlState";
import { ConfirmDialog } from "../../components/feedback/ConfirmDialog";
import { EmptyHint } from "../../components/feedback/EmptyHint";
import { ListSkeleton } from "../../components/feedback/ListSkeleton";
import { RefreshOverlay } from "../../components/feedback/RefreshOverlay";
import { toaster } from "../../components/feedback/Toaster";
import { FilterBar, FilterField, FilterSearch } from "../../components/chrome/FilterBar";
import { GrowingPager } from "../../components/chrome/GrowingPager";
import { SortableHeader, type SortState } from "../../components/chrome/SortableHeader";
import { MarketplaceBadge } from "../../components/badges/MarketplaceBadge";
import { MARKETPLACES, MarketplaceSelect } from "../../components/pickers/MarketplaceSelect";
import { PersonFilterSelect } from "../../components/pickers/PersonFilterSelect";
import { type ShopSortKey, useDeleteShop, useShopPrimaries, useShops } from "../../features/shops/queries";
import { ShopFormDialog } from "../../features/shops/ShopFormDialog";
import { PrimaryCsDialog } from "./components/PrimaryCsDialog";
import { ShopOptionsFilter } from "./components/ShopOptionsFilter";
import { SHOPS_LIST_PENDING } from "./pending";

const PAGE_SIZE_OPTIONS = [10, 20, 50];

// The two columns the contract orders by (ShopSortKey).
const SORT_CODEC = nullableCodec(sortCodec(["name", "code"] as const));

// The primary CS filter: absent = anybody, else that person. "No primary CS" is a filter of its own (`nocs`), so a 0
// here is no pick.
const PRIMARY_CODEC = optionalCodec<bigint>({
  encode: idCodec.encode,
  decode: (raw) => {
    const id = idCodec.decode(raw);
    return id !== undefined && id > 0n ? id : undefined;
  },
});

// A ROW LIGHTS UP under the pointer, every cell of it (a-table-row-lights-up); Chakra's `_hover` honours `data-hover`.
const LIGHTS_UP = { _hover: { "& > td": { bg: "bg.muted" } } } as const;

// ShopsPage lists the CURRENT selling TEAM's marketplace shops (#66). Every RPC carries `current.teamId` in its body —
// the team is the scope, and a team only ever sees its own shops.
//
// IT FOLLOWS THE SCREEN RULES (owner: *"untuk toko normalisasi dengan keputusan tampilanku sebelumnya"*,
// `the-shop-screens-follow-the-screen-rules`), the supplier list's shape:
//
//   Toko [Toko Melati]                                                    [＋ Toko Baru]
//   Etalase marketplace tempat tim ini berjualan …
//   [⌕ Cari nama atau kode ×] [Semua marketplace ▾ ⚠1] [Semua CS utama ▾ ⚠2] [⚙ Filter ⌄ ⚠3 → ☐ Belum ada CS utama]
//   Nama ↕         │ Kode ↕  │ Marketplace │ CS utama            │             [✎ Ubah] [🗑 Hapus] [⋯]
//   Melati Official │ MEL-SHP │ Shopee      │ Ani Rahayu          │                     ⋯ → ⚙ Ganti CS Utama
//   Melati Store    │ MEL-TOK │ Tokopedia   │ Belum ada CS utama  │                     ⋯ → ⚙ Pilih CS Utama
//
// THE PRIMARY CS IS ITS OWN COLUMN, changed from the row's ⋯ (owner: *"kasih cs utamanya di bawah toko, dan ada aksi
// untuk mengubahnya"*, then *"jadi kolom saja karena masih luas juga, gantinya taruh di aksi"*, then *"pilih cs di
// ellipsis"*) — it is who an imported statement's rows with no order are counted for, and a shop with none cannot
// import. "None" is a line of text in the warning role, not a badge.
//
// THE MARKETPLACE, THE PRIMARY CS AND "NO PRIMARY CS", AHEAD OF THE CONTRACT (owner: *"oke tambahkan dengan warning,
// filter mp, cs utama sama belum ada cs"*, then *"bedakan belum ada csnya"*) — each is held in the URL and marked ⚠, its
// pick THROWN AWAY: ShopListFilter has only `q`. "No primary CS" is its own tick, apart from the person; the two
// cannot both hold, so setting one clears the other.
//
// The name and the code sort from their headings (the two the contract orders by); the whole row opens the shop; a phone
// reads each shop as a block; the first load is the list's shape; an empty list says what next; the pages grow.
export function ShopsPage() {
  const { current } = useTeam();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const isMobile = useIsMobile();

  // THE SEARCH AND THE SORT LIVE IN THE URL (a-lists-filters-live-in-the-url) — Back from a shop opens the same list.
  const [q, setQ] = useUrlState("q", "", textCodec);
  // `null` = the list's own order, newest first — no heading stands for it.
  const [sort, setSort] = useUrlState<SortState<ShopSortKey> | null>("sort", null, SORT_CODEC);
  // ⚠ Held and marked, NOT SENT (SHOPS_LIST_PENDING) — ShopListFilter cannot carry them yet.
  const [marketplace, setMarketplace] = useUrlState("market", Marketplace.UNSPECIFIED, enumCodec(MARKETPLACES));
  const [primaryCsId, setPrimaryCsId] = useUrlState<bigint | undefined>("cs", undefined, PRIMARY_CODEC);
  const [noPrimaryOnly, setNoPrimaryOnly] = useUrlState("nocs", false, boolCodec);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [editing, setEditing] = useState<Shop | null>(null);
  const [choosingPrimary, setChoosingPrimary] = useState<Shop | null>(null);

  // Typed, then settled — a word is one request, not one per key.
  const term = useDebounced(q.trim());
  const teamId = current?.teamId;

  const query = useShops({ teamId, q: term, sort, page, pageSize });
  const deleteShop = useDeleteShop();

  const shops = query.data?.shops ?? [];
  const totalItems = query.data?.totalItems ?? 0;
  // The rows carry their primary CS as an id; one UserByIDs names the page's.
  const primaries = useActors(shops.map((shop) => shop.primaryUserId));
  // The CS filter's people — those who are a primary CS on one of this team's shops.
  const primaryPeople = useShopPrimaries({ teamId });
  const loading = query.isPending;
  const error = query.isError ? rpcError(query.error) : "";

  // A search, a filter or a sort is a new question, so it starts again at page one.
  function refilter(change: () => void) {
    change();
    setPage(1);
  }
  const sortBy = (next: SortState<ShopSortKey> | null) => refilter(() => setSort(next));
  const clearFilters = () =>
    refilter(() => {
      setQ("");
      setMarketplace(Marketplace.UNSPECIFIED);
      setPrimaryCsId(undefined);
      setNoPrimaryOnly(false);
    });
  const filterCount = [
    q.trim() !== "",
    marketplace !== Marketplace.UNSPECIFIED,
    primaryCsId !== undefined,
    noPrimaryOnly,
  ].filter(Boolean).length;

  // `mutateAsync`, not `mutate`, because ConfirmDialog AWAITS its onConfirm to hold the button in its loading state.
  // mutateAsync REJECTS on failure, which is why the catch is not optional.
  async function remove(shop: Shop) {
    if (teamId === undefined) {
      return;
    }

    try {
      await deleteShop.mutateAsync({ teamId, shopId: shop.id });
      toaster.create({ type: "success", title: t("shops.deleted", { name: shop.name }) });
    } catch (err) {
      toaster.create({ type: "error", title: t("shops.deleteFailed"), description: rpcError(err) });
    }
  }

  if (!current) {
    return (
      <Stack gap="section">
        <Heading size="md">{t("shops.title")}</Heading>
        <Text color="fg.muted" data-testid="shops-no-team">
          {t("shops.selectTeam")}
        </Text>
      </Stack>
    );
  }

  const open = (shop: Shop) => navigate(`/shops/${shop.id}`);

  // Edit and Delete inline, each a labelled button with its icon (an-action-button-carries-its-icon); the primary CS in
  // the ⋯ after them (owner: *"pilih cs di ellipsis"*), a menu item with its icon. The same on a row and on a phone
  // block.
  function actions(shop: Shop) {
    const none = shop.primaryUserId === 0n;

    return (
      <HStack justify="end" gap="1.5">
        <Button size="xs" variant="outline" data-testid={`edit-${shop.shopCode}`} onClick={() => setEditing(shop)}>
          <Icon as={Pencil} boxSize="4" />
          {t("shops.editAction")}
        </Button>

        <ConfirmDialog
          title={t("shops.deleteShop")}
          message={t("shops.deleteConfirm", { name: shop.name })}
          confirmLabel={t("shops.delete")}
          onConfirm={() => remove(shop)}
          trigger={
            <Button size="xs" variant="outline" colorPalette="error" data-testid={`delete-${shop.shopCode}`}>
              <Icon as={Trash2} boxSize="4" />
              {t("shops.delete")}
            </Button>
          }
        />

        <Menu.Root>
          <Menu.Trigger asChild>
            <IconButton
              size="xs"
              variant="ghost"
              aria-label={t("shops.table.actions")}
              data-testid={`shop-actions-${shop.shopCode}`}
            >
              <Icon as={MoreHorizontal} boxSize="4" />
            </IconButton>
          </Menu.Trigger>
          <Portal>
            <Menu.Positioner>
              <Menu.Content>
                <Menu.Item
                  value="primary"
                  data-testid={`shop-primary-change-${shop.shopCode}`}
                  onClick={() => setChoosingPrimary(shop)}
                >
                  <Icon as={UserCog} boxSize="4" />
                  {none ? t("shops.primary.choose") : t("shops.primary.change")}
                </Menu.Item>
              </Menu.Content>
            </Menu.Positioner>
          </Portal>
        </Menu.Root>
      </HStack>
    );
  }

  function shopName(shop: Shop) {
    return (
      <Text fontWeight="bold" data-testid={`open-shop-${shop.shopCode}`}>
        {shop.name}
      </Text>
    );
  }

  // The shop's primary CS, by name. A shop with none says so in words, in the warning role — not a badge: it cannot
  // import its statements until one is chosen (the-primary-cs-is-a-flag-on-a-grant).
  function primaryCs(shop: Shop) {
    if (shop.primaryUserId === 0n) {
      return (
        <Text color="warning.fg" data-testid={`shop-no-primary-${shop.shopCode}`}>
          {t("shops.noPrimary")}
        </Text>
      );
    }

    const person = primaries.data?.get(shop.primaryUserId.toString());
    if (person) {
      return <Text>{person.name || person.username}</Text>;
    }

    return primaries.isPending ? <Skeleton h="3" w="20" /> : <Text>#{shop.primaryUserId.toString()}</Text>;
  }

  function list() {
    if (shops.length === 0 && !error) {
      // AN EMPTY LIST SAYS WHAT NEXT (an-empty-list-shows-a-hint) — nothing matches: clear the search; nothing yet: add one.
      return term !== "" ? (
        <EmptyHint
          icon={SearchX}
          title={t("shops.none")}
          description={t("emptyHint.noMatch")}
          action={
            <Button variant="outline" colorPalette="gray" onClick={clearFilters}>
              {t("common.clearFilters")}
            </Button>
          }
          testId="shops-none-match"
        />
      ) : (
        <EmptyHint
          icon={Store}
          title={t("shops.empty")}
          description={t("shops.emptyHint")}
          action={<ShopFormDialog />}
          testId="shops-empty"
        />
      );
    }

    if (isMobile) {
      // A PHONE READS EACH SHOP AS A BLOCK (a-phone-reads-each-line-as-a-block) — the name at full width, its code and
      // marketplace, then its primary CS by name alone; the block opens the shop, its actions at its foot.
      return (
        <Stack gap="2" data-testid="shops-table">
          {shops.map((shop) => (
            <Stack
              key={shop.id.toString()}
              data-testid={`shop-row-${shop.shopCode}`}
              borderWidth="1px"
              borderRadius="md"
              p="3"
              gap="1.5"
              {...PRESSABLE}
              onClick={() => open(shop)}
            >
              {shopName(shop)}
              <HStack gap="2" fontSize="sm" color="fg.muted">
                <Text>{shop.shopCode}</Text>
                <MarketplaceBadge marketplace={shop.marketplace} />
              </HStack>
              {/* The person alone — no "CS utama ·" before it (owner: *"di mobile tidak perlu ada teks cs utama di sebelum
                  cs"*). */}
              <Box fontSize="sm" data-testid={`shop-primary-${shop.shopCode}`}>
                {primaryCs(shop)}
              </Box>
              <Box pt="1" onClick={(e) => e.stopPropagation()}>
                {actions(shop)}
              </Box>
            </Stack>
          ))}
        </Stack>
      );
    }

    return (
      <Table.Root size="sm" data-testid="shops-table">
        <Table.Header>
          <Table.Row>
            {/* THE SORT IS IN THE HEADINGS (a-table-sorts-from-its-headings) — the two the contract can order by, A to Z
                first. */}
            <SortableHeader
              column="name"
              label={t("shops.table.name")}
              sort={sort}
              onSortChange={sortBy}
              firstDir="asc"
              testId="shop-sort-name"
            />
            <SortableHeader
              column="code"
              label={t("shops.table.code")}
              sort={sort}
              onSortChange={sortBy}
              firstDir="asc"
              testId="shop-sort-code"
            />
            <Table.ColumnHeader>{t("shops.table.marketplace")}</Table.ColumnHeader>
            <Table.ColumnHeader>{t("shops.table.primary")}</Table.ColumnHeader>
            <Table.ColumnHeader textAlign="end">{t("shops.table.actions")}</Table.ColumnHeader>
          </Table.Row>
        </Table.Header>

        <Table.Body>
          {shops.map((shop) => (
            <Table.Row
              key={shop.id.toString()}
              data-testid={`shop-row-${shop.shopCode}`}
              cursor="pointer"
              css={LIGHTS_UP}
              onClick={() => open(shop)}
            >
              <Table.Cell>{shopName(shop)}</Table.Cell>
              <Table.Cell whiteSpace="nowrap">{shop.shopCode}</Table.Cell>
              <Table.Cell>
                <MarketplaceBadge marketplace={shop.marketplace} />
              </Table.Cell>
              <Table.Cell data-testid={`shop-primary-${shop.shopCode}`}>{primaryCs(shop)}</Table.Cell>
              {/* Stop the row's navigate from firing when a row action is used. */}
              <Table.Cell textAlign="end" onClick={(e) => e.stopPropagation()}>
                {actions(shop)}
              </Table.Cell>
            </Table.Row>
          ))}
        </Table.Body>
      </Table.Root>
    );
  }

  return (
    // The page arrives — a fade and a short rise (motion-is-small-quick-and-shared).
    <Stack gap="section" animationStyle="enter" data-testid="shops-page">
      {/* THE TITLE AND THE SUBTITLE AS ONE BLOCK, New Shop on its row — the ＋ alone on a phone
          (a-phone-header-action-is-an-icon). */}
      <Flex align="start" gap="card" wrap={isMobile ? "nowrap" : "wrap"}>
        <Stack gap="1" flex="1 1 16rem" minW="0">
          <HStack gap="card" wrap="wrap">
            <Heading size="md">{t("shops.title")}</Heading>
            <Badge colorPalette="brand">{current.teamName || `Team #${current.teamId}`}</Badge>
          </HStack>
          <Text color="fg.muted" fontSize="sm">
            {t("shops.lead")}
          </Text>
        </Stack>
        <ShopFormDialog compact={isMobile} />
      </Flex>

      {/* What this list cannot do yet — the three filters it holds and throws away. */}
      <NotImplementedSummary list={SHOPS_LIST_PENDING} />

      {/* THE SHARED FILTER STRIP (a-phone-filters-from-a-sheet) — the search, with its icon and its ×, then the
          marketplace and the primary CS, each with its own × (every-filter-clears-from-its-own-x); the sort is the
          headings'. */}
      <FilterBar testId="shops-filter" active={filterCount > 0} count={filterCount} onClear={clearFilters}>
        <FilterSearch
          value={q}
          onChange={(value) => refilter(() => setQ(value))}
          placeholder={t("shops.searchPlaceholder")}
          testId="shop-search"
        />

        {/* A static, small set — a plain list, not a search. */}
        <FilterField w="15rem" testId="shops-marketplace-filter">
          <Flex align="center" gap="1">
            <Box flex="1" minW="0">
              <MarketplaceSelect
                clearable
                // Its own address — the New Shop form on this page picks a marketplace too.
                testId="shops-marketplace-select"
                value={marketplace}
                placeholder={t("shops.filter.marketplaceAll")}
                onChange={(m) => refilter(() => setMarketplace(m))}
              />
            </Box>
            <NotImplemented list={SHOPS_LIST_PENDING} id="marketplaceFilter" />
          </Flex>
        </FilterField>

        {/* WHO HOLDS THE SHOP — the people who are a primary CS on this team's shops
            (a-who-filter-lists-the-people-on-its-rows). Picking one lifts "No primary CS". */}
        <FilterField w="15rem" testId="shops-primary-filter">
          <Flex align="center" gap="1">
            <Box flex="1" minW="0">
              <PersonFilterSelect
                people={primaryPeople.data}
                error={primaryPeople.isError}
                value={primaryCsId}
                placeholder={t("shops.filter.primaryAll")}
                onChange={(id) =>
                  refilter(() => {
                    setPrimaryCsId(id);
                    if (id !== undefined) setNoPrimaryOnly(false);
                  })
                }
              />
            </Box>
            <NotImplemented list={SHOPS_LIST_PENDING} id="primaryFilter" />
          </Flex>
        </FilterField>

        {/* THE SHOPS WITH NO PRIMARY CS — its own tick (owner: *"bedakan belum ada csnya"*), in the Filter panel
            (*"pakai panel untuk checkbox"*): the shops that cannot import. Ticking it lifts the person. */}
        <FilterField w="auto" testId="shops-no-primary-filter">
          <ShopOptionsFilter
            noPrimaryOnly={noPrimaryOnly}
            onNoPrimaryOnlyChange={(next) =>
              refilter(() => {
                setNoPrimaryOnly(next);
                if (next) setPrimaryCsId(undefined);
              })
            }
          />
        </FilterField>
      </FilterBar>

      {error && (
        <Text color="error.fg" data-testid="shops-error">
          {error}
        </Text>
      )}

      {/* THE FIRST LOAD SHOWS THE LIST'S SHAPE, and the rows fade in over it — once; a refresh keeps them mounted
          (motion-is-small-quick-and-shared). */}
      {loading ? (
        <ListSkeleton testId="shops-loading" />
      ) : (
        <Box animationStyle="swap">
          <RefreshOverlay busy={query.isFetching && !query.isPending}>{list()}</RefreshOverlay>
        </Box>
      )}

      {/* THE PAGES GROW AS THEY ARE OPENED (every-list-pages-with-the-growing-pager). */}
      <GrowingPager
        page={page}
        onPageChange={setPage}
        hasNext={query.isPlaceholderData ? undefined : page * pageSize < totalItems}
        resetKey={[term, sort ? `${sort.by}:${sort.dir}` : "", marketplace, primaryCsId ?? "", noPrimaryOnly, pageSize].join(
          "|",
        )}
        pageSize={pageSize}
        pageSizeOptions={PAGE_SIZE_OPTIONS}
        onPageSizeChange={(n) => {
          setPageSize(n);
          setPage(1);
        }}
        testId="shops-pager"
      />

      {/* One edit dialog, driven by the row's Edit action. Keyed so it re-initialises per shop. */}
      {editing && (
        <ShopFormDialog
          key={editing.id.toString()}
          shop={editing}
          open
          onOpenChange={(o) => {
            if (!o) setEditing(null);
          }}
        />
      )}

      {/* One primary-CS dialog, driven by the row's ⋯. Keyed so its pick starts from that shop. */}
      {choosingPrimary && (
        <PrimaryCsDialog
          key={choosingPrimary.id.toString()}
          shop={choosingPrimary}
          onClose={() => setChoosingPrimary(null)}
        />
      )}
    </Stack>
  );
}

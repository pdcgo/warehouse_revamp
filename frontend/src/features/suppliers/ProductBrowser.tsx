import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Box, HStack, Stack, Table, Text } from "@chakra-ui/react";
import type { SupplierChannelRecord } from "./adapt";
import { ChannelName, LIGHTS_UP } from "./ChannelBrowser";
import { sampleProductsFor, type SampleProduct } from "./sampleProducts";
import { TeamType } from "../../gen/warehouse/team/v1/team_pb";
import { formatUnixDate } from "../../lib/datetime";
import { useIsMobile } from "../../layouts/shell";
import { FilterBar, FilterField, FilterSearch } from "../../components/chrome/FilterBar";
import { GrowingPager } from "../../components/chrome/GrowingPager";
import { MarketplaceBadge } from "../../components/badges/MarketplaceBadge";
import { ProductListItem } from "../../components/products/ProductListItem";
import { TeamItem } from "../../components/entity/TeamItem";
import { RestockTeamFilter } from "./FigureParts";
import { SupplierStoreSelect } from "./SupplierStoreSelect";

const PAGE_SIZE_OPTIONS = [10, 20, 50];

// The product as the app draws a product everywhere — its picture, its name, its SKU under it.
function productOf(p: SampleProduct) {
  return { id: p.id, name: p.name, sku: p.sku, defaultImageThumbnailUrl: p.thumbnailUrl };
}

// WHEN IT WAS BOUGHT — the last restock, and the first under it when they differ: one fact read twice, so one cell
// (one-context-per-column-and-never-three-lines). Bought once, it is one date.
function Bought({ product }: { product: SampleProduct }) {
  const { t } = useTranslation();
  const last = formatUnixDate(product.lastBoughtAt);
  const first = formatUnixDate(product.firstBoughtAt);

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

// ProductBrowser is a supplier's PRODUCTS tab — on the manage detail and on the discover detail alike
// (supplier-detail-has-channels-and-products-tabs): every product bought at one of its stores, by any team
// (every-accepted-line-links-its-own-product) — the product with its picture and SKU, the team whose product it is,
// the store it was bought at, and when: the last restock and the first (a-link-remembers-its-last-restock), newest
// first. Searched, narrowed to one store or one team (owner: *"di produk tambah toko pemasok"*, *"tim juga"*), and paged.
//
//   Produk                        Tim               Toko pemasok              Terakhir dibeli
//   [▦] Kain Katun Jepang 1 rol   [TM] Toko Melati  Sumber Makmur Official    8 Okt 2026
//       KTN-JP-01                      Penjual      [Shopee]                  pertama 9 Sep 2026
//
// ⚠ SAMPLE ROWS. The link a restock writes is not built yet, so the rows are invented from the supplier's channels;
// each page that mounts this carries the `sample` mark. The search and the pager run over those rows here; the real
// read will do both on the server.
export function ProductBrowser({ channels }: { channels: SupplierChannelRecord[] }) {
  const { t } = useTranslation();
  const isMobile = useIsMobile();

  const [q, setQ] = useState("");
  // One of the supplier's stores, and one selling team — 0n is every one.
  const [storeId, setStoreId] = useState(0n);
  const [teamId, setTeamId] = useState(0n);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  // A filter change is a new question, so it starts again at page one.
  function refilter(change: () => void) {
    change();
    setPage(1);
  }

  const all = sampleProductsFor(channels);
  const term = q.trim().toLowerCase();
  const filtering = term !== "" || storeId !== 0n || teamId !== 0n;
  // The product, its SKU, or the channel it is bought from — what somebody looking for a source would type.
  const matching = all.filter(
    (p) =>
      (term === "" || [p.name, p.sku, p.channel.name].some((field) => field.toLowerCase().includes(term))) &&
      (storeId === 0n || p.channel.id === storeId) &&
      (teamId === 0n || p.teamId === teamId),
  );
  // One team picked, the Team column would say the same name on every row — it goes, as on the Statistik tab.
  const showTeam = teamId === 0n;
  const products = matching.slice((page - 1) * pageSize, page * pageSize);

  function list() {
    if (products.length === 0) {
      return filtering ? (
        <Text color="fg.muted" data-testid="products-none-match">
          {t("supplierChannel.products.none")}
        </Text>
      ) : (
        <Text color="fg.muted" data-testid="products-empty">
          {t("supplierChannel.products.empty")}
        </Text>
      );
    }

    if (isMobile) {
      // A phone reads each product as a block (a-phone-reads-each-line-as-a-block): the product with its team beside
      // the SKU, then the store it was bought at, then when.
      return (
        <Stack gap="2" data-testid="products-table">
          {products.map((p) => (
            <Stack key={p.key} data-testid={`product-row-${p.key}`} borderWidth="1px" borderRadius="md" p="3" gap="2">
              <ProductListItem product={productOf(p)} teamName={showTeam ? p.teamName : undefined} />
              <HStack gap="2" fontSize="sm" minW="0">
                <Text lineClamp={1}>{p.channel.name}</Text>
                <MarketplaceBadge marketplace={p.channel.channelType} />
              </HStack>
              {/* The first restock on its OWN line, as on a desktop (owner: *"oke"*, `the-first-restock-has-its-own-line`)
                  — after a dot it wrapped mid-date, the year alone on the next line. */}
              <Stack gap="0" fontSize="sm" color="fg.muted">
                <Text data-testid={`product-row-${p.key}-last`}>
                  {t("supplierChannel.products.lastBought")} {formatUnixDate(p.lastBoughtAt)}
                </Text>
                {p.firstBoughtAt !== p.lastBoughtAt && (
                  <Text data-testid={`product-row-${p.key}-first`}>
                    {t("supplierChannel.products.firstBought", { date: formatUnixDate(p.firstBoughtAt) })}
                  </Text>
                )}
              </Stack>
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
          </Table.Row>
        </Table.Header>

        <Table.Body>
          {products.map((p) => (
            <Table.Row key={p.key} data-testid={`product-row-${p.key}`} css={LIGHTS_UP}>
              <Table.Cell>
                <Box minW="15rem">
                  <ProductListItem product={productOf(p)} />
                </Box>
              </Table.Cell>
              {showTeam && (
                <Table.Cell>
                  <Box maxW="15rem">
                    <TeamItem team={{ teamName: p.teamName, teamType: TeamType.SELLING }} />
                  </Box>
                </Table.Cell>
              )}
              <Table.Cell>
                <ChannelName channel={p.channel} bold={false} />
              </Table.Cell>
              <Table.Cell>
                <Bought product={p} />
              </Table.Cell>
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
        active={filtering}
        count={(term !== "" ? 1 : 0) + (storeId !== 0n ? 1 : 0) + (teamId !== 0n ? 1 : 0)}
        onClear={() =>
          refilter(() => {
            setQ("");
            setStoreId(0n);
            setTeamId(0n);
          })
        }
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
          <RestockTeamFilter value={teamId} onChange={(id) => refilter(() => setTeamId(id))} />
        </FilterField>

        <FilterField w="15rem" testId="products-store-filter">
          <SupplierStoreSelect
            stores={channels}
            value={storeId}
            onChange={(id) => refilter(() => setStoreId(id))}
            placeholder={t("supplierChannel.products.storeAll")}
            testId="products-store"
          />
        </FilterField>
      </FilterBar>

      {list()}

      {/* every-list-pages-with-the-growing-pager — the pages opened so far, one click back to any of them. */}
      <GrowingPager
        page={page}
        onPageChange={setPage}
        hasNext={page * pageSize < matching.length}
        resetKey={[term, storeId, teamId, pageSize].join("|")}
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

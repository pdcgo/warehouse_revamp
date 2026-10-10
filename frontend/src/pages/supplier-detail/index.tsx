import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router-dom";
import { Button, Flex, HStack, Heading, Icon, Spinner, Stack, Tabs, Text } from "@chakra-ui/react";
import { ArrowLeft } from "lucide-react";
import { rpcError } from "../../api/clients";
import { TeamType } from "../../gen/warehouse/team/v1/team_pb";
import { useTeam } from "../../features/team/TeamContext";
import { useSupplier, useSupplierChannels } from "../../features/suppliers/queries";
import { NotImplemented } from "../../features/pending/NotImplemented";
import { NotImplementedSummary } from "../../features/pending/NotImplementedSummary";
import { ChannelsPanel } from "./components/ChannelsPanel";
import { ProductBrowser } from "../../features/suppliers/ProductBrowser";
import { SupplierStatistics } from "../../features/suppliers/SupplierStatistics";
import { useIsMobile } from "../../layouts/shell";
import { SUPPLIER_DETAIL_PENDING } from "./pending";
import { SupplierMeta } from "./components/SupplierMeta";
import { SupplierHeaderActions } from "./components/SupplierHeaderActions";

function parseSupplierId(raw: string | undefined): bigint {
  if (!raw) return 0n;
  try {
    return BigInt(raw);
  } catch {
    return 0n;
  }
}

// SupplierDetailPage is the dedicated detail route for a supplier — a PAGE, not a dialog. Its name and its own actions on
// top, who it is in a line under the name (`the-supplier-is-described-under-its-name`), then three horizontal tabs
// (supplier-detail-has-channels-and-products-tabs, the-figures-are-a-statistics-tab-and-a-supplier-report):
//
//   ← Kembali ke Pemasok
//   PT Sumber Makmur                                        [✎ Ubah] [🗑 Hapus]   ← ⋯ on a phone
//   ☎ 0812-1111-2222 ⧉    📍 Jl. Soekarno-Hatta 112, Bandung
//   Grosir kain dan benang, minimal order 1 rol.
//   Toko | Produk | Statistik
//
//   Channels   — every store the supplier sells through, one list, each with its marketplace badge. Its word is
//                Toko in an action, Toko pemasok in a table or a description (toko-in-an-action-toko-pemasok-in-a-table).
//   Products   — what was bought from the supplier: the product, whose it is, the store and when, first and last
//                (a-supplier-product-row-says-whose-where-and-when). ⚠ SAMPLE rows until an
//                accepted restock links a product to its store (restock-accepted-links-the-product-to-its-channel).
//   Statistics — what was restocked from it, lost and broken on the way, over time and by product — folded from the
//                restock's accept (the-figures-screens-are-accepted).
//
// Reached by clicking a supplier row. ⚠ SupplierDetail answers for ANY team's live supplier (reads cross
// teams), so this page does not assume the supplier is ours: the store actions are offered only when the
// current team keeps it — another team's, reached by a typed URL, reads like the discover detail.
export function SupplierDetailPage() {
  const { supplierId } = useParams();
  const navigate = useNavigate();
  const { current } = useTeam();
  const { t } = useTranslation();
  const isMobile = useIsMobile();

  const id = parseSupplierId(supplierId);
  const teamId = current?.teamId;

  // Two queries, not one. They failed independently before — a channel-list error did not blank the
  // supplier — and folding them together would let one request's failure hide the other's result.
  const supplierQuery = useSupplier({ teamId, supplierId: id });
  const channelsQuery = useSupplierChannels({ teamId, supplierId: id });

  const supplier = supplierQuery.data ?? null;
  const loading = supplierQuery.isPending && id !== 0n;

  // A malformed id never reaches the server (the queries are disabled for it), so its message is
  // produced here rather than by an error no request produced.
  const error =
    id === 0n
      ? t("supplierChannel.detail.invalidId")
      : supplierQuery.isError
        ? rpcError(supplierQuery.error)
        : "";

  // The whole list — the Products tab's sample rows are made from it. The Channels tab reads its own searched,
  // filtered page from the server (ChannelBrowser).
  const channels = channelsQuery.data ?? [];

  // Only the team that KEEPS the supplier writes to it — supplier_service answers NotFound to anyone else — and
  // only a selling team keeps suppliers (only-a-selling-team-has-suppliers). The server is the real boundary
  // either way; this keeps the page from offering what it would refuse.
  const canManage =
    current?.teamType === TeamType.SELLING && supplier !== null && supplier.teamId === current.teamId;

  const back = (
    <Button
      size="xs"
      variant="ghost"
      alignSelf="flex-start"
      data-testid="supplier-detail-back"
      onClick={() => navigate("/inventories/suppliers")}
    >
      <Icon as={ArrowLeft} boxSize="4" />
      {t("supplierChannel.detail.back")}
    </Button>
  );

  if (!current || teamId === undefined) {
    return (
      <Stack gap="section">
        <Heading size="md">{t("suppliers.title")}</Heading>
        <Text color="fg.muted" data-testid="supplier-detail-no-team">
          {t("supplierChannel.detail.selectTeam")}
        </Text>
      </Stack>
    );
  }

  if (loading) {
    return <Spinner colorPalette="brand" />;
  }

  if (error || !supplier) {
    return (
      <Stack gap="section">
        {back}
        <Text color="error.fg" data-testid="supplier-detail-error">
          {error || t("supplierChannel.detail.notFound")}
        </Text>
      </Stack>
    );
  }

  return (
    <Stack gap="section" data-testid="supplier-detail-page">
      {back}

      {/* THE NAME AND ITS ACTIONS — one row; on a phone it stays one row, the actions in ⋯ (`the-phone-header-is-one-row`).
          Who the supplier is sits right under it, in words (`the-supplier-is-described-under-its-name`). */}
      <Stack gap="1.5">
        <Flex align="center" gap="card" wrap={isMobile ? "nowrap" : "wrap"}>
          <Heading size="md" flex="1 1 16rem" minW="0" truncate={isMobile} data-testid="supplier-detail-name">
            {supplier.name}
          </Heading>
          {canManage && <SupplierHeaderActions teamId={teamId} supplier={supplier} folded={isMobile} />}
        </Flex>
        <SupplierMeta supplier={supplier} />
      </Stack>

      <NotImplementedSummary list={SUPPLIER_DETAIL_PENDING} />

      <Tabs.Root defaultValue="channels" lazyMount unmountOnExit data-testid="supplier-tabs">
        <Tabs.List>
          <Tabs.Trigger value="channels" data-testid="supplier-tab-channels">
            {t("supplierChannel.tab.channels")}
          </Tabs.Trigger>
          <Tabs.Trigger value="products" data-testid="supplier-tab-products">
            <HStack gap="1">
              {t("supplierChannel.tab.products")}
              <NotImplemented list={SUPPLIER_DETAIL_PENDING} id="products" />
            </HStack>
          </Tabs.Trigger>
          <Tabs.Trigger value="statistics" data-testid="supplier-tab-statistics">
            {t("supplierChannel.tab.statistics")}
          </Tabs.Trigger>
        </Tabs.List>

        <Tabs.Content value="channels">
          <ChannelsPanel teamId={teamId} supplierId={supplier.id} canManage={canManage} />
        </Tabs.Content>

        <Tabs.Content value="products">
          <ProductBrowser channels={channels} />
        </Tabs.Content>

        <Tabs.Content value="statistics">
          <SupplierStatistics supplierId={supplier.id} />
        </Tabs.Content>
      </Tabs.Root>
    </Stack>
  );
}

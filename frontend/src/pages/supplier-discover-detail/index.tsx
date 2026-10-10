import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router-dom";
import { Box, Button, Card, HStack, Heading, Icon, SimpleGrid, Spinner, Stack, Tabs, Text } from "@chakra-ui/react";
import { ArrowLeft } from "lucide-react";
import { rpcError } from "../../api/clients";
import { TeamType } from "../../gen/warehouse/team/v1/team_pb";
import { useTeam } from "../../features/team/TeamContext";
import { useDiscoverSupplier } from "../../features/suppliers/discover";
import { useSupplierChannels } from "../../features/suppliers/queries";
import { ChannelBrowser } from "../../features/suppliers/ChannelBrowser";
import { ProductBrowser } from "../../features/suppliers/ProductBrowser";
import { SupplierStatistics } from "../../features/suppliers/SupplierStatistics";
import { NotImplemented } from "../../features/pending/NotImplemented";
import { NotImplementedSummary } from "../../features/pending/NotImplementedSummary";
import { TeamItem } from "../../components/entity/TeamItem";
import { DISCOVER_SUPPLIER_DETAIL_PENDING } from "./pending";

function parseSupplierId(raw: string | undefined): bigint {
  if (!raw) return 0n;
  try {
    return BigInt(raw);
  } catch {
    return 0n;
  }
}

// A labelled read-only field; a dash keeps the layout from collapsing on an empty value.
function Field({ label, value, testId }: { label: string; value: string; testId?: string }) {
  return (
    <Stack gap="0.5" minW="0">
      <Text fontSize="xs" fontWeight="bold" color="fg.muted" textTransform="uppercase">
        {label}
      </Text>
      <Text fontSize="sm" lineClamp={3} whiteSpace="pre-line" data-testid={testId}>
        {value || "—"}
      </Text>
    </Stack>
  );
}

// DiscoverSupplierDetailPage is ANOTHER team's supplier, read in full (another-team-sees-everything-of-a-supplier)
// — reached from Discover Suppliers, independent of the manage detail, which answers the owning team only and
// carries its edit actions. Here nothing is editable: the supplier, the team that keeps it, and the same three
// horizontal tabs as the manage detail (supplier-detail-has-channels-and-products-tabs,
// the-figures-are-a-statistics-tab-and-a-supplier-report) — Channels, searched, filtered by type and paged, Products,
// and Statistics, every team's restocks from it included (every-selling-team-sees-every-teams-figures).
//
// The supplier, its stores and its figures are real — supplier_service reads any team's live supplier. ⚠ The Products
// tab is still SAMPLE rows (./pending.ts).
export function DiscoverSupplierDetailPage() {
  const { supplierId } = useParams();
  const navigate = useNavigate();
  const { current } = useTeam();
  const { t } = useTranslation();

  const id = parseSupplierId(supplierId);
  const query = useDiscoverSupplier({ teamId: current?.teamId, supplierId: id });
  const supplier = query.data ?? null;
  // The WHOLE store list — the Products tab's sample rows are made from every store. The Channels tab reads its
  // own searched, filtered page from the server (ChannelBrowser).
  const channelsQuery = useSupplierChannels({ teamId: current?.teamId, supplierId: id });

  const error =
    id === 0n ? t("supplierChannel.detail.invalidId") : query.isError ? rpcError(query.error) : "";

  const back = (
    <Button
      size="xs"
      variant="ghost"
      alignSelf="flex-start"
      data-testid="discover-detail-back"
      onClick={() => navigate("/inventories/suppliers/discover")}
    >
      <Icon as={ArrowLeft} boxSize="4" />
      {t("suppliers.discover.back")}
    </Button>
  );

  if (!current) {
    return (
      <Stack gap="section">
        <Heading size="md">{t("suppliers.discover.title")}</Heading>
        <Text color="fg.muted" data-testid="discover-detail-no-team">
          {t("suppliers.selectTeam")}
        </Text>
      </Stack>
    );
  }

  if (query.isPending && id !== 0n) {
    return <Spinner colorPalette="brand" />;
  }

  if (error || !supplier) {
    return (
      <Stack gap="section">
        {back}
        <Text color="error.fg" data-testid="discover-detail-error">
          {error || t("suppliers.discover.notFound")}
        </Text>
      </Stack>
    );
  }

  return (
    <Stack gap="section" data-testid="discover-detail-page">
      {back}

      <Stack gap="2">
        <Heading size="md" data-testid="discover-detail-name">
          {supplier.name}
        </Heading>
        {/* Whose supplier this is — the thing worth knowing on a cross-team page, and who to ask about it. */}
        <Box maxW="20rem" data-testid="discover-detail-team">
          <TeamItem team={{ teamId: supplier.teamId, teamName: supplier.teamName, teamType: TeamType.SELLING }} />
        </Box>
      </Stack>

      <NotImplementedSummary list={DISCOVER_SUPPLIER_DETAIL_PENDING} />

      <Card.Root>
        <Card.Body>
          <SimpleGrid columns={{ base: 1, sm: 3 }} gap="card">
            <Field label={t("supplierChannel.detail.contact")} value={supplier.contact} testId="discover-detail-contact" />
            <Field label={t("supplierChannel.detail.address")} value={supplier.address} testId="discover-detail-address" />
            <Field label={t("supplierChannel.detail.description")} value={supplier.description} />
          </SimpleGrid>
        </Card.Body>
      </Card.Root>

      <Tabs.Root defaultValue="channels" lazyMount unmountOnExit data-testid="supplier-tabs">
        <Tabs.List>
          <Tabs.Trigger value="channels" data-testid="supplier-tab-channels">
            {t("supplierChannel.tab.channels")}
          </Tabs.Trigger>
          <Tabs.Trigger value="products" data-testid="supplier-tab-products">
            <HStack gap="1">
              {t("supplierChannel.tab.products")}
              <NotImplemented list={DISCOVER_SUPPLIER_DETAIL_PENDING} id="products" />
            </HStack>
          </Tabs.Trigger>
          <Tabs.Trigger value="statistics" data-testid="supplier-tab-statistics">
            {t("supplierChannel.tab.statistics")}
          </Tabs.Trigger>
        </Tabs.List>

        {/* Read-only: no Add Store, no row actions — this is another team's supplier. */}
        <Tabs.Content value="channels">
          <ChannelBrowser teamId={current.teamId} supplierId={supplier.id} />
        </Tabs.Content>

        <Tabs.Content value="products">
          <ProductBrowser channels={channelsQuery.data ?? []} />
        </Tabs.Content>

        <Tabs.Content value="statistics">
          <SupplierStatistics supplierId={supplier.id} />
        </Tabs.Content>
      </Tabs.Root>
    </Stack>
  );
}

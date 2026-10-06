import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router-dom";
import { Button, Card, HStack, Heading, Icon, SimpleGrid, Spinner, Stack, Tabs, Text } from "@chakra-ui/react";
import { ArrowLeft } from "lucide-react";
import { rpcError } from "../../api/clients";
import { TeamType } from "../../gen/warehouse/team/v1/team_pb";
import { useTeam } from "../../features/team/TeamContext";
import { useSupplier, useSupplierChannels } from "../../features/suppliers/queries";
import { NotImplemented } from "../../features/pending/NotImplemented";
import { NotImplementedSummary } from "../../features/pending/NotImplementedSummary";
import { ChannelsPanel } from "./components/ChannelsPanel";
import { ProductBrowser } from "../../features/suppliers/ProductBrowser";
import { SUPPLIER_DETAIL_PENDING } from "./pending";

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

// SupplierDetailPage is the dedicated detail route for a supplier — a PAGE, not a dialog. The supplier's own
// fields sit on top (a name, a contact, an address, a description); under them, two horizontal tabs
// (supplier-detail-has-channels-and-products-tabs):
//
//   Channels — every store the supplier sells through, one list, each with its marketplace badge.
//   Products — what the supplier sells, each with the channel it is bought from. ⚠ SAMPLE rows until the
//              channel-product linking is designed (linking-products-is-deferred).
//
// Reached by clicking a supplier row.
export function SupplierDetailPage() {
  const { supplierId } = useParams();
  const navigate = useNavigate();
  const { current } = useTeam();
  const { t } = useTranslation();

  const id = parseSupplierId(supplierId);
  // Only a selling team has suppliers (only-a-selling-team-has-suppliers), so only a selling team edits
  // their channels. The backend interceptor is the real boundary either way.
  const canManage = current?.teamType === TeamType.SELLING;

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
  // filtered page of the same query (one request).
  const channels = channelsQuery.data ?? [];

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

      <Heading size="md" data-testid="supplier-detail-name">
        {supplier.name}
      </Heading>

      <NotImplementedSummary list={SUPPLIER_DETAIL_PENDING} />

      <Card.Root>
        <Card.Body>
          <SimpleGrid columns={{ base: 1, sm: 3 }} gap="card">
            <Field label={t("supplierChannel.detail.contact")} value={supplier.contact} testId="supplier-detail-contact" />
            <Field label={t("supplierChannel.detail.address")} value={supplier.address} testId="supplier-detail-address" />
            <Field
              label={t("supplierChannel.detail.description")}
              value={supplier.description}
              testId="supplier-detail-description"
            />
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
              <NotImplemented list={SUPPLIER_DETAIL_PENDING} id="products" />
            </HStack>
          </Tabs.Trigger>
        </Tabs.List>

        <Tabs.Content value="channels">
          <ChannelsPanel teamId={teamId} supplierId={supplier.id} canManage={canManage} />
        </Tabs.Content>

        <Tabs.Content value="products">
          <ProductBrowser channels={channels} />
        </Tabs.Content>
      </Tabs.Root>
    </Stack>
  );
}

import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router-dom";
import {
  Alert,
  Avatar,
  Badge,
  Box,
  Button,
  Card,
  Grid,
  HStack,
  Heading,
  Icon,
  SimpleGrid,
  Spinner,
  Stack,
  Table,
  Text,
} from "@chakra-ui/react";
import { ArrowLeft, Package } from "lucide-react";
import { rpcError } from "../../api/clients";
import { TeamItem } from "../../components/entity/TeamItem";
import { pathToRoot } from "../../features/categories/categoryTree";
import { useAvailabilityByWarehouse } from "../../features/inventory/queries";
import { NotImplemented } from "../../features/pending/NotImplemented";
import { NotImplementedSummary } from "../../features/pending/NotImplementedSummary";
import { useDiscoverProduct } from "../../features/products/queries";
import { Field, Stat } from "../../features/products/RecordField";
import { useTeam } from "../../features/team/TeamContext";
import { useTeams, useTeamsByIds } from "../../features/teams/queries";
import { TeamType } from "../../gen/warehouse/team/v1/team_pb";
import { formatMarkup } from "../../lib/markup";
import { SuppliersCard } from "./components/SuppliersCard";
import { DISCOVER_DETAIL_PENDING } from "./pending";

function parseProductId(raw: string | undefined): bigint {
  if (!raw) return 0n;
  try {
    return BigInt(raw);
  } catch {
    return 0n;
  }
}

// DiscoverProductDetailPage is ANOTHER team's product, read by a selling team deciding whether to sell
// it (/products/discover/:id, reached from a discover card). Independent of the owner's detail
// (/products/:id) because it answers a different person: the owner manages the record and its cost
// story; this reader can change nothing and asks three things of it —
//
//   WHAT is it, and WHOSE   the record, with the owning team named — on a cross-team page that is the
//                           fact worth knowing about a product.
//   ON WHAT TERMS           the cross markup and the owner's reserve — the two sharing rules a product
//                           carries (docs/business/product, Cross/Shared Products Rule).
//   WHERE, and HOW MANY     what each warehouse holds, since an order ships from exactly one.
//   BOUGHT FROM WHOM        the supplier stores that list it — shown even when the product is locked or
//                           archived, because a team may restock from another team's supplier itself.
//
// Read-only, and it never calls ProductDetail: that RPC answers only the owning team.
export function DiscoverProductDetailPage() {
  const { productId } = useParams();
  const navigate = useNavigate();
  const { current } = useTeam();
  const { t } = useTranslation();

  const id = parseProductId(productId);
  const teamId = current?.teamId;

  const query = useDiscoverProduct({ teamId, productId: id });
  const product = query.data?.product ?? null;
  const categories = query.data?.categories ?? [];

  // Three reads beside the record, each failing on its own: a missing owner name or warehouse figure
  // must never blank the product.
  const owners = useTeamsByIds({ ids: product ? [product.teamId] : [] });
  const warehouses = useTeams({ teamType: TeamType.WAREHOUSE, page: 1, pageSize: 100, reference: true });
  const warehouseList = warehouses.data?.teams ?? [];

  // Only worth asking while the product is on offer — an archived or locked one has nothing to take.
  const offered = product !== null && !product.deleted && !product.crossLocked;
  const availability = useAvailabilityByWarehouse({
    teamId,
    productId: offered ? id : 0n,
    warehouseIds: warehouseList.map((w) => w.id),
  });

  const loading = query.isPending && id !== 0n;
  const error = id === 0n ? t("discoverDetail.invalidId") : query.isError ? rpcError(query.error) : "";

  const back = (
    <Button
      size="xs"
      variant="ghost"
      alignSelf="flex-start"
      data-testid="discover-detail-back"
      onClick={() => navigate("/products/discover")}
    >
      <Icon as={ArrowLeft} boxSize="4" />
      {t("discoverDetail.back")}
    </Button>
  );

  if (!current) {
    return (
      <Stack gap="section">
        <Heading size="md">{t("discover.title")}</Heading>
        <Text color="fg.muted" data-testid="discover-detail-no-team">
          {t("discoverDetail.selectTeam")}
        </Text>
      </Stack>
    );
  }

  if (loading) {
    return <Spinner colorPalette="brand" />;
  }

  if (error || !product) {
    return (
      <Stack gap="section">
        {back}
        <Text color="error.fg" data-testid="discover-detail-error">
          {error || t("discoverDetail.notFound")}
        </Text>
      </Stack>
    );
  }

  const categoryLabel =
    product.categoryId > 0n
      ? pathToRoot(categories, product.categoryId)
          .map((c) => c.name)
          .join(" › ")
      : "";

  const owner = owners.data?.[product.teamId.toString()];
  const own = product.teamId === current.teamId;
  const cover = product.defaultImageUrl || product.defaultImageThumbnailUrl;
  const reserved = BigInt(product.reservedStock);

  return (
    <Stack gap="section" data-testid="discover-detail-page">
      {back}

      <Stack gap="0.5" minW="0">
        <HStack gap="2" wrap="wrap">
          <Heading size="md" data-testid="discover-detail-name">
            {product.name}
          </Heading>
          {product.deleted && <Badge colorPalette="gray">{t("products.tab.archived")}</Badge>}
          {!product.deleted && product.crossLocked && (
            <Badge colorPalette="gray" variant="outline">
              {t("products.table.locked")}
            </Badge>
          )}
        </HStack>
        <Text fontSize="sm" color="fg.muted">
          {product.sku}
          {categoryLabel && ` · ${categoryLabel}`}
        </Text>
      </Stack>

      <NotImplementedSummary list={DISCOVER_DETAIL_PENDING} />

      {/* Discovery lists the caller's own products too. Theirs has a fuller page — the cost story, the
          batches, the controls — so say so rather than show them the outsider's view of their own goods. */}
      {own && (
        <Alert.Root status="info" data-testid="discover-detail-own">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Title>{t("discoverDetail.own")}</Alert.Title>
          </Alert.Content>
          <Button
            size="xs"
            variant="outline"
            alignSelf="center"
            data-testid="discover-detail-open-own"
            onClick={() => navigate(`/products/${product.id}`)}
          >
            {t("discoverDetail.openOwn")}
          </Button>
        </Alert.Root>
      )}

      {/* Reachable only by URL — discovery hides both — so a link kept from last week must say why the
          product is no longer on offer instead of pretending it still is. */}
      {product.deleted ? (
        <Alert.Root status="warning" data-testid="discover-detail-archived">
          <Alert.Indicator />
          <Alert.Title>{t("discoverDetail.archived")}</Alert.Title>
        </Alert.Root>
      ) : (
        product.crossLocked && (
          <Alert.Root status="warning" data-testid="discover-detail-locked">
            <Alert.Indicator />
            <Alert.Title>{t("discoverDetail.locked")}</Alert.Title>
          </Alert.Root>
        )
      )}

      {/* Cover LEFT, record RIGHT, 1:3 — the owner's detail page's split, for the same reason: the
          picture identifies the product and the record is the part with fields to lay out. */}
      <Grid templateColumns={{ base: "1fr", md: "1fr 3fr" }} gap="card" alignItems="start">
        <Card.Root>
          <Card.Body>
            <Box aspectRatio="1" w="full" data-testid="discover-detail-cover">
              <Avatar.Root size="full" shape="square" variant="subtle" colorPalette="gray" display="flex">
                <Avatar.Fallback>
                  <Icon as={Package} boxSize="8" aria-label={t("discoverDetail.noImage")} />
                </Avatar.Fallback>
                <Avatar.Image src={cover || undefined} alt={product.name} />
              </Avatar.Root>
            </Box>
          </Card.Body>
        </Card.Root>

        <Card.Root minW="0">
          <Card.Body>
            <Stack gap="card">
              <SimpleGrid columns={{ base: 1, sm: 2 }} gap="card">
                <Stat label={t("discoverDetail.owner")} testId="discover-detail-owner">
                  <TeamItem
                    team={{
                      teamId: product.teamId,
                      teamName: owner?.name,
                      teamType: owner?.type,
                      imageUrl: owner?.imageUrl,
                    }}
                  />
                </Stat>

                <Field label={t("products.field.category")} value={categoryLabel} testId="discover-detail-category" />

                <Stat
                  label={t("products.field.crossMarkup")}
                  hint={t("discoverDetail.markupHint")}
                  testId="discover-detail-markup"
                >
                  <Badge colorPalette={product.crossMarkupBps > 0 ? "brand" : "gray"}>
                    {formatMarkup(product.crossMarkupBps)}
                  </Badge>
                </Stat>

                <Stat
                  label={t("products.field.reservedStock")}
                  hint={t("discoverDetail.reservedHint")}
                  testId="discover-detail-reserved"
                >
                  {t("products.stat.pcs", { n: reserved.toString() })}
                </Stat>
              </SimpleGrid>

              <Field
                label={t("products.field.description")}
                value={product.description}
                testId="discover-detail-description"
              />
            </Stack>
          </Card.Body>
        </Card.Root>
      </Grid>

      {offered && (
        <Card.Root data-testid="discover-detail-stock">
          <Card.Header>
            <Card.Title>{t("discoverDetail.stockHeading")}</Card.Title>
            <Card.Description>{t("discoverDetail.stockHelp")}</Card.Description>
          </Card.Header>
          <Card.Body>
            {warehouses.isPending || availability.isPending ? (
              <Spinner colorPalette="brand" size="sm" />
            ) : warehouses.isError || availability.isError ? (
              <Text color="error.fg" fontSize="sm" data-testid="discover-detail-stock-error">
                {rpcError(warehouses.error ?? availability.error)}
              </Text>
            ) : warehouseList.length === 0 ? (
              <Text color="fg.muted" fontSize="sm">
                {t("discoverDetail.noWarehouses")}
              </Text>
            ) : (
              <Table.Root size="sm">
                <Table.Header>
                  <Table.Row>
                    <Table.ColumnHeader>{t("discoverDetail.warehouse")}</Table.ColumnHeader>
                    <Table.ColumnHeader textAlign="end">{t("discoverDetail.onShelf")}</Table.ColumnHeader>
                    <Table.ColumnHeader textAlign="end">
                      <HStack gap="1" justify="flex-end">
                        {t("discoverDetail.canTake")}
                        <NotImplemented list={DISCOVER_DETAIL_PENDING} id="canTake" />
                      </HStack>
                    </Table.ColumnHeader>
                  </Table.Row>
                </Table.Header>
                <Table.Body>
                  {warehouseList.map((w) => {
                    const onShelf = availability.data?.get(w.id.toString());
                    // ⚠ UNSETTLED RULE (pending "canTake"): the shelf less the owner's reserve, floored at 0.
                    const canTake =
                      onShelf === undefined ? undefined : onShelf > reserved ? onShelf - reserved : 0n;

                    return (
                      <Table.Row key={w.id.toString()} data-testid={`discover-stock-row-${w.id}`}>
                        <Table.Cell>{w.name}</Table.Cell>
                        <Table.Cell textAlign="end" fontVariantNumeric="tabular-nums" data-testid={`discover-stock-shelf-${w.id}`}>
                          {onShelf === undefined ? "—" : onShelf.toString()}
                        </Table.Cell>
                        <Table.Cell
                          textAlign="end"
                          fontVariantNumeric="tabular-nums"
                          fontWeight="bold"
                          color={canTake === 0n ? "error.fg" : undefined}
                          data-testid={`discover-stock-take-${w.id}`}
                        >
                          {canTake === undefined ? "—" : canTake.toString()}
                        </Table.Cell>
                      </Table.Row>
                    );
                  })}
                </Table.Body>
              </Table.Root>
            )}
          </Card.Body>
        </Card.Root>
      )}

      <SuppliersCard teamId={current.teamId} productId={product.id} />
    </Stack>
  );
}

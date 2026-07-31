import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router-dom";
import {
  Badge,
  Box,
  Button,
  Card,
  Carousel,
  Flex,
  Grid,
  Heading,
  HStack,
  Icon,
  Image,
  SimpleGrid,
  Spacer,
  Spinner,
  Stack,
  Tabs,
  Text,
} from "@chakra-ui/react";
import { Archive, ArrowLeft, Pencil, RotateCcw } from "lucide-react";
import { Code, ConnectError } from "@connectrpc/connect";
import { rpcError } from "../../api/clients";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { toaster } from "../../components/Toaster";
import { useTeam } from "../../features/team/TeamContext";
import { useTeams } from "../../features/teams/queries";
import { TeamType } from "../../gen/warehouse/team/v1/team_pb";
import {
  useArchiveProduct,
  useProductActivity,
  useProductDetail,
  useRestoreProduct,
  useSetProductLocked,
} from "../../features/products/queries";
import { RestoreProductDialog } from "../../features/products/RestoreProductDialog";
import { pathToRoot } from "../../features/categories/categoryTree";
import type { Product } from "../../gen/warehouse/product/v1/product_pb";
import { formatMarkup } from "../../lib/markup";
import { BatchTab } from "./components/BatchTab";
import { HistoryTab } from "./components/HistoryTab";
import { PriceTab } from "./components/PriceTab";
import { Field, Stat, WhenOrNever } from "./components/parts";

function parseProductId(raw: string | undefined): bigint {
  if (!raw) return 0n;
  try {
    return BigInt(raw);
  } catch {
    return 0n;
  }
}

// ProductDetailPage is the read-only detail route for a product (#83) — a PAGE, not a dialog,
// reached by clicking a product row.
//
// It is the SELLING team's view: the team that owns the catalogue entry, as opposed to the warehouse
// that happens to hold the goods (which reads /inventories/products/:id instead). Three vertical tabs
// down the left, the same shape the rack and warehouse-product details use, because they are the same
// kind of screen — one record, read section by section:
//
//   INFO   the catalogue record itself: identity, category, description, images, and the hold-back
//          buffer, which is a decision about the ITEM and so belongs here rather than under money.
//   PRICE  what the thing costs and what another team pays for it. A product deliberately has NO
//          selling price — that lives on the order line — so this tab is the cost story plus the
//          cross-sell markup, which is the one price a product genuinely carries.
//   BATCH  the deliveries the units came from, each with its own frozen cost.
export function ProductDetailPage() {
  const { productId } = useParams();
  const navigate = useNavigate();
  const { current } = useTeam();
  const { t } = useTranslation();

  const id = parseProductId(productId);
  const teamId = current?.teamId;

  // The WAREHOUSE LENS, shared by Price, Batch and Stock history. 0n = everywhere.
  //
  // One piece of state behind three controls, not three: stock is held per warehouse, so "which
  // building am I asking about" is one question the whole money-and-movement half of this page is
  // answering — and a lens that silently reset when you moved from the layers to the deliveries they
  // came from would make the two tabs disagree about what you had just asked. Info is deliberately
  // outside it: a SKU, a category and a picture are not facts about a building.
  const [warehouseId, setWarehouseId] = useState<bigint>(0n);
  const warehouses = useTeams({ teamType: TeamType.WAREHOUSE, page: 1, pageSize: 100, reference: true });
  const warehouseName = warehouses.data?.teams.find((w) => w.id === warehouseId)?.name;

  // The Batch and Stock history rows each NAME a warehouse, and they span several once the lens is
  // open — so both need the same id→name lookup the note above uses. Resolved from the picker's own
  // feed rather than by a second read: the list is already loaded to populate the dropdown.
  const warehouseLabel = (id: bigint) =>
    warehouses.data?.teams.find((w) => w.id === id)?.name ?? `#${id}`;

  const query = useProductDetail({ teamId, productId: id });
  // Its own entry, so an inventory or selling hiccup costs the stock figures and not the product's
  // name — see the hook.
  const activityQuery = useProductActivity({ teamId, productId: id, warehouseId });
  const archiveProduct = useArchiveProduct();
  const restoreProduct = useRestoreProduct();
  const setLocked = useSetProductLocked();

  // The one restore failure the user has to act on: archiving frees the SKU, so another product may
  // hold it by now. Null while there is no conflict to resolve.
  const [conflict, setConflict] = useState<{ product: Product; reason: string } | null>(null);
  const [archiving, setArchiving] = useState(false);

  const product = query.data?.product ?? null;
  const categories = query.data?.categories ?? [];
  const loading = query.isPending && id !== 0n;

  // A malformed id never reaches the server, so its message comes from here.
  const error = id === 0n ? "Invalid product id." : query.isError ? rpcError(query.error) : "";

  // ARCHIVE. Nothing is deleted — the row keeps its id, its stock outlives it, and its past orders
  // still name it — which is why every word the user reads says Archive.
  async function archive(target: Product) {
    if (teamId === undefined) {
      return;
    }

    try {
      await archiveProduct.mutateAsync({ teamId, productId: target.id });
      toaster.create({ type: "success", title: t("products.toast.archived", { sku: target.sku }) });
    } catch (err) {
      toaster.create({
        type: "error",
        title: t("products.toast.archiveFailed"),
        description: rpcError(err),
      });
    }
  }

  // `sku` empty = restore under the SKU it was archived with; that is the call that can come back
  // AlreadyExists, and the only sane answer to that is to let the user pick a free one.
  async function restore(target: Product, sku?: string) {
    if (teamId === undefined) {
      return;
    }

    try {
      await restoreProduct.mutateAsync({ teamId, productId: target.id, sku });
      setConflict(null);
      toaster.create({
        type: "success",
        title: t("products.toast.restored", { sku: sku || target.sku }),
      });
    } catch (err) {
      if (ConnectError.from(err).code === Code.AlreadyExists) {
        setConflict({ product: target, reason: rpcError(err) });

        return;
      }

      toaster.create({
        type: "error",
        title: t("products.toast.restoreFailed"),
        description: rpcError(err),
      });
    }
  }

  // Locking is edited in place, so it has no dialog and no save button — the switch falls back to the
  // server's answer on the refetch, and a failure is only noticeable as a toast.
  async function toggleLocked(target: Product, locked: boolean) {
    if (teamId === undefined) {
      return;
    }

    try {
      await setLocked.mutateAsync({ teamId, productId: target.id, locked });
    } catch (err) {
      toaster.create({
        type: "error",
        title: t("products.toast.lockFailed"),
        description: rpcError(err),
      });
    }
  }

  if (!current) {
    return (
      <Stack gap="section">
        <Heading size="md">{t("products.heading")}</Heading>
        <Text color="fg.muted" data-testid="product-detail-no-team">
          {t("products.detail.noTeam")}
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
        <Button
          size="xs"
          variant="ghost"
          alignSelf="flex-start"
          data-testid="product-detail-back"
          onClick={() => navigate("/products")}
        >
          <Icon as={ArrowLeft} boxSize="4" />
          {t("products.backToProducts")}
        </Button>
        <Text color="red.fg" data-testid="product-detail-error">
          {error || t("products.detail.notFound")}
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

  // An archived product is reachable by URL, so the page has to say so — and offer the way back.
  // Editing is not the way back: ProductUpdate only touches live rows, so Edit is withdrawn here and
  // Restore takes its place.
  const archived = product.deleted;

  return (
    <Stack gap="section" data-testid="product-detail-page">
      <Button
        size="xs"
        variant="ghost"
        alignSelf="flex-start"
        data-testid="product-detail-back"
        onClick={() => navigate("/products")}
      >
        <Icon as={ArrowLeft} boxSize="4" />
        {t("products.backToProducts")}
      </Button>

      <Flex align="center" gap="card" wrap="wrap">
        <Stack gap="0.5" minW="0">
          <HStack gap="2">
            <Heading size="md" data-testid="product-detail-name">
              {product.name}
            </Heading>
            {archived && (
              <Badge colorPalette="gray" data-testid="product-detail-archived">
                {t("products.tab.archived")}
              </Badge>
            )}
          </HStack>
          <Text fontSize="sm" color="fg.muted">
            {product.sku}
            {categoryLabel && ` · ${categoryLabel}`}
          </Text>
        </Stack>

        <Spacer />

        {archived ? (
          /* UNARCHIVE. No confirmation: putting a product back into the catalogue is the reversible
             direction, and the only thing that can go wrong — the SKU being taken — is caught by the
             server and answered with a dialog that resolves it. */
          <Button
            size="xs"
            variant="outline"
            loading={restoreProduct.isPending}
            data-testid="product-detail-restore"
            onClick={() => restore(product)}
          >
            <Icon as={RotateCcw} boxSize="4" />
            {t("products.restore")}
          </Button>
        ) : (
          <HStack gap="2">
            <Button
              size="xs"
              variant="outline"
              data-testid="product-detail-edit"
              onClick={() => navigate(`/products/${product.id}/edit`)}
            >
              <Icon as={Pencil} boxSize="4" />
              {t("products.edit")}
            </Button>

            {/* ARCHIVE confirms, because it takes the product out of the pickers, out of new orders
                and out of restocks — nothing is deleted, but the catalogue changes under everyone
                using it. It also frees the SKU, which is what makes coming back able to fail. */}
            <Button
              size="xs"
              variant="outline"
              colorPalette="red"
              data-testid="product-detail-archive"
              onClick={() => setArchiving(true)}
            >
              <Icon as={Archive} boxSize="4" />
              {t("products.archive")}
            </Button>
          </HStack>
        )}
      </Flex>

      <ConfirmDialog
        open={archiving}
        onOpenChange={setArchiving}
        title={t("products.archiveDialog.title")}
        message={t("products.archiveDialog.message", { sku: product.sku })}
        confirmLabel={t("products.archiveDialog.confirmLabel")}
        onConfirm={() => archive(product)}
      />

      <RestoreProductDialog
        product={conflict?.product ?? null}
        reason={conflict?.reason ?? ""}
        onClose={() => setConflict(null)}
        onRestore={(sku) => restore(product, sku)}
      />

      <Tabs.Root defaultValue="info" orientation="vertical" data-testid="pd-tabs">
        <Tabs.List minW="48">
          <Tabs.Trigger value="info" data-testid="pd-tab-info">
            {t("products.detail.tab.info")}
          </Tabs.Trigger>
          <Tabs.Trigger value="price" data-testid="pd-tab-price">
            {t("products.detail.tab.price")}
          </Tabs.Trigger>
          <Tabs.Trigger value="batch" data-testid="pd-tab-batch">
            {t("products.detail.tab.batch")}
          </Tabs.Trigger>
          <Tabs.Trigger value="history" data-testid="pd-tab-history">
            {t("products.detail.tab.stockHistory")}
          </Tabs.Trigger>
        </Tabs.List>

        {/* INFO — the catalogue record. What the thing IS, which is the half of a product that lives
            in product_service and answers without asking any other service. */}
        <Tabs.Content value="info" flex="1" data-testid="pd-info-panel">
          {/* Gallery LEFT, the record RIGHT, in two EQUAL columns. A product is a thing you look at
              before you read anything about it, and stacking the images under the fields put the one
              identifying part of the page below the fold. Below `md` it stacks — two columns in a
              phone's width is one unreadable column each.

              The split is 1:3, not even. A square image that grows with its column becomes a poster
              on a wide monitor — the picture has to identify the product, not dominate the record
              beside it — and the record is the part with several fields to lay out. A quarter of the
              row is enough to recognise a thing by. */}
          <Grid
            templateColumns={{ base: "1fr", md: "1fr 3fr" }}
            gap="card"
            alignItems="start"
          >
            <Card.Root>
              <Card.Body>
                {/* No "Images" heading — a card holding nothing but pictures does not need to be told
                    apart from one that isn't. */}
                <Stack gap="card">
                  {product.images.length === 0 ? (
                    <Text color="fg.muted" fontSize="sm" data-testid="product-detail-no-images">
                      {t("products.detail.noImages")}
                    </Text>
                  ) : product.images.length === 1 ? (
                    /* ONE image is not a carousel. Arrows and a single indicator would be chrome
                       promising a second picture that does not exist. */
                    <Box data-testid="product-detail-images">
                      <Image
                        src={product.images[0].url || product.images[0].thumbnailUrl}
                        alt={`${product.name} image 1`}
                        aspectRatio={1}
                        objectFit="cover"
                        w="full"
                        borderWidth="1px"
                        borderRadius="md"
                        data-testid="product-detail-image-0"
                      />
                    </Box>
                  ) : (
                    /* SEVERAL images — one at full width at a time, swiped or arrowed through.
                       A row of equal thumbnails would shrink every picture to make room for the
                       others, which is the wrong trade on the one tab whose job is showing what the
                       product looks like. Position 0 is the cover, so the carousel opens on it. */
                    <Carousel.Root
                      slideCount={product.images.length}
                      slidesPerPage={1}
                      loop
                      allowMouseDrag
                      data-testid="product-detail-images"
                    >
                      <Carousel.ItemGroup>
                        {product.images.map((img, i) => (
                          <Carousel.Item key={`${img.url}-${i}`} index={i}>
                            <Image
                              src={img.url || img.thumbnailUrl}
                              alt={`${product.name} image ${i + 1}`}
                              aspectRatio={1}
                              objectFit="cover"
                              w="full"
                              borderWidth="1px"
                              borderRadius="md"
                              data-testid={`product-detail-image-${i}`}
                            />
                          </Carousel.Item>
                        ))}
                      </Carousel.ItemGroup>

                      {/* THUMBNAILS as the indicators, not dots and not arrows. A dot says only "there
                          are four of these"; a thumbnail says which one you are about to get, which
                          is the whole reason to look at a second picture of a product. It doubles as
                          the navigation, so the prev/next arrows come out — with every slide one
                          click away they were chrome for a trip nobody needs to make in order. */}
                      <Carousel.IndicatorGroup
                        display="flex"
                        gap="2"
                        mt="2"
                        flexWrap="wrap"
                        justifyContent="flex-start"
                      >
                        {product.images.map((img, i) => (
                          <Carousel.Indicator
                            key={`${img.url}-thumb-${i}`}
                            index={i}
                            unstyled
                            aria-label={t("products.detail.showImage", { n: i + 1 })}
                            cursor="pointer"
                            boxSize="10"
                            p="0"
                            borderRadius="md"
                            overflow="hidden"
                            borderWidth="2px"
                            borderColor="transparent"
                            opacity="0.55"
                            transition="opacity 0.15s, border-color 0.15s"
                            _hover={{ opacity: 1 }}
                            css={{
                              "&[data-current]": {
                                opacity: 1,
                                borderColor: "colorPalette.solid",
                              },
                            }}
                            colorPalette="brand"
                          >
                            <Image
                              src={img.thumbnailUrl || img.url}
                              alt=""
                              w="full"
                              h="full"
                              objectFit="cover"
                            />
                          </Carousel.Indicator>
                        ))}
                      </Carousel.IndicatorGroup>
                    </Carousel.Root>
                  )}
                </Stack>
              </Card.Body>
            </Card.Root>

            <Card.Root minW="0">
              <Card.Body>
                <Stack gap="card">
                  <SimpleGrid columns={{ base: 1, sm: 2 }} gap="card">
                    <Field label={t("products.field.sku")} value={product.sku} />
                    <Field label={t("products.field.category")} value={categoryLabel} />

                    {/* RESERVED is a COUNT and nothing else — the units never offered for sale, so
                        that `available = on hand − reserved`. It sits under Info rather than Price
                        because it is a decision about the ITEM ("this one is fragile / always
                        miscounted"), taken once by whoever owns the catalogue, and it holds wherever
                        the thing is stocked. There is no money to put under it. */}
                    <Stat
                      label={t("products.field.reservedStock")}
                      hint={t("products.detail.reservedHint")}
                      testId="product-detail-reserved"
                    >
                      {t("products.stat.pcs", { n: product.reservedStock.toString() })}
                    </Stat>

                    {/* The markup is repeated from the Price tab on purpose. It is the one commercial
                        term a person checks WITHOUT wanting the money screen — "am I letting other
                        teams have this, and at what?" — and making them change tabs to read one badge
                        is how a summary stops summarising. Locked rides along, because the markup is
                        meaningless if nobody may order it. */}
                    <Stat
                      label={t("products.field.crossMarkup")}
                      hint={t("products.detail.crossMarkupHint")}
                      testId="product-detail-info-markup"
                    >
                      <HStack gap="2">
                        <Badge colorPalette={product.crossMarkupBps > 0 ? "brand" : "gray"}>
                          {formatMarkup(product.crossMarkupBps)}
                        </Badge>
                        {product.crossLocked && (
                          <Badge colorPalette="gray" variant="outline">
                            {t("products.table.locked")}
                          </Badge>
                        )}
                      </HStack>
                    </Stat>

                    {/* WHEN, not what. Both are recency, and recency is the question a catalogue owner
                        asks of a product they have opened: is this thing still moving, and has stock
                        come in behind the sales. The order and the delivery themselves are other
                        screens' subjects. */}
                    <Stat
                      label={t("products.stat.lastOrder")}
                      hint={t("products.stat.lastOrderHint")}
                      testId="product-detail-last-order"
                    >
                      <WhenOrNever unix={activityQuery.data?.activity?.lastOrderUnix} />
                    </Stat>

                    <Stat
                      label={t("products.stat.lastRestock")}
                      hint={t("products.stat.lastRestockHint")}
                      testId="product-detail-last-restock"
                    >
                      <WhenOrNever unix={activityQuery.data?.stock?.lastRestockUnix} />
                    </Stat>
                  </SimpleGrid>

                  <Field label={t("products.field.description")} value={product.description} />
                </Stack>
              </Card.Body>
            </Card.Root>
          </Grid>
        </Tabs.Content>

        {/* PRICE, BATCH and STOCK HISTORY each live in their own file under components/ (#232).
            They were inline while they were three empty tables with a note explaining why; now that
            each one loads, pages and refreshes its own rows, each is a screen-sized thing of its own
            and the page reads as what it is — a header, four tabs, and the record itself. */}
        <Tabs.Content value="price" flex="1" data-testid="pd-price-panel">
          <PriceTab
            teamId={teamId}
            product={product}
            stock={activityQuery.data?.stock}
            archived={archived}
            warehouseId={warehouseId}
            warehouseName={warehouseName}
            onWarehouseChange={setWarehouseId}
            onToggleLocked={(locked) => toggleLocked(product, locked)}
            lockPending={setLocked.isPending}
          />
        </Tabs.Content>

        <Tabs.Content value="batch" flex="1" data-testid="pd-batch-panel">
          <BatchTab
            teamId={teamId}
            productId={product.id}
            warehouseId={warehouseId}
            warehouseName={warehouseName}
            onWarehouseChange={setWarehouseId}
            warehouseLabel={warehouseLabel}
          />
        </Tabs.Content>

        <Tabs.Content value="history" flex="1" data-testid="pd-history-panel">
          <HistoryTab
            teamId={teamId}
            productId={product.id}
            warehouseId={warehouseId}
            warehouseName={warehouseName}
            onWarehouseChange={setWarehouseId}
            warehouseLabel={warehouseLabel}
          />
        </Tabs.Content>
      </Tabs.Root>
    </Stack>
  );
}

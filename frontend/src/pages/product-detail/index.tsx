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
  Switch,
  Table,
  Tabs,
  Text,
} from "@chakra-ui/react";
import { Archive, ArrowLeft, Pencil, RotateCcw } from "lucide-react";
import { Code, ConnectError } from "@connectrpc/connect";
import { rpcError } from "../../api/clients";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { TeamSelect } from "../../components/TeamSelect";
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
import type { OwnerStockRow } from "../../features/products/adapt";
import { RestoreProductDialog } from "../../features/products/RestoreProductDialog";
import { pathToRoot } from "../../features/categories/categoryTree";
import type { Product } from "../../gen/warehouse/product/v1/product_pb";
import { formatUnixDate } from "../../lib/datetime";
import { formatMarkup } from "../../lib/markup";
import { formatRupiah } from "../../lib/money";

function parseProductId(raw: string | undefined): bigint {
  if (!raw) return 0n;
  try {
    return BigInt(raw);
  } catch {
    return 0n;
  }
}

// A labelled read-only field; a dash keeps the layout from collapsing on an empty value.
function Field({ label, value }: { label: string; value: string }) {
  return (
    <Stack gap="0.5" minW="0">
      <Text fontSize="xs" fontWeight="medium" color="fg.muted" textTransform="uppercase">
        {label}
      </Text>
      <Text fontSize="sm" lineClamp={3}>
        {value || "—"}
      </Text>
    </Stack>
  );
}

// The same shape as Field, for a value that is a component rather than a string.
function Stat({
  label,
  hint,
  testId,
  children,
}: {
  label: string;
  hint?: string;
  testId?: string;
  children: React.ReactNode;
}) {
  return (
    <Stack gap="0.5" minW="0" data-testid={testId}>
      <Text fontSize="xs" fontWeight="medium" color="fg.muted" textTransform="uppercase">
        {label}
      </Text>
      <Text fontSize="sm" asChild>
        <div>{children}</div>
      </Text>
      {hint && (
        <Text fontSize="xs" color="fg.subtle">
          {hint}
        </Text>
      )}
    </Stack>
  );
}

// ⚠ A figure another service owns and a selling team cannot ask for yet — see the Batch panel's
// note. It renders as a dash with the reason beside it rather than as a 0: an unknown figure is not a
// zero one (#74), and a screen that prints Rp 0 where it means "I could not find out" is worse than
// one that says so.
function Pending() {
  const { t } = useTranslation();

  return (
    <HStack gap="1.5">
      <Text color="fg.subtle" data-testid="stock-unknown">
        —
      </Text>
      <Text fontSize="xs" color="fg.subtle">
        {t("products.stat.pending")}
      </Text>
    </HStack>
  );
}

// A date, or "Never" — and, while the read is still in flight, neither. An undefined unix means the
// answer has not arrived; a 0 means it arrived and the answer is that this has never happened. They
// are different sentences and a screen that renders both as "Never" tells the second one as fact.
function WhenOrNever({ unix }: { unix?: bigint }) {
  const { t } = useTranslation();

  if (unix === undefined) {
    return (
      <Text color="fg.subtle" data-testid="stock-unknown">
        —
      </Text>
    );
  }

  if (unix === 0n) {
    return <Text color="fg.muted">{t("products.stat.never")}</Text>;
  }

  return <Text>{formatUnixDate(unix)}</Text>;
}

// The WAREHOUSE LENS control, on each of the three tabs whose figures are per-warehouse.
//
// The shared TeamSelect restricted to WAREHOUSE teams — the same picker the product list uses, not a
// second dropdown of this page's own. It carries its own ✕, so there is no separate clear button.
function WarehouseFilter({
  value,
  onChange,
  testId,
}: {
  value: bigint;
  onChange: (id: bigint) => void;
  testId: string;
}) {
  const { t } = useTranslation();

  return (
    <Box minW="16rem" data-testid={testId}>
      <TeamSelect
        value={value}
        onChange={onChange}
        teamType={TeamType.WAREHOUSE}
        placeholder={t("products.allWarehouses")}
      />
    </Box>
  );
}

// Choosing a warehouse RESTATES every figure below as that warehouse's — it does not merely hide
// rows. Saying so is the point: a stock number that quietly became one building's, while still
// looking like the total, is the way this screen could lie without a single wrong value on it.
function WarehouseNote({
  warehouseId,
  warehouseName,
}: {
  warehouseId: bigint;
  warehouseName?: string;
}) {
  const { t } = useTranslation();

  if (warehouseId === 0n) {
    return null;
  }

  return (
    <Text fontSize="sm" color="fg.muted" data-testid="pd-warehouse-note">
      {t("products.detail.warehouseNote", {
        warehouse: warehouseName || `#${warehouseId}`,
      })}
    </Text>
  );
}

// The HPP SPREAD of the units on hand — cheapest to dearest. A RANGE, not an average, because the
// same product genuinely arrives at different prices and an average is exactly what hides that.
function CostRange({ stock }: { stock?: OwnerStockRow }) {
  if (stock === undefined || !stock.costKnown) {
    return <Pending />;
  }

  // One price when every layer agrees — "Rp 5.000 – Rp 5.000" would be noise.
  if (stock.costMin === stock.costMax) {
    return <Text>{formatRupiah(stock.costMin)}</Text>;
  }

  return (
    <Text>
      {formatRupiah(stock.costMin)} – {formatRupiah(stock.costMax)}
    </Text>
  );
}

// What a cross-selling team pays per unit: our cost plus the markup.
//
// Derived here rather than served, because it is arithmetic over two numbers the caller already has,
// and a figure computed in two places is a figure that will one day disagree with itself. The
// rounding is deliberate and the same both ends of the range — basis points over rupiah lands on
// fractions of a cent that no invoice can carry.
function CrossPrice({ stock, markupBps }: { stock?: OwnerStockRow; markupBps: number }) {
  if (stock === undefined || !stock.costKnown) {
    return <Pending />;
  }

  const withMarkup = (cost: bigint) => cost + (cost * BigInt(markupBps)) / 10_000n;

  const min = withMarkup(stock.costMin);
  const max = withMarkup(stock.costMax);

  if (min === max) {
    return <Text>{formatRupiah(min)}</Text>;
  }

  return (
    <Text>
      {formatRupiah(min)} – {formatRupiah(max)}
    </Text>
  );
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
  const warehouses = useTeams({ teamType: TeamType.WAREHOUSE, page: 1, pageSize: 100 });
  const warehouseName = warehouses.data?.teams.find((w) => w.id === warehouseId)?.name;

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

        {/* PRICE — the batches GROUPED BY WHAT THEY COST. A product has no selling price (what a
            buyer pays is set per order, on the shop that sells it), so the money it does have is what
            its units cost us — and that is not one number. The same product arrives at different
            prices, each delivery freezes its own, and every batch that froze the same cost is one
            COST LAYER. Grouping by price rather than listing deliveries is what makes "what is my
            stock worth, and at which prices" a question you can answer by looking.

            FIFO still draws the oldest batch; this view is about value, not about order. The Batch
            tab is the per-delivery list. */}
        <Tabs.Content value="price" flex="1" data-testid="pd-price-panel">
          <Stack gap="section">
            <Card.Root>
              <Card.Body>
                <Stack gap="card">
                  <Flex gap="card" align="flex-end" justify="space-between" wrap="wrap">
                    <Stack gap="0.5">
                      <Text fontWeight="medium">{t("products.detail.costHeading")}</Text>
                      <Text fontSize="sm" color="fg.muted">
                        {t("products.detail.costHelp")}
                      </Text>
                    </Stack>

                    <WarehouseFilter
                      value={warehouseId}
                      onChange={setWarehouseId}
                      testId="pd-price-warehouse-filter"
                    />
                  </Flex>

                  <WarehouseNote warehouseId={warehouseId} warehouseName={warehouseName} />

                  <SimpleGrid columns={{ base: 1, sm: 2 }} gap="card">
                    {/* The cheapest and dearest units currently held — the two ends of the table
                        below, said once at the top. A RANGE rather than one number because it
                        genuinely is one, and an average is exactly what hides the spread somebody
                        opens this tab to see. */}
                    <Stat label={t("products.table.priceRange")} testId="product-detail-cost">
                      <CostRange stock={activityQuery.data?.stock} />
                    </Stat>

                    {/* The markup applies to whatever a unit cost us, and units cost different
                        amounts — so what another team pays is a range too, derived from the same
                        spread rather than from an average nobody is charged. */}
                    <Stat
                      label={t("products.detail.crossPrice")}
                      hint={t("products.detail.crossPriceHint")}
                      testId="product-detail-cross-price"
                    >
                      <CrossPrice
                        stock={activityQuery.data?.stock}
                        markupBps={product.crossMarkupBps}
                      />
                    </Stat>
                  </SimpleGrid>

                  {/* ⚠ PENDING for the same reason the Batch tab is: the layers themselves come from
                      CostLayerList, which is warehouse-scoped and warehouse-roles-only.
                      OwnerStockByIds answers the SPREAD above but not what sits between its ends. */}
                  <Table.Root size="sm" data-testid="pd-price-table">
                    <Table.Header>
                      <Table.Row>
                        <Table.ColumnHeader>
                          {t("products.detail.layer.unitCost")}
                        </Table.ColumnHeader>
                        <Table.ColumnHeader textAlign="end">
                          {t("products.detail.layer.batches")}
                        </Table.ColumnHeader>
                        <Table.ColumnHeader textAlign="end">
                          {t("products.detail.layer.ready")}
                        </Table.ColumnHeader>
                        <Table.ColumnHeader textAlign="end">
                          {t("products.detail.layer.value")}
                        </Table.ColumnHeader>
                        <Table.ColumnHeader textAlign="end">
                          {t("products.detail.layer.crossPrice")}
                        </Table.ColumnHeader>
                      </Table.Row>
                    </Table.Header>
                    <Table.Body>
                      <Table.Row>
                        <Table.Cell colSpan={5} color="fg.muted" data-testid="pd-price-empty">
                          {t("products.detail.layerPending")}
                        </Table.Cell>
                      </Table.Row>
                    </Table.Body>
                  </Table.Root>
                </Stack>
              </Card.Body>
            </Card.Root>

            <Card.Root>
              <Card.Body>
                <Stack gap="card">
                  <Stack gap="0.5">
                    <Text fontWeight="medium">{t("products.detail.crossHeading")}</Text>
                    <Text fontSize="sm" color="fg.muted">
                      {t("products.detail.crossHelp")}
                    </Text>
                  </Stack>

                  <SimpleGrid columns={{ base: 1, sm: 2 }} gap="card">
                    <Stat
                      label={t("products.field.crossMarkup")}
                      hint={t("products.detail.crossMarkupHint")}
                      testId="product-detail-markup"
                    >
                      <Badge colorPalette={product.crossMarkupBps > 0 ? "brand" : "gray"}>
                        {formatMarkup(product.crossMarkupBps)}
                      </Badge>
                    </Stat>

                    {/* Editable in place, exactly as it is on the list — locking is a one-bit
                        decision and a dialog for it would be ceremony. An archived product is out of
                        circulation anyway, so the switch is dead there. */}
                    <Stat
                      label={t("products.table.locked")}
                      hint={t("products.detail.lockedHint")}
                      testId="product-detail-locked"
                    >
                      <Switch.Root
                        size="sm"
                        checked={product.crossLocked}
                        disabled={archived || setLocked.isPending}
                        colorPalette="brand"
                        data-testid={`pd-locked-${product.sku}`}
                        onCheckedChange={(e) => toggleLocked(product, e.checked)}
                      >
                        <Switch.HiddenInput aria-label={t("products.table.locked")} />
                        <Switch.Control />
                      </Switch.Root>
                    </Stat>
                  </SimpleGrid>
                </Stack>
              </Card.Body>
            </Card.Root>
          </Stack>
        </Tabs.Content>

        {/* BATCH — one product's units from one delivery, each with its own frozen cost. This is where
            "how much do I have, and where" is actually answered for a catalogue owner, because stock
            is held per warehouse and a batch names which one.

            ⚠ EMPTY, and deliberately so. Every batch read lives in inventory_service, is scoped to the
            WAREHOUSE team holding the goods, and admits warehouse roles only — so a selling team
            cannot ask "which deliveries are my product's units from" through any RPC that exists
            today. The same gap already blanks the ready/ongoing figures on the product LIST (see
            features/products/queries.ts). Naming it beats an empty table that reads as "no stock". */}
        <Tabs.Content value="batch" flex="1" data-testid="pd-batch-panel">
          <Card.Root>
            <Card.Body>
              <Stack gap="card">
                <Flex gap="card" align="flex-end" justify="space-between" wrap="wrap">
                  <Stack gap="0.5">
                    <Text fontWeight="medium">{t("products.detail.batchHeading")}</Text>
                    <Text fontSize="sm" color="fg.muted">
                      {t("products.detail.batchHelp")}
                    </Text>
                  </Stack>

                  <WarehouseFilter
                    value={warehouseId}
                    onChange={setWarehouseId}
                    testId="pd-batch-warehouse-filter"
                  />
                </Flex>

                <WarehouseNote warehouseId={warehouseId} warehouseName={warehouseName} />

                <Table.Root size="sm" data-testid="pd-batch-table">
                  <Table.Header>
                    <Table.Row>
                      <Table.ColumnHeader>{t("products.detail.batch.delivery")}</Table.ColumnHeader>
                      <Table.ColumnHeader>{t("products.detail.batch.warehouse")}</Table.ColumnHeader>
                      <Table.ColumnHeader>{t("products.detail.batch.arrivedOn")}</Table.ColumnHeader>
                      <Table.ColumnHeader textAlign="end">
                        {t("products.detail.batch.unitCost")}
                      </Table.ColumnHeader>
                      <Table.ColumnHeader textAlign="end">
                        {t("products.detail.batch.ready")}
                      </Table.ColumnHeader>
                      <Table.ColumnHeader textAlign="end">
                        {t("products.detail.batch.value")}
                      </Table.ColumnHeader>
                    </Table.Row>
                  </Table.Header>
                  <Table.Body>
                    <Table.Row>
                      <Table.Cell colSpan={6} color="fg.muted" data-testid="pd-batch-empty">
                        {t("products.detail.batchPending")}
                      </Table.Cell>
                    </Table.Row>
                  </Table.Body>
                </Table.Root>
              </Stack>
            </Card.Body>
          </Card.Root>
        </Tabs.Content>

        {/* STOCK HISTORY — every movement of this product: what arrived, what shipped, what was
            counted, adjusted, damaged or found, newest first. The Batch tab says what the owner HAS;
            this says how it got that way, which is the tab somebody opens when a number looks wrong.

            The columns are deliberately NOT the warehouse's (#209). That table carries a Place — the
            shelf a movement touched — because moving between two shelves is the warehouse's whole
            job. A catalogue owner does not care which rack; they care which BUILDING, because stock
            is held per warehouse and that is the unit their decisions are made in. So Place becomes
            Warehouse, and a shelf-to-shelf move inside one building is a movement the owner has no
            reason to see at all.

            ⚠ EMPTY for the same reason the Batch tab is: StockHistory is scoped by warehouse_id and
            admits warehouse roles only, so a selling team has no warehouse to name and no role to ask
            with. */}
        <Tabs.Content value="history" flex="1" data-testid="pd-history-panel">
          <Card.Root>
            <Card.Body>
              <Stack gap="card">
                <Flex gap="card" align="flex-end" justify="space-between" wrap="wrap">
                  <Stack gap="0.5">
                    <Text fontWeight="medium">{t("products.detail.historyHeading")}</Text>
                    <Text fontSize="sm" color="fg.muted">
                      {t("products.detail.historyHelp")}
                    </Text>
                  </Stack>

                  <WarehouseFilter
                    value={warehouseId}
                    onChange={setWarehouseId}
                    testId="pd-history-warehouse-filter"
                  />
                </Flex>

                <WarehouseNote warehouseId={warehouseId} warehouseName={warehouseName} />

                <Table.Root size="sm" data-testid="pd-history-table">
                  <Table.Header>
                    <Table.Row>
                      <Table.ColumnHeader>{t("products.detail.history.when")}</Table.ColumnHeader>
                      <Table.ColumnHeader>{t("products.detail.history.what")}</Table.ColumnHeader>
                      <Table.ColumnHeader>
                        {t("products.detail.batch.warehouse")}
                      </Table.ColumnHeader>
                      <Table.ColumnHeader>{t("products.detail.history.batch")}</Table.ColumnHeader>
                      <Table.ColumnHeader textAlign="end">
                        {t("products.detail.history.change")}
                      </Table.ColumnHeader>
                      <Table.ColumnHeader textAlign="end">
                        {t("products.detail.history.after")}
                      </Table.ColumnHeader>
                    </Table.Row>
                  </Table.Header>
                  <Table.Body>
                    <Table.Row>
                      <Table.Cell colSpan={6} color="fg.muted" data-testid="pd-history-empty">
                        {t("products.detail.historyPending")}
                      </Table.Cell>
                    </Table.Row>
                  </Table.Body>
                </Table.Root>
              </Stack>
            </Card.Body>
          </Card.Root>
        </Tabs.Content>
      </Tabs.Root>
    </Stack>
  );
}

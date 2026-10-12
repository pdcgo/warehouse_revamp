import { useState } from "react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  Badge,
  Box,
  Button,
  Card,
  Flex,
  HStack,
  Icon,
  IconButton,
  SegmentGroup,
  Stack,
  Text,
} from "@chakra-ui/react";
import { Layers, PackagePlus, Plus, Trash2, TriangleAlert } from "lucide-react";

import { ProductSelect } from "../../../components/products/ProductSelect";
import { QuantityInput } from "../../../components/inputs/QuantityInput";
import { toaster } from "../../../components/feedback/Toaster";
import type { Availability, Costs, LineDraft } from "../../../features/orders/lines";
import { lineStock, unitCost } from "../../../features/orders/lines";
import { BundleSearch, SlotBox } from "../../../features/orders/form/BundleCard";
import { fillFor } from "../../../features/orders/form/bundles";
import { BUNDLES } from "../../../features/orders/form/mockData";
import { ImagePreview } from "../../../features/orders/form/ImagePreview";
import type { PreviewTarget } from "../../../features/orders/form/ImagePreview";
import { NotImplemented } from "../../../features/pending/NotImplemented";
import { formatRupiah } from "../../../lib/money";
import { ORDER_DRAFT_PENDING } from "../pending";
import type { DraftRow, RowMode } from "../rows";
import { bundleForRow, productFor, rowCountDiffers, rowHpp, rowMapped } from "../rows";

// THE DRAFT'S ITEMS — the order form's items card, where each row is something the app READ
// (`a-draft-row-maps-to-a-product-a-bundle-or-a-split`).
//
// One BLOCK per row rather than a table row: a row may open into a bundle's slots or a split's parts,
// and those are boxes, not cells. It is also what a phone needs (CLAUDE.md, a phone gets its own
// arrangement) — the scraped text reads at full width either way.
//
// Each block, top to bottom: the scraped text — and the listing's quantity and price, which are
// INFORMATION like the text (owner: *"harga cuma info, jumlah pun cuma info"*) — then HOW it is mapped
// (Produk | Bundle | Pecah), then the mapping itself, where the count that leaves the warehouse is set.

export function DraftRowsCard({
  teamId,
  warehouseId,
  rows,
  stock,
  costs,
  onPatch,
  onRemove,
  onAdd,
}: {
  teamId: bigint;
  warehouseId: bigint;
  rows: DraftRow[];
  stock?: Availability;
  costs?: Costs;
  onPatch: (key: string, patch: Partial<DraftRow>) => void;
  onRemove: (key: string) => void;
  onAdd: () => void;
}) {
  const { t } = useTranslation();
  const [preview, setPreview] = useState<PreviewTarget | null>(null);

  return (
    <Card.Root>
      <Card.Body>
        <Stack gap="card">
          <Flex align="start" gap="card" wrap="wrap" justify="space-between">
            <Stack gap="0.5" minW="0">
              <Card.Title textStyle="xl">{t("orders.items")}</Card.Title>
              <Card.Description>{t("orderDraftForm.items.help")}</Card.Description>
            </Stack>
            {/* Something the buyer ordered that the scrape never read — a new row with no scraped text,
                which truthfully says so. */}
            <Button type="button" size="xs" variant="outline" data-testid="draft-add-row" onClick={onAdd}>
              <Icon as={PackagePlus} boxSize="4" />
              {t("orders.addLine")}
            </Button>
          </Flex>

          {rows.length === 0 && (
            <Text fontSize="sm" color="fg.muted" data-testid="draft-no-lines">
              {t("orderDrafts.missingLines")}
            </Text>
          )}

          {rows.map((row, i) => (
            <RowBlock
              key={row.key}
              index={i}
              row={row}
              teamId={teamId}
              warehouseId={warehouseId}
              stock={stock}
              costs={costs}
              onPatch={(patch) => onPatch(row.key, patch)}
              onRemove={() => onRemove(row.key)}
              onPreview={setPreview}
            />
          ))}
        </Stack>
      </Card.Body>

      <ImagePreview target={preview} onClose={() => setPreview(null)} />
    </Card.Root>
  );
}

function RowBlock({
  index,
  row,
  teamId,
  warehouseId,
  stock,
  costs,
  onPatch,
  onRemove,
  onPreview,
}: {
  index: number;
  row: DraftRow;
  teamId: bigint;
  warehouseId: bigint;
  stock?: Availability;
  costs?: Costs;
  onPatch: (patch: Partial<DraftRow>) => void;
  onRemove: () => void;
  onPreview: (target: PreviewTarget) => void;
}) {
  const { t } = useTranslation();
  const mapped = rowMapped(row);

  function setMode(mode: RowMode) {
    // A split starts from the product already chosen, so switching does not throw that work away.
    if (mode === "split" && row.parts.length === 0) {
      onPatch({ mode, parts: row.product ? [{ ...row.product, quantity: "1" }] : [emptyPart()] });
      return;
    }

    onPatch({ mode });
  }

  function setCount(count: string) {
    // A bundle's quantity IS the row's count — its slot caps follow.
    onPatch(row.bundle ? { count, bundle: { ...row.bundle, quantity: count } } : { count });
  }

  return (
    <Box
      borderWidth="1px"
      borderColor={mapped ? "border" : "warning.border"}
      borderRadius="l2"
      p="card"
      data-testid={`draft-row-${index}`}
      data-mode={row.mode}
      data-mapped={mapped ? "true" : undefined}
    >
      <Stack gap="card">
        {/* THE EVIDENCE — what the app read, above everything and never replaced. */}
        <Flex align="start" gap="3">
          <Stack gap="0.5" flex="1" minW="0">
            <HStack gap="2">
              <Badge size="xs" colorPalette="gray">
                {row.itemId > 0n ? t("orderDrafts.scraped") : t("orderDraftForm.items.added")}
              </Badge>
              {row.externalSku && (
                <Text fontSize="xs" color="fg.muted">
                  {row.externalSku}
                </Text>
              )}
            </HStack>
            <Text fontSize="sm" fontWeight="medium" data-testid={`draft-line-scraped-${index}`}>
              {row.itemId > 0n ? row.externalName || t("orderDrafts.noScrapedName") : t("orderDraftForm.items.addedHelp")}
            </Text>
            {row.itemId > 0n && (
              <Text fontSize="xs" color="fg.muted" data-testid={`draft-row-listing-${index}`}>
                {t("orderDraftForm.items.listing", {
                  qty: row.quantity,
                  price: row.mpPrice ? formatRupiah(BigInt(row.mpPrice)) : "—",
                })}
              </Text>
            )}
          </Stack>
          <IconButton
            size="xs"
            variant="ghost"
            colorPalette="error"
            aria-label={t("orders.removeLine")}
            data-testid={`draft-row-remove-${index}`}
            onClick={onRemove}
          >
            <Icon as={Trash2} boxSize="4" />
          </IconButton>
        </Flex>

        {/* HOW, HOW MANY, AND FOR WHAT. */}
        <Flex gap="card" wrap="wrap" align="end">
          <Stack gap="1">
            <Text fontSize="xs" fontWeight="bold" color="fg.label">
              {t("orderDraftForm.items.mapAs")}
            </Text>
            <SegmentGroup.Root
              size="xs"
              value={row.mode}
              onValueChange={(e) => e.value && setMode(e.value as RowMode)}
              aria-label={t("orderDraftForm.items.mapAs")}
              data-testid={`draft-row-mode-${index}`}
            >
              <SegmentGroup.Indicator />
              <ModeItem value="product" label={t("orderDraftForm.items.mode.product")} testId={`draft-row-mode-${index}-product`} />
              <ModeItem
                value="bundle"
                label={t("orderDraftForm.items.mode.bundle")}
                mark={<NotImplemented list={ORDER_DRAFT_PENDING} id="rowBundle" />}
                testId={`draft-row-mode-${index}-bundle`}
              />
              <ModeItem
                value="split"
                label={t("orderDraftForm.items.mode.split")}
                mark={<NotImplemented list={ORDER_DRAFT_PENDING} id="rowSplit" />}
                testId={`draft-row-mode-${index}-split`}
              />
            </SegmentGroup.Root>
          </Stack>

          <Stack gap="0.5" ms="auto" align="end">
            <Text fontSize="xs" color="fg.muted">
              {t("orderDraftForm.items.rowHpp", { hpp: formatRupiah(rowHpp(row, costs)) })}
            </Text>
          </Stack>
        </Flex>

        {/* THE MAPPING ITSELF. */}
        {row.mode === "product" && (
          <ProductMapping
            index={index}
            row={row}
            teamId={teamId}
            stock={stock}
            costs={costs}
            onPatch={onPatch}
            count={<CountInput index={index} row={row} onChange={setCount} />}
          />
        )}

        {row.mode === "bundle" && (
          <Stack gap="card">
            {row.bundle ? (
              <Flex align="center" gap="2" wrap="wrap">
                <Icon as={Layers} boxSize="4" color="fg.muted" />
                <Text fontWeight="medium" data-testid={`draft-row-bundle-${index}`}>
                  {row.bundle.name}
                </Text>
                <Button type="button" size="xs" variant="ghost" onClick={() => onPatch({ bundle: null })}>
                  {t("orderDraftForm.items.changeBundle")}
                </Button>
                <Flex align="center" gap="2" ms="auto">
                  <Text fontSize="xs" color="fg.muted">
                    {t("orderDraftForm.items.bundleCount")}
                  </Text>
                  <CountInput index={index} row={row} onChange={setCount} />
                </Flex>
              </Flex>
            ) : (
              <Box maxW="sm">
                <BundleSearch
                  disabled={warehouseId <= 0n}
                  onAdd={(templateId) => {
                    const template = BUNDLES.find((b) => b.id === templateId);
                    if (template) onPatch({ bundle: bundleForRow(template, row) });
                  }}
                />
              </Box>
            )}

            {row.bundle?.slots.map((slot) => (
              <SlotBox
                key={slot.id}
                teamId={teamId}
                warehouseId={warehouseId}
                bundle={row.bundle!}
                slot={slot}
                stock={stock}
                costs={costs}
                onPreview={onPreview}
                onFill={(products) => {
                  const bundle = row.bundle!;
                  const ticked = new Set(products.map((p) => p.id.toString()));
                  const kept = slot.fills.filter((f) => ticked.has(f.productId.toString()));
                  const known = new Set(kept.map((f) => f.productId.toString()));
                  const added = products
                    .filter((p) => !known.has(p.id.toString()))
                    .map((p) => fillFor(p, slot.ruleQty));

                  onPatch({
                    bundle: {
                      ...bundle,
                      slots: bundle.slots.map((s) => (s.id === slot.id ? { ...s, fills: [...kept, ...added] } : s)),
                    },
                  });
                }}
                onFillQuantity={(productId, quantity) => {
                  const bundle = row.bundle!;

                  onPatch({
                    bundle: {
                      ...bundle,
                      slots: bundle.slots.map((s) =>
                        s.id === slot.id
                          ? { ...s, fills: s.fills.map((f) => (f.productId === productId ? { ...f, quantity } : f)) }
                          : s,
                      ),
                    },
                  });
                }}
              />
            ))}
          </Stack>
        )}

        {row.mode === "split" && (
          <SplitMapping index={index} row={row} teamId={teamId} stock={stock} costs={costs} onPatch={onPatch} />
        )}

        {!mapped && (
          <Text fontSize="xs" color="warning.fg" data-testid={`draft-line-unmapped-${index}`}>
            {t("orderDrafts.notMappedYet")}
          </Text>
        )}

        {/* A DIFFERENT COUNT IS FLAGGED, NOT REFUSED — the buyer may have changed it by message. */}
        {rowCountDiffers(row) && (
          <Flex align="center" gap="1.5" data-testid={`draft-row-count-differs-${index}`}>
            <Icon as={TriangleAlert} boxSize="3.5" color="warning.fg" />
            <Text fontSize="xs" color="warning.fg">
              {t("orderDraftForm.items.countDiffers", { count: row.count, listing: row.quantity })}
            </Text>
            <NotImplemented list={ORDER_DRAFT_PENDING} id="listingQty" />
          </Flex>
        )}
      </Stack>
    </Box>
  );
}

function ModeItem({ value, label, mark, testId }: { value: RowMode; label: string; mark?: ReactNode; testId: string }) {
  return (
    <SegmentGroup.Item value={value} data-testid={testId}>
      <SegmentGroup.ItemText>
        <Flex align="center" gap="1">
          {label}
          {mark}
        </Flex>
      </SegmentGroup.ItemText>
      <SegmentGroup.ItemHiddenInput />
    </SegmentGroup.Item>
  );
}

function CountInput({ index, row, onChange }: { index: number; row: DraftRow; onChange: (count: string) => void }) {
  return <QuantityInput value={row.count} onChange={onChange} min={1} testId={`draft-row-count-${index}`} />;
}

function emptyPart(): LineDraft {
  return { productId: 0n, sku: "", name: "", imageUrl: "", thumbnailUrl: "", quantity: "1" };
}

/** What the warehouse holds against a line and what it costs — one quiet line under a picker. */
function StockLine({ line, stock, costs, testId }: { line: LineDraft; stock?: Availability; costs?: Costs; testId?: string }) {
  const { t } = useTranslation();

  if (line.productId <= 0n) return null;

  const s = lineStock(line, stock);
  const cost = unitCost(line, costs);

  return (
    <Text fontSize="xs" color={s.kind === "known" && s.short ? "error.fg" : "fg.muted"} data-testid={testId}>
      {t("orderDraftForm.items.stockLine", {
        stock: s.kind === "known" ? s.ready.toString() : "—",
        hpp: cost > 0n ? formatRupiah(cost) : "—",
      })}
    </Text>
  );
}

function ProductMapping({
  index,
  row,
  teamId,
  stock,
  costs,
  onPatch,
  count,
}: {
  index: number;
  row: DraftRow;
  teamId: bigint;
  stock?: Availability;
  costs?: Costs;
  onPatch: (patch: Partial<DraftRow>) => void;
  /** How many of it — beside the picker, on the same line. */
  count: ReactNode;
}) {
  const { t } = useTranslation();
  const product = row.product;

  return (
    <Stack gap="1">
      {/* The catalogue is NOT narrowed to this warehouse's stock (owner): a scrape may name a product
          that is out of stock, and that refuses the PROMOTE, not the mapping. */}
      <Flex gap="card" align="center" wrap="wrap">
        <Box w={{ base: "full", md: "sm" }} minW="0">
          <ProductSelect
            teamId={teamId}
            value={product?.productId}
            onChange={(picked) => onPatch({ product: productFor(picked) })}
          />
        </Box>
        {count}
      </Flex>
      {product && product.productId > 0n && (
        <>
          <Text fontSize="xs" color="fg.muted" data-testid={`draft-line-mapped-${index}`}>
            {product.name ? `${product.sku} — ${product.name}` : t("orderDrafts.mapped")}
          </Text>
          <StockLine
            line={{ ...product, quantity: row.count }}
            stock={stock}
            costs={costs}
            testId={`draft-row-stock-${index}`}
          />
        </>
      )}
    </Stack>
  );
}

function SplitMapping({
  index,
  row,
  teamId,
  stock,
  costs,
  onPatch,
}: {
  index: number;
  row: DraftRow;
  teamId: bigint;
  stock?: Availability;
  costs?: Costs;
  onPatch: (patch: Partial<DraftRow>) => void;
}) {
  const { t } = useTranslation();

  function patchPart(at: number, patch: Partial<LineDraft>) {
    onPatch({ parts: row.parts.map((part, i) => (i === at ? { ...part, ...patch } : part)) });
  }

  return (
    <Stack gap="card">
      <Text fontSize="xs" color="fg.muted">
        {t("orderDraftForm.items.splitHelp")}
      </Text>

      {/* THE COLUMN NAMES ONCE, so each part's picker and quantity sit on ONE line (owner: *"qty per
          satuannya luruskan dengan pilih produk"*). A label above every quantity pushed it below the
          picker it belongs to. */}
      {row.parts.length > 0 && (
        <Flex gap="card" display={{ base: "none", md: "flex" }}>
          <Text fontSize="xs" fontWeight="bold" color="fg.label" w="sm">
            {t("orders.product")}
          </Text>
          <Text fontSize="xs" fontWeight="bold" color="fg.label">
            {t("orderDraftForm.items.perUnit")}
          </Text>
        </Flex>
      )}

      {row.parts.map((part, at) => (
        <Stack key={at} gap="1" data-testid={`draft-row-${index}-part-${at}`}>
          <Flex gap="card" align="center" wrap="wrap">
            <Box w={{ base: "full", md: "sm" }} minW="0">
              <ProductSelect
                teamId={teamId}
                value={part.productId}
                onChange={(picked) => patchPart(at, { ...productFor(picked), quantity: part.quantity })}
              />
            </Box>
            <QuantityInput value={part.quantity} min={1} onChange={(quantity) => patchPart(at, { quantity })} />
            <IconButton
              size="xs"
              variant="ghost"
              aria-label={t("orders.removeLine")}
              onClick={() => onPatch({ parts: row.parts.filter((_, i) => i !== at) })}
            >
              <Icon as={Trash2} boxSize="4" />
            </IconButton>
          </Flex>
          <StockLine
            line={{ ...part, quantity: String(Number(part.quantity || 0) * Number(row.quantity || 0)) }}
            stock={stock}
            costs={costs}
          />
        </Stack>
      ))}

      <Flex gap="2" wrap="wrap" align="center">
        <Button
          type="button"
          size="xs"
          variant="outline"
          data-testid={`draft-row-${index}-add-part`}
          onClick={() => onPatch({ parts: [...row.parts, emptyPart()] })}
        >
          <Icon as={Plus} boxSize="4" />
          {t("orderDraftForm.items.addPart")}
        </Button>

        {/* THE SUGGESTION (owner): a split is allowed, but a listing sold this way again is a bundle
            waiting to be defined. Offered, never required. */}
        <Button
          type="button"
          size="xs"
          variant="ghost"
          colorPalette="primary"
          data-testid={`draft-row-${index}-make-bundle`}
          onClick={() =>
            toaster.create({ type: "info", title: t("orderForm.pending.makeBundle.reason") })
          }
        >
          <Icon as={Layers} boxSize="4" />
          {t("orderDraftForm.items.makeBundle")}
          <NotImplemented list={ORDER_DRAFT_PENDING} id="makeBundle" />
        </Button>
      </Flex>
    </Stack>
  );
}

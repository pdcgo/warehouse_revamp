import { useState } from "react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router-dom";
import { fromHere } from "../../../lib/cameFrom";
import { Badge, Box, Button, Flex, HStack, Icon, Portal, SimpleGrid, Stack, Table, Text, Tooltip } from "@chakra-ui/react";
import { Archive, Package, Pencil, Plus, RotateCcw, SearchX, Trash2 } from "lucide-react";
import { rpcError } from "../../../api/clients";
import type { Product } from "../../../gen/warehouse/product/v1/product_pb";
import { ProductStatus } from "../../../gen/warehouse/product/v1/product_pb";
import { ConfirmDialog } from "../../../components/feedback/ConfirmDialog";
import { EmptyHint } from "../../../components/feedback/EmptyHint";
import { ListSkeleton } from "../../../components/feedback/ListSkeleton";
import { RefreshOverlay } from "../../../components/feedback/RefreshOverlay";
import { GrowingPager } from "../../../components/chrome/GrowingPager";
import { SortableHeader, type SortState } from "../../../components/chrome/SortableHeader";
import { ProductListItem } from "../../../components/products/ProductListItem";
import { toaster } from "../../../components/feedback/Toaster";
import {
  type ProductLockPick,
  type ProductSortKey,
  useArchiveProduct,
  useProducts,
  useDeleteProduct,
  useUnarchiveProduct,
  useSetProductLock,
} from "../../../features/products/queries";
import { useIsMobile } from "../../../layouts/shell";
import { formatUnixDate } from "../../../lib/datetime";
import { formatMarkup, withMarkup } from "../../../lib/markup";
import { formatRupiah, formatRupiahRange } from "../../../lib/money";
import { PRESSABLE } from "../../../lib/motion";
import { ProductLockControl } from "../../../features/products/ProductLock";
import { QUIET_SALE_DAYS, STALE_STOCK_DAYS, daysAgo } from "../../../features/products/stockAge";
import { useCanWrite } from "../../../features/team/TeamContext";

const PAGE_SIZE_OPTIONS = [10, 20, 50];

// A ROW LIGHTS UP under the pointer, every cell of it (a-table-row-lights-up); Chakra's `_hover` honours `data-hover`.
const LIGHTS_UP = { _hover: { "& > td": { bg: "bg.muted" } } } as const;

// Which list this table is: a team's own catalogue, live or archived. A warehouse's Products is not this table — it is
// what the warehouse holds (WarehouseStockList, a-warehouses-products-is-what-it-holds).
export type ProductsMode = "active" | "archived";

interface ProductsTableProps {
  mode: ProductsMode;
  teamId: bigint | undefined;
  /** The search box lives on the page, above the tabs, so both lists answer the same question. */
  q: string;
  /**
   * The warehouse LENS — 0n means all of them. It narrows what the stock columns MEAN, not which
   * products are listed: your catalogue is yours wherever the goods happen to sit.
   */
  warehouseId: bigint;
  /** Its name, for the column headers — a figure that silently became one warehouse's is a trap. */
  warehouseName?: string;
  /** The heading's sort (a-table-sorts-from-its-headings) — held in the page's URL. */
  sort?: SortState<ProductSortKey> | null;
  /** The Kunci pick, narrowed on the server (lock-and-stock-age-filter-ahead-of-the-contract) — the live list only. */
  lock?: ProductLockPick;
  /** The Umur stok pick in days, narrowed on the server, read in the lens's warehouse — the live list only. */
  minStockAgeDays?: number;
  onSortChange?: (next: SortState<ProductSortKey> | null) => void;
  /** Whether the page's filter strip narrows the list — an empty list then says "nothing matches", not "nothing yet". */
  filtered: boolean;
  /** The strip's Hapus Filter, for the empty hint — one function, two buttons (an-empty-list-shows-a-hint). */
  onClearFilters: () => void;
  /** New Product, for the empty catalogue's hint. */
  onCreate?: () => void;
}

// ── The stock cells ──────────────────────────────────────────────────────────────────────────────
//
// Every figure comes from another service — stock, costs, batches and restocks from inventory_service
// (OwnerStockByIds), sales from selling_service (OrderProductActivityByIds) — batched once per PAGE
// and looked up here by product id.
//
// A product those reads say nothing about renders an em dash, NOT a zero. Absent means the ownership
// join found no stock and no order behind it, and "you have none on a shelf" is a claim neither read
// actually made. The distinction matters most on exactly the row you would act on.

// SIAP — what can be sold now — and under it WHEN IT LAST SOLD (owner: *"last order di bawah dipesan"*, then the lock
// took Dipesan's place and the last order came here, `one-lock-three-ways`): a sale is drawn from exactly this stock,
// as Dikirim's restock date is what arrives into it. What it is worth at cost rides on the figure's title on a row (a
// third line would break one-context-per-column-and-never-three-lines) and inline on a phone, where nothing hovers.
function ReadyCell({
  qty,
  value,
  lastOrderUnix,
  productCode,
  phone = false,
}: {
  qty?: bigint;
  value?: number;
  lastOrderUnix?: bigint;
  productCode: string;
  /** A phone block's fact: start-aligned, the worth beside the units rather than on a title nobody can hover. */
  phone?: boolean;
}) {
  const { t } = useTranslation();
  const worth = value !== undefined ? formatRupiah(value) : undefined;

  return (
    <Stack gap="0" align={phone ? "start" : "end"}>
      {qty === undefined ? (
        <Unknown />
      ) : (
        <Text fontWeight="medium" title={phone ? undefined : worth}>
          {t("products.stat.pcs", { n: qty.toString() })}
          {phone && worth !== undefined && ` · ${worth}`}
        </Text>
      )}
      <DateLine
        unix={lastOrderUnix}
        hint={t("products.table.lastOrder")}
        never={t("products.table.noOrderYet")}
        quietAfterDays={QUIET_SALE_DAYS}
        quietHint={t("products.table.quietHint", { days: QUIET_SALE_DAYS })}
        testId={`last-order-${productCode}`}
      />
    </Stack>
  );
}

// A QUIET SECOND LINE WHOSE NAME IS A TOOLTIP (owner: *"keterangan cross, pesanan dan restock di bawah sebagai tooltip
// saja"*, `a-second-line-names-itself-in-a-tooltip`) — the line is its value alone (*7 Okt 2026*, *Rp 51.412 – Rp
// 53.100*); what it is (*Pesanan terakhir*, *Restock terakhir*, *Harga cross*) shows on hover, and is spoken with the
// value, since a tooltip needs a hover a phone and a screen reader do not have.
function SecondLine({
  hint,
  value,
  testId,
  tone = "muted",
}: {
  hint: string;
  value: string;
  testId: string;
  /** `quiet` — past its line, in the warning tone and bold (a product nobody has ordered for a month). */
  tone?: "muted" | "subtle" | "quiet";
}) {
  return (
    <Tooltip.Root openDelay={100} closeDelay={80}>
      <Tooltip.Trigger asChild>
        <Text
          fontSize="xs"
          whiteSpace="nowrap"
          color={tone === "quiet" ? "warning.fg" : tone === "subtle" ? "fg.subtle" : "fg.muted"}
          fontWeight={tone === "quiet" ? "bold" : undefined}
          aria-label={`${hint}: ${value}`}
          data-quiet={tone === "quiet" || undefined}
          data-testid={testId}
        >
          {value}
        </Text>
      </Tooltip.Trigger>
      <Portal>
        <Tooltip.Positioner>
          <Tooltip.Content data-testid={`${testId}-hint`}>{hint}</Tooltip.Content>
        </Tooltip.Positioner>
      </Portal>
    </Tooltip.Root>
  );
}

// A cost range is written on one line by `formatRupiahRange` — BOTH ENDS ON ONE LINE (owner: *"di story kasih contoh range
// price, semuanya cuma 1 price?"*, `a-cost-range-reads-as-a-range`): stacked, the dearest under the cheapest, the second
// line read as another figure.

// THE HPP (cost) RANGE — the cheapest and dearest units currently held, across every warehouse; a range rather than one
// number because it genuinely is one, and an average would hide exactly the spread somebody opens this screen to see —
// and UNDER IT WHAT ANOTHER TEAM PAYS (owner: *"harga crossnya di bawah hpp"*, `the-cross-price-rides-under-the-cost`):
// the same range with the markup on both ends, rounded as the product's Price tab rounds it — basis points over rupiah
// land on fractions no invoice carries. It names itself in a tooltip (a-second-line-names-itself-in-a-tooltip). 0%
// charges nothing, so its price is the cost; nothing on a shelf has neither.
function CostCell({
  stock,
  markupBps,
  productCode,
  phone = false,
}: {
  stock?: { costKnown: boolean; costMin: number; costMax: number };
  markupBps: number;
  productCode: string;
  /** A phone block's fact: start-aligned. */
  phone?: boolean;
}) {
  const { t } = useTranslation();

  // Only a cost actually known — costMin/costMax are 0 when no ready unit was ever costed, and 0..0 would read as
  // "it was free".
  if (!stock?.costKnown) {
    return <Unknown />;
  }

  return (
    <Stack gap="0" align={phone ? "start" : "end"}>
      <Text whiteSpace="nowrap" data-range={stock.costMin !== stock.costMax || undefined}>
        {formatRupiahRange(stock.costMin, stock.costMax)}
      </Text>
      <SecondLine
        hint={t("products.table.crossPriceHint")}
        value={formatRupiahRange(withMarkup(stock.costMin, markupBps), withMarkup(stock.costMax, markupBps))}
        testId={`cross-price-${productCode}`}
      />
    </Stack>
  );
}

// CROSS — the markup another team pays over our cost; what that comes to is the line under the cost, beside it. 0% is
// not "unset": it is a decision to charge another team nothing, so it reads as a plain 0%, not a dash.
function CrossCell({ markupBps }: { markupBps: number }) {
  return <Badge colorPalette={markupBps > 0 ? "brand" : "gray"}>{formatMarkup(markupBps)}</Badge>;
}

// ── The age, and the two dates under their stock ─────────────────────────────────────────────────
//
// THE STOCK'S AGE IN DAYS (owner: *"pertanggalan itu memenuhi tabel, tapi harusnya berguna kalau ditampilkan"*,
// `the-dates-read-as-ages`) — how long the oldest units have sat, its own column: it is about the shelf.
//
// EACH DATE UNDER THE STOCK IT DATES (owner: *"last order di bawah dipesan dan last restock di bawah ongoing"*,
// `each-date-rides-under-its-stock`) — when it was last ordered is the second line of what is spoken for (Dipesan),
// when stock last arrived is the second line of what is on its way (Dikirim). AS A DATE, not "3 hari yang lalu" (owner:
// *"pakai tanggal aja, jangan beberapa hari lalu dsb, umur stok tetap hari"*, `a-row-date-reads-as-a-date`).

// The thresholds and the day count live in features/products/stockAge — the product page's tile reads them too.
export { QUIET_SALE_DAYS, STALE_STOCK_DAYS } from "../../../features/products/stockAge";

// HOW LONG THE OLDEST UNITS ON A SHELF HAVE SAT — the oldest batch still holding ready units (FIFO draws it next), in
// days. Past STALE_STOCK_DAYS it is in the warning tone; the day it arrived is on its title.
function StockAgeCell({ unix }: { unix?: bigint }) {
  const { t } = useTranslation();

  // 0 = nothing on a shelf, so nothing has an age.
  if (unix === undefined || unix <= 0n) {
    return <Unknown />;
  }

  const days = daysAgo(unix);
  const stale = days >= STALE_STOCK_DAYS;
  const arrived = t("products.table.stockAgeTitle", { date: formatUnixDate(unix) });

  return (
    <Text
      whiteSpace="nowrap"
      color={stale ? "warning.fg" : undefined}
      fontWeight={stale ? "bold" : undefined}
      title={stale ? `${arrived} · ${t("products.table.staleHint", { days: STALE_STOCK_DAYS })}` : arrived}
      data-stale={stale || undefined}
    >
      {t("products.table.days", { count: days })}
    </Text>
  );
}

// A date as the quiet second line under its stock — "7 Okt 2026", named in its tooltip — "—" while nobody has told us,
// its own words when it never happened.
function DateLine({
  unix,
  hint,
  never,
  quietAfterDays,
  quietHint,
  testId,
}: {
  unix?: bigint;
  /** What the date is — "Pesanan terakhir" — shown on hover. */
  hint: string;
  never: string;
  /** From this many days the line turns to the warning tone — a product nobody has ordered for a month. */
  quietAfterDays?: number;
  quietHint?: string;
  testId: string;
}) {
  if (unix === undefined) {
    return <SecondLine hint={hint} value="—" tone="subtle" testId={testId} />;
  }

  if (unix <= 0n) {
    return <SecondLine hint={hint} value={never} testId={testId} />;
  }

  const quiet = quietAfterDays !== undefined && daysAgo(unix) >= quietAfterDays;

  return (
    <SecondLine
      hint={quiet && quietHint ? `${hint} · ${quietHint}` : hint}
      value={formatUnixDate(unix)}
      tone={quiet ? "quiet" : "muted"}
      testId={testId}
    />
  );
}

// DIKIRIM — ordered on a restock, not yet accepted onto a rack (an estimate until it lands, #74, so never summed into
// ready) — and under it when stock last arrived. Its estimated worth is on the figure's title: three lines would break
// one-context-per-column-and-never-three-lines, and the strip above carries the catalogue's.
function OngoingCell({
  qty,
  value,
  lastRestockUnix,
  productCode,
  align = "end",
}: {
  qty?: bigint;
  value?: number;
  lastRestockUnix?: bigint;
  productCode: string;
  align?: "start" | "end";
}) {
  const { t } = useTranslation();

  return (
    <Stack gap="0" align={align}>
      {qty === undefined ? (
        <Unknown />
      ) : (
        <Text fontWeight="medium" title={value !== undefined ? formatRupiah(value) : undefined}>
          {t("products.stat.pcs", { n: qty.toString() })}
        </Text>
      )}
      <DateLine
        unix={lastRestockUnix}
        hint={t("products.table.lastRestock")}
        never={t("products.table.neverRestocked")}
        testId={`last-restock-${productCode}`}
      />
    </Stack>
  );
}

function Unknown() {
  return (
    <Text color="fg.subtle" data-testid="stock-unknown">
      —
    </Text>
  );
}

// ONE FACT OF A PHONE BLOCK — its name over its value, half the block wide (a-phone-reads-each-line-as-a-block).
function Fact({ label, children, wide = false }: { label: string; children: ReactNode; wide?: boolean }) {
  return (
    <Stack gap="0" minW="0" gridColumn={wide ? "1 / -1" : undefined}>
      <Text fontSize="xs" color="fg.muted" truncate>
        {label}
      </Text>
      <Box fontSize="sm" fontWeight="medium" truncate>
        {children}
      </Box>
    </Stack>
  );
}

// One table, two lists. They share their whole body — a page of products, searched and paginated — and differ only in
// which rows they ask for and what may be done to a row, so splitting them into two components would be two copies of
// the same table drifting apart.
export function ProductsTable({
  mode,
  teamId,
  q,
  warehouseId,
  warehouseName,
  sort = null,
  lock,
  minStockAgeDays = 0,
  onSortChange,
  filtered,
  onClearFilters,
  onCreate,
}: ProductsTableProps) {
  const navigate = useNavigate();
  // The list as it stands — handed to the form, so its Back returns here with the filters kept (the-form-returns-where-it-was-opened).
  const location = useLocation();
  const { t } = useTranslation();
  const isMobile = useIsMobile();

  // Every stock header carries the warehouse when one is chosen, so nobody reads a single warehouse's number as the
  // total. With none chosen the headers stay bare — "everywhere" is the default reading of a stock figure and does not
  // need saying.
  const scoped = (label: string) => (warehouseName ? `${label} · ${warehouseName}` : label);

  // A search, a lens or a sort is a new question, so it starts again at page one — the page is held WITH the question
  // it belongs to, and a different question reads page one without an effect to reset it.
  const question = [mode, q, warehouseId.toString(), sort ? `${sort.by}:${sort.dir}` : "", lock ?? "", minStockAgeDays].join("|");
  const [paging, setPaging] = useState({ question, page: 1 });
  const page = paging.question === question ? paging.page : 1;
  const setPage = (next: number) => setPaging({ question, page: next });
  const [pageSize, setPageSize] = useState(20);

  const isArchived = mode === "archived";
  // While the admin team monitors the team, a row offers nothing and the lock only reads.
  const writable = useCanWrite();

  const query = useProducts({
    teamId,
    q,
    page,
    pageSize,
    status: isArchived ? ProductStatus.ARCHIVED : ProductStatus.ACTIVE,
    warehouseId,
    sort,
    lock,
    minStockAgeDays,
  });
  const archiveProduct = useArchiveProduct();
  const restoreProduct = useUnarchiveProduct();
  const deleteProduct = useDeleteProduct();
  const setLock = useSetProductLock();

  const products = query.data?.products ?? [];
  const totalItems = query.data?.totalItems ?? 0;
  const error = query.isError ? rpcError(query.error) : "";
  // Always-fresh: this list refetches on every mount, tab and page change. `listQuery` keeps the rows already on screen
  // while it does, and RefreshOverlay says a newer answer is coming. `isPending` is excluded — a first load has nothing
  // to keep and shows the list's shape instead.
  const refreshing = query.isFetching && !query.isPending;

  // Looked up by id rather than merged into the product: the two reads answer for the PAGE, and a product they say
  // nothing about has to stay undefined so its cells read "unknown", not "none".
  const stockOf = (product: Product) => query.data?.stock?.get(product.id.toString());
  const activityOf = (product: Product) => query.data?.activity?.get(product.id.toString());

  async function archive(product: Product) {
    if (teamId === undefined) {
      return;
    }

    try {
      await archiveProduct.mutateAsync({ teamId, productId: product.id });
      toaster.create({ type: "success", title: t("products.toast.archived", { productCode: product.productCode }) });
    } catch (err) {
      toaster.create({
        type: "error",
        title: t("products.toast.archiveFailed"),
        description: rpcError(err),
      });
    }
  }

  // DELETE, for good — offered on the Archived view, where a typo or a duplicate goes first. Only a product with no
  // history is deleted; any other is refused, and the server's reason (archive it instead) is the toast.
  async function remove(product: Product) {
    if (teamId === undefined) {
      return;
    }

    try {
      await deleteProduct.mutateAsync({ teamId, productId: product.id });
      toaster.create({ type: "success", title: t("products.toast.deleted", { productCode: product.productCode }) });
    } catch (err) {
      toaster.create({ type: "error", title: t("products.toast.deleteFailed"), description: rpcError(err) });
    }
  }

  // UNARCHIVE — under the code it kept: an archived product holds its code, so nothing can collide on the way back
  // (the-field-is-product-code-composed-on-write).
  async function restore(product: Product) {
    if (teamId === undefined) {
      return;
    }

    try {
      await restoreProduct.mutateAsync({ teamId, productId: product.id });
      toaster.create({ type: "success", title: t("products.toast.restored", { productCode: product.productCode }) });
    } catch (err) {
      toaster.create({
        type: "error",
        title: t("products.toast.restoreFailed"),
        description: rpcError(err),
      });
    }
  }

  // THE LOCK, edited in place from its popover (`one-lock-three-ways`). Resolves whether it took, so the popover stays
  // open on a failure; the row follows the server's answer on the refetch.
  async function saveLock(product: Product, fields: { crossLocked: boolean; reservedStock?: number }): Promise<boolean> {
    if (teamId === undefined) {
      return false;
    }

    try {
      await setLock.mutateAsync({ teamId, productId: product.id, ...fields });
      toaster.create({ type: "success", title: t("products.lock.saved") });
      return true;
    } catch (err) {
      toaster.create({
        type: "error",
        title: t("products.toast.lockFailed"),
        description: rpcError(err),
      });
      return false;
    }
  }

  // Whether a row opens anything. An archived product opens nothing from here — restore it first, that is what the
  // archive is for.
  const opens = !isArchived;

  function openRow(product: Product) {
    if (opens) {
      navigate(`/products/${product.id}`);
    }
  }

  // ONE cell, not image + SKU + name: a product is one thing, and this is the app's one way of drawing it (#128). No
  // team badge: on your own catalogue it would be your own name on every row.
  function productItem(product: Product) {
    return (
      <Box data-testid={`open-product-${product.productCode}`} minW={isMobile ? "0" : "15rem"}>
        <ProductListItem
          product={{
            id: product.id,
            productCode: product.productCode,
            name: product.name,
            defaultImageUrl: product.defaultImageUrl,
            defaultImageThumbnailUrl: product.defaultImageThumbnailUrl,
          }}
          // THE SKU COPIES on a click (owner: *"sku copyable"*) — it is carried into marketplace listings and suppliers'
          // sheets; the click does not open the row.
          productCodeCopyable
        />
      </Box>
    );
  }

  // THE LOCK — one setting, three ways (`one-lock-three-ways`): Terbuka, Min N pcs, Selalu dikunci. Edited in the row —
  // deciding who may sell what is a pass down the whole catalogue, and a trip into each product's form would turn a
  // two-minute review into forty. Only the owner may set it, and only on a live product. A minimum in force right now is
  // badged — judged on the TOTAL stock, so not while a warehouse lens shows one building's.
  function lockControl(product: Product) {
    return (
      <ProductLockControl
        product={product}
        totalReady={warehouseId === 0n ? stockOf(product)?.readyQty : undefined}
        editable={mode === "active" && writable}
        onSave={(fields) => saveLock(product, fields)}
        testId={`lock-${product.productCode}`}
      />
    );
  }

  // EACH ACTION A LABELLED BUTTON WITH ITS ICON (an-action-button-carries-its-icon) — the same on a row and at a phone
  // block's foot.
  function actions(product: Product) {
    if (!writable) return null;

    return (
      <HStack justify="end" gap="1.5">
        {mode === "active" && (
          <>
            <Button
              size="xs"
              variant="outline"
              data-testid={`edit-${product.productCode}`}
              onClick={() => navigate(`/products/${product.id}/edit`, { state: fromHere(location) })}
            >
              <Icon as={Pencil} boxSize="4" />
              {t("products.edit")}
            </Button>

            <ConfirmDialog
              title={t("products.archiveDialog.title")}
              message={t("products.archiveDialog.message", { productCode: product.productCode })}
              confirmLabel={t("products.archiveDialog.confirmLabel")}
              onConfirm={() => archive(product)}
              trigger={
                <Button size="xs" variant="outline" colorPalette="error" data-testid={`archive-${product.productCode}`}>
                  <Icon as={Archive} boxSize="4" />
                  {t("products.archive")}
                </Button>
              }
            />
          </>
        )}

        {isArchived && (
          <>
            <Button size="xs" variant="outline" data-testid={`restore-${product.productCode}`} onClick={() => restore(product)}>
              <Icon as={RotateCcw} boxSize="4" />
              {t("products.restore")}
            </Button>

            {/* DELETE confirms: it cannot be undone. Refused for a product with any history. */}
            <ConfirmDialog
              title={t("products.deleteDialog.title")}
              message={t("products.deleteDialog.message", { productCode: product.productCode })}
              confirmLabel={t("products.deleteDialog.confirmLabel")}
              onConfirm={() => remove(product)}
              trigger={
                <Button size="xs" variant="outline" colorPalette="error" data-testid={`delete-${product.productCode}`}>
                  <Icon as={Trash2} boxSize="4" />
                  {t("products.delete")}
                </Button>
              }
            />
          </>
        )}
      </HStack>
    );
  }

  function list() {
    if (products.length === 0 && !error) {
      // AN EMPTY LIST SAYS WHAT NEXT (an-empty-list-shows-a-hint) — nothing matches: clear the filters; nothing archived:
      // where archived products wait; nothing yet: add the first. The title keeps the line the screen said before.
      if (filtered) {
        return (
          <EmptyHint
            icon={SearchX}
            title={t("products.empty")}
            description={t("emptyHint.noMatch")}
            action={
              <Button variant="outline" colorPalette="gray" onClick={onClearFilters}>
                {t("common.clearFilters")}
              </Button>
            }
            testId="products-empty"
          />
        );
      }

      if (isArchived) {
        return (
          <EmptyHint
            icon={Archive}
            title={t("products.emptyArchived")}
            description={t("products.emptyArchivedHint")}
            testId="products-empty"
          />
        );
      }

      return (
        <EmptyHint
          icon={Package}
          title={t("products.none")}
          description={t("products.emptyHint")}
          action={
            onCreate && (
              <Button colorPalette="brand" onClick={onCreate}>
                <Icon as={Plus} boxSize="4" />
                {t("products.newProduct")}
              </Button>
            )
          }
          testId="products-empty"
        />
      );
    }

    if (isMobile) {
      // A PHONE READS EACH PRODUCT AS A BLOCK (a-phone-reads-each-line-as-a-block) — eleven columns do not fit 390px. The
      // product at full width; its figures two to a line, each its name over its value; then the lock and the actions
      // at its foot. A block lights up and presses only when it opens something (a-table-row-lights-up).
      return (
        <Stack gap="2" data-testid="products-table">
          {products.map((product) => (
            <Stack
              key={product.id.toString()}
              data-testid={`product-row-${product.productCode}`}
              borderWidth="1px"
              borderRadius="md"
              p="3"
              gap="2.5"
              {...(opens ? PRESSABLE : {})}
              onClick={() => openRow(product)}
            >
              {productItem(product)}

              <SimpleGrid columns={2} columnGap="3" rowGap="2">
                <Fact label={scoped(t("products.table.ready"))} wide>
                  <ReadyCell
                    qty={stockOf(product)?.readyQty}
                    value={stockOf(product)?.readyValue}
                    lastOrderUnix={activityOf(product)?.lastOrderUnix}
                    productCode={product.productCode}
                    phone
                  />
                </Fact>
                <Fact label={scoped(t("products.table.ongoing"))}>
                  <OngoingCell
                    qty={stockOf(product)?.ongoingQty}
                    value={stockOf(product)?.ongoingValueEst}
                    lastRestockUnix={stockOf(product)?.lastRestockUnix}
                    productCode={product.productCode}
                    align="start"
                  />
                </Fact>
                {/* Cross, then the cost with what another team pays under it (the-cross-price-rides-under-the-cost). */}
                <Fact label={t("products.table.cross")}>
                  <CrossCell markupBps={product.crossMarkupBps} />
                </Fact>
                <Fact label={scoped(t("products.table.priceRange"))}>
                  <CostCell stock={stockOf(product)} markupBps={product.crossMarkupBps} productCode={product.productCode} phone />
                </Fact>
                <Fact label={scoped(t("products.table.stockAge"))}>
                  <StockAgeCell unix={stockOf(product)?.oldestBatchUnix} />
                </Fact>
              </SimpleGrid>

              {/* THE FOOT: the lock, then the actions — the lock on Ubah's left (owner: *"di mobile kunci di kiri edit dan
                  jadi modal"*, a-phone-edits-the-lock-in-a-modal), its editor a modal on a phone. A press here does
                  not open the product. */}
              <Flex justify="flex-end" align="center" gap="1.5" wrap="wrap" onClick={(e) => e.stopPropagation()}>
                {lockControl(product)}
                {actions(product)}
              </Flex>
            </Stack>
          ))}
        </Stack>
      );
    }

    return (
      <Table.ScrollArea>
        <Table.Root size="sm" data-testid="products-table">
          <Table.Header>
            <Table.Row>
              {/* THE SORT IS IN THE HEADING (a-table-sorts-from-its-headings) — by name, A to Z first: the column the
                  contract orders the catalogue by that the row shows first. */}
              {onSortChange ? (
                <SortableHeader
                  column="name"
                  label={t("products.table.product")}
                  sort={sort}
                  onSortChange={onSortChange}
                  firstDir="asc"
                  testId="product-sort-name"
                />
              ) : (
                <Table.ColumnHeader>{t("products.table.product")}</Table.ColumnHeader>
              )}
              {/* CROSS FIRST, THEN THE COST (owner: *"cross taruh di sebelum hpp, lalu harga cross taruh bawahnya"*,
                  the-cross-price-rides-under-the-markup, then *"harga crossnya di bawah hpp"*, the-cross-price-rides-under-the-cost):
                  the markup, then what the units cost us — a low-to-high range across the warehouses — and under that what
                  another team pays. */}
              <Table.ColumnHeader textAlign="end">{t("products.table.cross")}</Table.ColumnHeader>
              <Table.ColumnHeader textAlign="end">{scoped(t("products.table.priceRange"))}</Table.ColumnHeader>
              {/* THE LOCK — whether another team may sell it at all (one-lock-three-ways). */}
              <Table.ColumnHeader>{t("products.lock.title")}</Table.ColumnHeader>
              {/* The stock, in the order a seller asks it: what can I sell, and what is coming — each with its date
                  under it (each-date-rides-under-its-stock): the last order under Siap, the last restock under Dikirim. */}
              <Table.ColumnHeader textAlign="end">{scoped(t("products.table.ready"))}</Table.ColumnHeader>
              <Table.ColumnHeader textAlign="end">{scoped(t("products.table.ongoing"))}</Table.ColumnHeader>
              {/* THE STOCK'S AGE (the-dates-read-as-ages) — how long the oldest units have sat, the column that finds dead
                  stock before it is written off. */}
              <Table.ColumnHeader>{scoped(t("products.table.stockAge"))}</Table.ColumnHeader>
              <Table.ColumnHeader textAlign="end">{t("products.table.actions")}</Table.ColumnHeader>
            </Table.Row>
          </Table.Header>

          <Table.Body>
            {products.map((product) => (
              <Table.Row
                key={product.id.toString()}
                data-testid={`product-row-${product.productCode}`}
                cursor={opens ? "pointer" : undefined}
                css={LIGHTS_UP}
                onClick={() => openRow(product)}
              >
                <Table.Cell>{productItem(product)}</Table.Cell>

                <Table.Cell textAlign="end" data-testid={`cross-${product.productCode}`}>
                  <CrossCell markupBps={product.crossMarkupBps} />
                </Table.Cell>
                <Table.Cell textAlign="end">
                  <CostCell stock={stockOf(product)} markupBps={product.crossMarkupBps} productCode={product.productCode} />
                </Table.Cell>
                {/* The lock's popover must not also open the row. */}
                <Table.Cell onClick={(e) => e.stopPropagation()}>{lockControl(product)}</Table.Cell>
                <Table.Cell textAlign="end">
                  <ReadyCell
                    qty={stockOf(product)?.readyQty}
                    value={stockOf(product)?.readyValue}
                    lastOrderUnix={activityOf(product)?.lastOrderUnix}
                    productCode={product.productCode}
                  />
                </Table.Cell>
                <Table.Cell textAlign="end">
                  <OngoingCell
                    qty={stockOf(product)?.ongoingQty}
                    value={stockOf(product)?.ongoingValueEst}
                    lastRestockUnix={stockOf(product)?.lastRestockUnix}
                    productCode={product.productCode}
                  />
                </Table.Cell>
                <Table.Cell data-testid={`stock-age-${product.productCode}`}>
                  <StockAgeCell unix={stockOf(product)?.oldestBatchUnix} />
                </Table.Cell>

                {/* Row-action clicks must not bubble to the row's navigate. */}
                <Table.Cell textAlign="end" onClick={(e) => e.stopPropagation()}>
                  {actions(product)}
                </Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table.Root>
      </Table.ScrollArea>
    );
  }

  return (
    <Stack gap="section">
      {error && (
        <Text color="error.fg" data-testid="products-error">
          {error}
        </Text>
      )}

      {/* THE FIRST LOAD SHOWS THE LIST'S SHAPE, and the rows fade in over it — once; a refresh keeps them mounted
          (motion-is-small-quick-and-shared). */}
      {query.isPending ? (
        <ListSkeleton testId="products-loading" />
      ) : (
        <Box animationStyle="swap">
          <RefreshOverlay busy={refreshing}>{list()}</RefreshOverlay>
        </Box>
      )}

      {/* THE PAGES GROW AS THEY ARE OPENED (every-list-pages-with-the-growing-pager). */}
      <GrowingPager
        page={page}
        onPageChange={setPage}
        hasNext={query.isPlaceholderData ? undefined : page * pageSize < totalItems}
        resetKey={[question, pageSize].join("|")}
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

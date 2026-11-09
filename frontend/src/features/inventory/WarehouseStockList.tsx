import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { Badge, Box, Button, HStack, Icon, IconButton, Menu, Portal, Stack, Table, Text } from "@chakra-ui/react";
import { ArrowRightLeft, Boxes, MoreHorizontal, Pencil, SearchX } from "lucide-react";
import { rpcError } from "../../api/clients";
import { FilterBar, FilterSearch } from "../../components/chrome/FilterBar";
import { GrowingPager } from "../../components/chrome/GrowingPager";
import { EmptyHint } from "../../components/feedback/EmptyHint";
import { ListSkeleton } from "../../components/feedback/ListSkeleton";
import { RefreshOverlay } from "../../components/feedback/RefreshOverlay";
import { useIsMobile } from "../../layouts/shell";
import { PRESSABLE } from "../../lib/motion";
import { textCodec, useUrlState } from "../../lib/urlState";
import { useDebounced } from "../../lib/useDebounced";
import { canWrite, useTeam } from "../team/TeamContext";
import { AdjustStockDialog } from "./AdjustStockDialog";
import { MoveStockDialog } from "./MoveStockDialog";
import { type StockScreenRow, useWarehouseStock } from "./queries";

export const description =
  "What one warehouse holds: every product with a batch there — any team's, archived ones labelled, at 0 too — with its owner and its units on hand, searched on the server and paged. Adjust and Move sit in each row's overflow; a row opens the warehouse product page when `opensProduct` is set.";

const PAGE_SIZE_OPTIONS = [10, 20, 50];

// The server searches from the SECOND character (WarehouseStockList refuses one): until then the list is unnarrowed.
const MIN_TERM = 2;

// A ROW LIGHTS UP UNDER THE POINTER (`a-table-row-lights-up`) — every cell, by Chakra's `_hover`.
const LIGHTS_UP = { _hover: { "& > td": { bg: "bg.muted" } } } as const;

interface WarehouseStockListProps {
  /** The warehouse whose shelves are listed. */
  warehouseId: bigint;
  /**
   * A row opens the warehouse product page (`/inventories/products/:id`) — a warehouse's own Products
   * (a-warehouses-products-is-what-it-holds). Off on the root/admin Inventory: that page reads the CURRENT team's
   * building, so it opens only for a warehouse team.
   */
  opensProduct?: boolean;
}

// WarehouseStockList is THE LIST OF WHAT A WAREHOUSE HOLDS (the-stock-screen-lists-what-the-warehouse-has-held): every
// product with a batch in this warehouse — any team's, archived ones labelled, at 0 or not — each with its owner team and
// its units on hand, searched by name or code on the server, paged. A product emptied to 0 stays, so it can still be found
// and adjusted. Two screens show it (a-warehouses-products-is-what-it-holds):
//
//   a warehouse's Products (/products)   its own building; a row opens the warehouse product page
//   root/admin Inventory (/inventory)     the building picked above it; rows open nothing
//
//   [⌕ Search products by product code or name                ×]
//   Product code   · Product                     · Owner          · On hand · Actions
//   SL-03-ANG-003    Minyak Goreng 2L [Archived]   Toko Anggrek          0   [⋯]
//                                                                Per page [20 ⌄]  ‹ [1] ›
//
// The search lives in the URL (a-lists-filters-live-in-the-url) — a refresh, or Back from a product, opens the same
// narrowed list. Goods come IN only by a restock (a-box-nobody-raised-comes-in-by-the-teams-restock), so a row offers
// Adjust and Move and no receive.
export function WarehouseStockList({ warehouseId, opensProduct = false }: WarehouseStockListProps) {
  const { current } = useTeam();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const isMobile = useIsMobile();

  const [q, setQ] = useUrlState("q", "", textCodec);
  const [pageSize, setPageSize] = useState(20);

  // Asked of the server once typing pauses, and only from the second character — one letter matches most of a
  // warehouse, and the server refuses it.
  const typed = useDebounced(q.trim());
  const term = [...typed].length >= MIN_TERM ? typed : "";

  // Another warehouse, another term or another page size is a new question, so it starts again at page one — the page is
  // held WITH the question it belongs to, and a different question reads page one without an effect to reset it.
  const question = [warehouseId.toString(), term, pageSize].join("|");
  const [paging, setPaging] = useState({ question, page: 1 });
  const page = paging.question === question ? paging.page : 1;
  const setPage = (next: number) => setPaging({ question, page: next });

  const [dialog, setDialog] = useState<{ kind: "adjust" | "move"; row: StockScreenRow } | null>(null);

  const query = useWarehouseStock({ warehouseId, q: term, page, pageSize });

  const rows = query.data?.rows ?? [];
  const totalItems = query.data?.totalItems ?? 0;
  const error = query.isError ? rpcError(query.error) : "";
  const writes = canWrite(current);

  // The open dialog reads the row's figure as it is NOW — a refetch behind it (a move by the person at the next shelf)
  // reaches the dialog, as it did when the figure was a lookup.
  const onHandNow = (row: StockScreenRow) => rows.find((r) => r.product.id === row.product.id)?.onHand ?? row.onHand;

  const open = (row: StockScreenRow) => navigate(`/inventories/products/${row.product.id}`);

  function clearSearch() {
    setQ("");
    setPage(1);
  }

  // Adjust and Move sit in the overflow — goods come in by a restock, so the row has no receive of its own. The menu is
  // portalled, but React still bubbles its clicks through the row: the cell or the block foot that holds it stops them,
  // so picking an action never also opens the product.
  function actions(row: StockScreenRow) {
    if (!writes) return null;

    const code = row.product.productCode;

    return (
      <HStack justify="end" gap="1">
        <Menu.Root>
          <Menu.Trigger asChild>
            <IconButton size="xs" variant="ghost" aria-label={t("inventory.rowActions")} data-testid={`row-actions-${code}`}>
              <Icon as={MoreHorizontal} boxSize="4" />
            </IconButton>
          </Menu.Trigger>

          <Portal>
            <Menu.Positioner>
              <Menu.Content>
                <Menu.Item value="adjust" data-testid={`adjust-${code}`} onClick={() => setDialog({ kind: "adjust", row })}>
                  <Icon as={Pencil} boxSize="4" />
                  {t("inventory.adjust")}
                </Menu.Item>

                <Menu.Item value="move" data-testid={`move-${code}`} onClick={() => setDialog({ kind: "move", row })}>
                  <Icon as={ArrowRightLeft} boxSize="4" />
                  {t("inventory.move")}
                </Menu.Item>
              </Menu.Content>
            </Menu.Positioner>
          </Portal>
        </Menu.Root>
      </HStack>
    );
  }

  // The product's name, and — when its seller archived it — the label that says so (an archived product held here is
  // still listed, and still adjusted).
  function productName(row: StockScreenRow) {
    const code = row.product.productCode;

    return (
      <HStack gap="2" minW="0">
        <Text lineClamp={2}>{row.product.name}</Text>
        {row.archived && (
          <Badge colorPalette="gray" flexShrink={0} data-testid={`stock-archived-${code}`}>
            {t("products.picker.archived")}
          </Badge>
        )}
      </HStack>
    );
  }

  function list() {
    if (rows.length === 0) {
      return term !== "" ? (
        <EmptyHint
          icon={SearchX}
          title={t("inventory.noneMatch")}
          description={t("emptyHint.noMatch")}
          testId="inventory-none-match"
          action={
            <Button variant="outline" colorPalette="gray" onClick={clearSearch}>
              {t("common.clearFilters")}
            </Button>
          }
        />
      ) : (
        <EmptyHint icon={Boxes} title={t("inventory.empty")} description={t("inventory.emptyHint")} testId="inventory-empty" />
      );
    }

    if (isMobile) {
      // A PHONE READS EACH PRODUCT AS A BLOCK (`a-phone-reads-each-line-as-a-block`): the name at full width with its
      // label, then its code and owner, the units on hand at the end, and the row's actions beside them. A block lights
      // up and gives under a thumb only when it opens something (a-table-row-lights-up).
      return (
        <Stack gap="2" data-testid="inventory-table">
          {rows.map((row) => {
            const code = row.product.productCode;

            return (
              <Stack
                key={row.product.id.toString()}
                data-testid={`stock-row-${code}`}
                borderWidth="1px"
                borderRadius="md"
                p="3"
                gap="1"
                {...(opensProduct ? PRESSABLE : {})}
                onClick={opensProduct ? () => open(row) : undefined}
              >
                {productName(row)}
                <HStack gap="2" align="center">
                  <Stack gap="0" flex="1" minW="0">
                    <Text fontSize="sm" color="fg.muted" truncate>
                      {code}
                    </Text>
                    <Text fontSize="sm" color="fg.muted" truncate data-testid={`stock-owner-${code}`}>
                      {row.ownerName}
                    </Text>
                  </Stack>
                  <Text fontWeight="bold" data-testid={`stock-onhand-${code}`}>
                    {row.onHand.toString()}
                  </Text>
                  <Box onClick={(e) => e.stopPropagation()}>{actions(row)}</Box>
                </HStack>
              </Stack>
            );
          })}
        </Stack>
      );
    }

    return (
      <Table.Root size="sm" data-testid="inventory-table">
        <Table.Header>
          <Table.Row>
            <Table.ColumnHeader>{t("inventory.table.sku")}</Table.ColumnHeader>
            <Table.ColumnHeader>{t("inventory.table.product")}</Table.ColumnHeader>
            <Table.ColumnHeader>{t("inventory.table.owner")}</Table.ColumnHeader>
            <Table.ColumnHeader textAlign="end">{t("inventory.table.onHand")}</Table.ColumnHeader>
            <Table.ColumnHeader textAlign="end">{t("inventory.table.actions")}</Table.ColumnHeader>
          </Table.Row>
        </Table.Header>

        <Table.Body>
          {rows.map((row) => {
            const code = row.product.productCode;

            return (
              <Table.Row
                key={row.product.id.toString()}
                data-testid={`stock-row-${code}`}
                css={LIGHTS_UP}
                cursor={opensProduct ? "pointer" : undefined}
                onClick={opensProduct ? () => open(row) : undefined}
              >
                <Table.Cell whiteSpace="nowrap">{code}</Table.Cell>
                <Table.Cell maxW="24rem">{productName(row)}</Table.Cell>
                <Table.Cell data-testid={`stock-owner-${code}`}>{row.ownerName}</Table.Cell>
                <Table.Cell textAlign="end" data-testid={`stock-onhand-${code}`}>
                  {row.onHand.toString()}
                </Table.Cell>
                {/* The actions' clicks — the trigger's and the portalled menu's — must not bubble to the row's open. */}
                <Table.Cell textAlign="end" onClick={(e) => e.stopPropagation()}>
                  {actions(row)}
                </Table.Cell>
              </Table.Row>
            );
          })}
        </Table.Body>
      </Table.Root>
    );
  }

  return (
    <>
      <FilterBar testId="inventory-filter" active={q.trim() !== ""} count={q.trim() !== "" ? 1 : 0} onClear={clearSearch}>
        <FilterSearch
          value={q}
          onChange={(value) => {
            setQ(value);
            setPage(1);
          }}
          placeholder={t("inventory.searchPlaceholder")}
          testId="inventory-search"
        />
      </FilterBar>

      {error && (
        <Text color="error.fg" data-testid="inventory-error">
          {error}
        </Text>
      )}

      {/* THE FIRST LOAD SHOWS THE LIST'S SHAPE (motion-is-small-quick-and-shared); a refresh keeps the rows up behind the
          overlay. */}
      {query.isPending ? (
        <ListSkeleton testId="inventory-loading" />
      ) : (
        !error && <RefreshOverlay busy={query.isFetching && !query.isPending}>{list()}</RefreshOverlay>
      )}

      {/* THE PAGES GROW AS THEY ARE OPENED (every-list-pages-with-the-growing-pager). */}
      <GrowingPager
        page={page}
        onPageChange={setPage}
        hasNext={query.isPlaceholderData ? undefined : page * pageSize < totalItems}
        resetKey={question}
        pageSize={pageSize}
        pageSizeOptions={PAGE_SIZE_OPTIONS}
        onPageSizeChange={(n) => {
          setPageSize(n);
          setPage(1);
        }}
        testId="inventory-pager"
      />

      {dialog?.kind === "adjust" && (
        <AdjustStockDialog
          key={dialog.row.product.id.toString()}
          warehouseId={warehouseId}
          product={dialog.row.product}
          currentOnHand={onHandNow(dialog.row)}
          open
          onOpenChange={(o) => {
            if (!o) setDialog(null);
          }}
        />
      )}

      {dialog?.kind === "move" && (
        <MoveStockDialog
          key={dialog.row.product.id.toString()}
          warehouseId={warehouseId}
          product={dialog.row.product}
          currentOnHand={onHandNow(dialog.row)}
          open
          onOpenChange={(o) => {
            if (!o) setDialog(null);
          }}
        />
      )}
    </>
  );
}

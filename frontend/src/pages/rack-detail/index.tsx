import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { Box, Button, Flex, HStack, Heading, Icon, IconButton, Span, Stack, Table, Tabs, Text } from "@chakra-ui/react";
import { ArrowLeft, ArrowRightLeft, Gift, History, PackageOpen } from "lucide-react";
import { productClient, rackClient, rpcError, teamClient } from "../../api/clients";
import { teamByIdsRowData, teamsByIds } from "../../features/teams/adapt";
import type { StockMovement } from "../../gen/warehouse/inventory/v1/inventory_pb";
import type { Rack, RackStockLine, RackSummary } from "../../gen/warehouse/inventory/v1/rack_pb";
import type { Product } from "../../gen/warehouse/product/v1/product_pb";
import type { Team } from "../../gen/warehouse/team/v1/team_pb";
import { TeamItem } from "../../components/entity/TeamItem";
import { productByIdsRowData, productsFromByIds } from "../../features/products/adapt";
import { rackHistoryFromList, rackHistoryRowData, rackStockFromList, rackStockRowData } from "../../features/racks/adapt";
import { useTeam } from "../../features/team/TeamContext";
import { CompactActions } from "../../components/chrome/CompactActions";
import { GrowingPager } from "../../components/chrome/GrowingPager";
import { EmptyHint } from "../../components/feedback/EmptyHint";
import { ListSkeleton } from "../../components/feedback/ListSkeleton";
import { ProductListItem } from "../../components/products/ProductListItem";
import { SummaryCard, SummaryStrip } from "../../features/orders/SummaryCard";
import { cameFrom } from "../../lib/cameFrom";
import { formatUnixDate } from "../../lib/datetime";
import { PLACEMENT_KINDS } from "../../features/inventory/movementKind";
import { MovementTable } from "../../features/inventory/MovementTable";
import { formatRupiah } from "../../lib/money";
import { useIsMobile } from "../../layouts/shell";
import { fetchActors } from "../../features/users/queries";
import { NotImplementedSummary } from "../../features/pending/NotImplementedSummary";
import { MoveGoodsDialog } from "./components/MoveGoodsDialog";
import { RecordSampleDialog } from "./components/RecordSampleDialog";
import { RACK_DETAIL_PENDING } from "./pending";

const PAGE_SIZE_OPTIONS = [10, 20, 50];

// A ROW LIGHTS UP UNDER THE POINTER, every cell of it (a-table-row-lights-up).
const LIGHTS_UP = { _hover: { "& > td": { bg: "bg.muted" } } } as const;

function parseRackId(raw: string | undefined): bigint {
  if (!raw) return 0n;

  try {
    const id = BigInt(raw);
    // Zero and negatives are as invalid as "abc": the proto demands uint64 > 0, so such an id can
    // only ever be refused. Fail it here rather than spend a round-trip proving it.
    return id > 0n ? id : 0n;
  } catch {
    return 0n;
  }
}

// RackDetailPage answers the questions someone standing at a shelf has (#138/#197): which rack is
// this, what is on it, what it is worth, and what has happened to it — a PAGE, not a dialog, because
// it is a record being read.
//
// THE LAYOUT IS THE OWNER'S (#197): the name and two header tiles across the top, then VERTICAL tabs
// down the left with their content beside them. Vertical rather than the horizontal tabs
// WarehouseProductPage uses, because five labels do not read well in a row and these are sections of
// one record rather than alternative views of one thing.
//
// The page exists because a warehouse holds OTHER TEAMS' goods: a selling team raises a restock for
// its own product and accepting it (#137) puts that product on this warehouse's shelf. So RackStock
// returns product ids this warehouse does not own, and it deliberately returns ONLY ids — resolving
// them is the caller's job, via ProductByIds and NOT ProductList, which serves the warehouse's own
// catalogue and would silently omit most of the shelf.
//
// ON THE SCREEN RULES (owner: *"sekarang inisiasi rack"*, the-racks-follow-the-screen-rules): back is its icon in the
// title's row and returns where the page was opened; the two acts carry their icons, and on a phone are their icons; the
// header figures are the card strip; a first load is a skeleton; an empty shelf or history is a hint; the pager grows;
// on a phone the tabs run across the top and each product is a block; the date speaks the app's language.
export function RackDetailPage() {
  const { t } = useTranslation();
  const { rackId: rackIdParam } = useParams();
  const navigate = useNavigate();
  const { current } = useTeam();
  // EVERY WAY OUT GOES WHERE THE PAGE WAS OPENED (a-form-returns-where-it-was-opened) — the list with its search; by a
  // link, the list.
  const backTo = cameFrom(useLocation()) ?? "/inventories/racks";

  const rackId = parseRackId(rackIdParam);
  const teamId = current?.teamId;

  const [rack, setRack] = useState<Rack | null>(null);
  const [summary, setSummary] = useState<RackSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [lines, setLines] = useState<RackStockLine[]>([]);
  // productId -> product, for the page's lines. ProductByIds answers unordered and may answer SHORT,
  // so the rows are matched out of this by id — never by position against `lines`.
  const [products, setProducts] = useState<Map<string, Product>>(new Map());
  const [stockLoading, setStockLoading] = useState(true);
  const [stockError, setStockError] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [totalItems, setTotalItems] = useState(0);

  // teamId -> team, for each row's Team column. The whole point of this page is that the shelf holds
  // other teams' goods, so "whose is this?" gets its own column — avatar, name and type, the way a team
  // is shown everywhere (TeamItem). Batched (TeamByIds), never per row.
  const [teams, setTeams] = useState<Map<string, Team>>(new Map());
  // The names alone, for the two dialogs, which show a team inside a product's line.
  const teamNames = useMemo(() => new Map([...teams].map(([id, team]) => [id, team.name])), [teams]);

  // The two writes off this rack (placement_decision.md): Move Goods, and Record Sample
  // (a-sample-is-recorded-on-rack-detail). The reads below are hand-rolled effects rather than query hooks, so a
  // write bumps `reloadKey` and every read on the page — header, contents, both histories — asks again.
  const [dialog, setDialog] = useState<"move" | "sample" | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const reload = () => setReloadKey((k) => k + 1);
  const isMobile = useIsMobile();

  // Read inside the effect WITHOUT making it a dependency: `teams` grows as pages resolve, so
  // depending on it would re-run the effect on its own result.
  const teamsRef = useRef(teams);
  teamsRef.current = teams;

  // Which rack is this, and the two header numbers. Kept apart from the contents below so that paging
  // the shelf does not re-ask for the header, and a rack that fails to load fails the whole page —
  // there is no useful "contents of a rack we cannot name".
  useEffect(() => {
    if (teamId === undefined || rackId === 0n) {
      setError(rackId === 0n ? t("racks.detail.invalidId") : "");
      setLoading(false);
      return;
    }

    let ignore = false;

    setLoading(true);
    setError("");

    rackClient
      .rackDetail({ teamId, rackId })
      .then((res) => {
        if (ignore) return;

        setRack(res.rack ?? null);
        setSummary(res.summary ?? null);
      })
      .catch((err) => {
        // Another warehouse's rack is NotFound, and so is a deleted one — rpcError says which.
        if (!ignore) {
          setError(rpcError(err));
          setRack(null);
          setSummary(null);
        }
      })
      .finally(() => {
        if (!ignore) setLoading(false);
      });

    return () => {
      ignore = true;
    };
  }, [teamId, rackId, t, reloadKey]);

  // What is on it, and what each thing IS. The two calls are deliberately SERIALISED into one effect
  // and committed together, rather than showing the lines and letting the names land after:
  // "Unknown product" is a claim — that the catalogue no longer lists it — and flashing it down the
  // column on every page load, while the lookup is merely in flight, would assert something false.
  // (A team NAME is decoration with an honest "Team #<id>" fallback, so that one resolves after.)
  useEffect(() => {
    if (teamId === undefined || rackId === 0n) {
      setStockLoading(false);
      return;
    }

    let ignore = false;

    setStockLoading(true);
    setStockError("");

    void (async () => {
      try {
        const res = await rackClient.rackStock({
          teamId,
          filter: { rackId },
          dataRequest: rackStockRowData(),
          page: { page, limit: pageSize },
        });
        if (ignore) return;

        const stockLines = rackStockFromList(res.items, res.ids);

        // Unique and non-zero: ProductByIds demands min_items:1, unique ids, each > 0 — so a
        // duplicate or an empty set must never become a call. The cap is 200 and a page is at most
        // 50, so a page's ids always fit in ONE call.
        const ids = [...new Set(stockLines.map((line) => line.productId).filter((id) => id > 0n))];

        const resolved = new Map<string, Product>();

        if (ids.length > 0) {
          try {
            // `teamId` here is the team the CALLER holds a role in — this warehouse — not the team
            // whose products come back. That is what lets it resolve a selling team's product.
            const productRes = await productClient.productByIds({
              teamId,
              filter: { ids },
              dataRequest: productByIdsRowData(),
            });
            if (ignore) return;

            for (const product of productsFromByIds(productRes)) {
              resolved.set(product.id.toString(), product);
            }
          } catch {
            // Swallowed on purpose: the goods are on the shelf whether or not the catalogue can be
            // read. Every row falls back to the unresolved label and KEEPS ITS COUNT, which is the
            // number someone at the rack came for.
          }
        }

        if (ignore) return;

        setLines(stockLines);
        setProducts(resolved);
        setTotalItems(Number(res.pageInfo?.totalItems ?? 0n));
      } catch (err) {
        if (!ignore) {
          setStockError(rpcError(err));
          setLines([]);
          setProducts(new Map());
          setTotalItems(0);
        }
      } finally {
        if (!ignore) setStockLoading(false);
      }
    })();

    return () => {
      ignore = true;
    };
  }, [teamId, rackId, page, pageSize, reloadKey]);

  // The owning team per row, resolved in ONE batch and cached for the page's life — paging back, or a
  // second page owned by the same teams, costs nothing. Deliberately does NOT gate `stockLoading`: rows
  // render with TeamItem's "Team #<id>" fallback and upgrade in place.
  useEffect(() => {
    if (products.size === 0) return;

    const missing = [
      ...new Set(
        [...products.values()]
          .map((product) => product.teamId)
          .filter((id) => id > 0n && !teamsRef.current.has(id.toString())),
      ),
    ];

    if (missing.length === 0) return;

    let ignore = false;

    void (async () => {
      try {
        const found = teamsByIds(await teamClient.teamByIds({ filter: { ids: missing }, dataRequest: teamByIdsRowData() }));
        if (ignore) return;

        setTeams((prev) => {
          const next = new Map(prev);
          for (const [id, team] of Object.entries(found)) {
            next.set(id, team);
          }

          return next;
        });
      } catch {
        // A name is decoration: TeamItem falls back to "Team #<id>".
      }
    })();

    return () => {
      ignore = true;
    };
  }, [products]);

  // No current team means there is no warehouse to read a rack against — the whole page is meaningless.
  if (!current) {
    return (
      <Stack gap="section">
        <Heading size="md">{t("racks.detail.title")}</Heading>
        <Text color="fg.muted" data-testid="rack-detail-no-team">
          {t("racks.selectTeam")}
        </Text>
      </Stack>
    );
  }

  // Back is its icon alone, in the title's row — to where the page was opened (the list with its search), else the list.
  const back = (
    <IconButton
      size="sm"
      variant="ghost"
      flexShrink={0}
      aria-label={t("racks.detail.back")}
      title={t("racks.detail.back")}
      data-testid="rack-detail-back"
      onClick={() => navigate(backTo)}
    >
      <Icon as={ArrowLeft} boxSize="4" />
    </IconButton>
  );

  // The first load shows the page's shape (motion-is-small-quick-and-shared).
  if (loading) {
    return <ListSkeleton heading rows={3} testId="rack-detail-loading" />;
  }

  if (error || !rack) {
    return (
      <Stack gap="section">
        <Box>{back}</Box>
        <Text color="error.fg" data-testid="rack-detail-error">
          {error || t("racks.detail.notFound")}
        </Text>
      </Stack>
    );
  }

  const shelfPager = (
    <GrowingPager
      page={page}
      onPageChange={setPage}
      hasNext={page * pageSize < totalItems}
      resetKey={String(pageSize)}
      pageSize={pageSize}
      pageSizeOptions={PAGE_SIZE_OPTIONS}
      onPageSizeChange={(n) => {
        setPageSize(n);
        setPage(1);
      }}
    />
  );

  // THE TWO ACTS OFF THIS RACK, each with its icon (an-action-button-carries-its-icon) — on a phone their icons alone, two
  // stay out of `⋯` (a-phone-header-action-is-an-icon).
  const actions = isMobile ? (
    <CompactActions
      menuLabel={t("racks.detail.actions")}
      actions={[
        {
          id: "sample",
          label: t("racks.sample.action"),
          icon: Gift,
          testId: "rack-action-sample",
          onClick: () => setDialog("sample"),
        },
        {
          id: "move",
          label: t("racks.move.action"),
          icon: ArrowRightLeft,
          primary: true,
          testId: "rack-action-move",
          onClick: () => setDialog("move"),
        },
      ]}
    />
  ) : (
    <HStack gap="2" flexShrink={0}>
      <Button variant="outline" data-testid="rack-action-sample" onClick={() => setDialog("sample")}>
        <Icon as={Gift} boxSize="4" />
        {t("racks.sample.action")}
      </Button>
      <Button colorPalette="brand" data-testid="rack-action-move" onClick={() => setDialog("move")}>
        <Icon as={ArrowRightLeft} boxSize="4" />
        {t("racks.move.action")}
      </Button>
    </HStack>
  );

  const counted = summary?.lastCountedAt ? Date.parse(summary.lastCountedAt) : NaN;
  const unknownCost = summary?.unknownCostProducts ?? 0;

  return (
    // The page arrives — a fade and a short rise (motion-is-small-quick-and-shared).
    <Stack gap="section" animationStyle="enter" data-testid="rack-detail-page">
      {/* THE TITLE'S ROW (the-phone-header-is-one-row) — back, the code painted on the shelf as the heading with its name
          small under it, and the two acts. */}
      <Flex align="center" gap={isMobile ? "2" : "card"}>
        {back}
        <Stack gap="0" flex="1" minW="0">
          {/* The CODE is how a person finds this rack in the building, so it is the heading. The name only qualifies
              it, and is legitimately empty. */}
          <Heading size="lg" truncate data-testid="rack-detail-code">
            {rack.code}
          </Heading>
          {rack.name && (
            <Text fontSize="sm" color="fg.muted" truncate data-testid="rack-detail-name">
              {rack.name}
            </Text>
          )}
        </Stack>
        {actions}
      </Flex>

      {/* The Move and Record Sample writes are a prototype; this strip names the parts whose rule is not settled. */}
      <NotImplementedSummary list={RACK_DETAIL_PENDING} />

      {/* THE HEADER FIGURES, the order list's card strip (a-list-summary-is-the-order-lists-card-strip) — what is on the
          shelf and what it is worth, then when it was last counted. */}
      <SummaryStrip testId="rack-summary">
        <SummaryCard
          emphasis
          label={t("racks.detail.countAndValue")}
          value={
            <Span data-testid="rack-summary-count">
              {t("racks.detail.unitsOnShelf", { count: Number(summary?.totalOnHand ?? 0n) })}
            </Span>
          }
          line={
            <>
              <Span data-testid="rack-summary-value">{formatRupiah(summary?.totalValue ?? 0n)}</Span>
              {/* ⚠ THE VALUE IS A FLOOR, AND THE SCREEN SAYS SO. A product with no recorded cost adds nothing to it,
                  so a shelf of never-restocked goods would otherwise read as a confident small number. */}
              {unknownCost > 0 && (
                <Span color="warning.fg" data-testid="rack-summary-unknown-cost">
                  {" · "}
                  {t("racks.detail.unknownCost", { count: unknownCost })}
                </Span>
              )}
            </>
          }
          testId="rack-summary-stock"
        />
        {/* "Never counted" is a real answer for a new shelf, and it must not render as a date. The date speaks the
            app's language (a-date-speaks-the-apps-language). */}
        <SummaryCard
          label={t("racks.detail.lastCounted")}
          value={
            <Span data-testid="rack-summary-last-counted">
              {Number.isNaN(counted)
                ? t("racks.detail.neverCounted")
                : formatUnixDate(BigInt(Math.floor(counted / 1000)))}
            </Span>
          }
          testId="rack-summary-counted"
        />
      </SummaryStrip>

      {/* VERTICAL tabs down the left, content beside them (#197) — across the top on a phone, scrolling in their own
          row rather than past the screen's edge (nothing-runs-past-a-phones-edge). */}
      <Tabs.Root
        defaultValue="products"
        orientation={isMobile ? "horizontal" : "vertical"}
        data-testid="rack-tabs"
      >
        <Tabs.List
          minW={isMobile ? undefined : "48"}
          flexShrink={0}
          flexWrap="nowrap"
          overflowX={isMobile ? "auto" : undefined}
          overflowY={isMobile ? "hidden" : undefined}
        >
          <Tabs.Trigger value="info" flexShrink={0} data-testid="rack-tab-info">
            {t("racks.detail.tab.info")}
          </Tabs.Trigger>
          <Tabs.Trigger value="products" flexShrink={0} data-testid="rack-tab-products">
            {t("racks.detail.tab.products")}
          </Tabs.Trigger>
          <Tabs.Trigger value="prices" flexShrink={0} data-testid="rack-tab-prices">
            {t("racks.detail.tab.prices")}
          </Tabs.Trigger>
          <Tabs.Trigger value="stockHistory" flexShrink={0} data-testid="rack-tab-stock-history">
            {t("racks.detail.tab.stockHistory")}
          </Tabs.Trigger>
          <Tabs.Trigger value="placementHistory" flexShrink={0} data-testid="rack-tab-placement-history">
            {t("racks.detail.tab.placementHistory")}
          </Tabs.Trigger>
        </Tabs.List>

        <Tabs.Content value="info" flex="1" minW="0" data-testid="rack-info-panel">
          <Stack gap="card">
            <Field label={t("racks.detail.code")} value={rack.code} testId="rack-info-code" />
            <Field
              label={t("racks.detail.name")}
              value={rack.name || t("racks.detail.noName")}
              testId="rack-info-name"
            />
            <Field
              label={t("racks.detail.description")}
              value={rack.description || t("racks.detail.noDescription")}
              testId="rack-info-description"
            />
          </Stack>
        </Tabs.Content>

        <Tabs.Content value="products" flex="1" minW="0" data-testid="rack-products-panel">
          <Stack gap="card">
            <RackStockTable
              lines={lines}
              products={products}
              teams={teams}
              loading={stockLoading}
              error={stockError}
              showMoney={false}
            />
            {shelfPager}
          </Stack>
        </Tabs.Content>

        {/* PRICES reads the SAME call the Products tab does — one query, two views, so the count and
            the money beside it can never come from two different reads of the shelf. */}
        <Tabs.Content value="prices" flex="1" minW="0" data-testid="rack-prices-panel">
          <Stack gap="card">
            <RackStockTable
              lines={lines}
              products={products}
              teams={teams}
              loading={stockLoading}
              error={stockError}
              showMoney
            />
            {shelfPager}
          </Stack>
        </Tabs.Content>

        <Tabs.Content value="stockHistory" flex="1" minW="0" data-testid="rack-stock-history-panel">
          <RackHistory teamId={teamId} rackId={rackId} reloadKey={reloadKey} testId="rack-stock-history" />
        </Tabs.Content>

        {/* PLACEMENT HISTORY is the same ledger narrowed to the movements that decided goods LIVE
            here — put-aways and moves, rather than every change to a count. */}
        <Tabs.Content value="placementHistory" flex="1" minW="0" data-testid="rack-placement-history-panel">
          <RackHistory
            teamId={teamId}
            rackId={rackId}
            kinds={PLACEMENT_KINDS}
            reloadKey={reloadKey}
            testId="rack-placement-history"
          />
        </Tabs.Content>
      </Tabs.Root>

      {teamId !== undefined && (
        <>
          <MoveGoodsDialog
            warehouseId={teamId}
            rack={rack}
            teamNames={teamNames}
            open={dialog === "move"}
            onOpenChange={(open) => setDialog(open ? "move" : null)}
            onMoved={reload}
          />
          <RecordSampleDialog
            warehouseId={teamId}
            rack={rack}
            teamNames={teamNames}
            open={dialog === "sample"}
            onOpenChange={(open) => setDialog(open ? "sample" : null)}
            onRecorded={reload}
          />
        </>
      )}
    </Stack>
  );
}

// A field of the Info tab — its label on the type scale's field label (13 bold, `fg.label`), its value under it.
function Field({ label, value, testId }: { label: string; value: string; testId: string }) {
  return (
    <Stack gap="0.5">
      <Text fontSize="0.8125rem" fontWeight="bold" color="fg.label">
        {label}
      </Text>
      <Text data-testid={testId}>{value}</Text>
    </Stack>
  );
}

interface RackStockTableProps {
  lines: RackStockLine[];
  products: Map<string, Product>;
  teams: Map<string, Team>;
  loading: boolean;
  error: string;
  // The Prices tab is this same table with the money columns shown. One component rather than two,
  // because the rows, the fallbacks and the "unknown product" rule are identical — and a second copy
  // is how two tabs start disagreeing about what is on the shelf.
  showMoney: boolean;
}

function RackStockTable({
  lines,
  products,
  teams,
  loading,
  error,
  showMoney,
}: RackStockTableProps) {
  const { t } = useTranslation();
  const isMobile = useIsMobile();

  if (error) {
    return (
      <Text color="error.fg" data-testid="rack-detail-stock-error">
        {error}
      </Text>
    );
  }

  if (loading) {
    return <ListSkeleton rows={3} testId={showMoney ? "rack-prices-loading" : "rack-stock-loading"} />;
  }

  // Distinct testid per tab: BOTH panels mount this table (Products and Prices are one component,
  // two views), so a shared one resolves to two elements and any assertion on it is ambiguous rather
  // than wrong — the worst kind of test failure to read.
  if (lines.length === 0) {
    // AN EMPTY SHELF SAYS SO, AND WHAT FILLS IT (an-empty-list-shows-a-hint).
    return (
      <EmptyHint
        size="sm"
        icon={PackageOpen}
        title={t("racks.detail.empty")}
        description={t("racks.detail.emptyHint")}
        testId={showMoney ? "rack-prices-empty" : "rack-detail-empty"}
      />
    );
  }

  // A product that did not resolve still gets a ROW and still shows its count: the box is physically on the shelf
  // whether or not the catalogue still lists it, and dropping or blanking it would hide stock someone can walk up and
  // touch. It is labelled as unknown rather than left to ProductListItem's neutral "Product #<id>" fallback. The
  // product is shown WITHOUT its team: the team has its own column (one context per column).
  const productOf = (line: RackStockLine) => {
    const product = products.get(line.productId.toString());
    return {
      product,
      item: product
        ? { ...product, teamId: undefined }
        : { id: line.productId, name: t("racks.detail.productUnknown", { id: line.productId.toString() }) },
    };
  };

  // WHOSE IT IS — the reason this page exists: a warehouse holds other teams' goods. Shown the way a team is shown
  // everywhere (TeamItem). A product the catalogue could not name has no known owner, and says so rather than guessing.
  const teamOf = (product: Product | undefined) =>
    product ? (
      <TeamItem
        team={{
          teamId: product.teamId,
          teamName: teams.get(product.teamId.toString())?.name,
          teamType: teams.get(product.teamId.toString())?.type,
          imageUrl: teams.get(product.teamId.toString())?.imageUrl,
        }}
      />
    ) : (
      <Text color="fg.muted">—</Text>
    );

  // ⚠ UNKNOWN IS NOT FREE. A dash-like word rather than "Rp 0", because a zero would say the goods cost nothing — and
  // the difference is the whole reason the server sends `cost_known` rather than letting a screen infer it.
  const money = (line: RackStockLine, v: bigint) => (line.costKnown ? formatRupiah(v) : t("racks.detail.costUnknown"));

  if (isMobile) {
    // A PHONE READS EACH PRODUCT AS A BLOCK (a-phone-reads-each-line-as-a-block) — the product at full width, whose it
    // is, then the count on this rack (and on Prices, its unit price × count = its value).
    return (
      <Stack gap="3" data-testid={showMoney ? "rack-detail-prices" : "rack-detail-stock"}>
        {lines.map((line) => {
          const { product, item } = productOf(line);

          return (
            <Stack
              key={line.productId.toString()}
              gap="2"
              borderWidth="1px"
              borderRadius="md"
              p="3"
              data-testid={`rack-stock-row-${line.productId}`}
            >
              <ProductListItem product={item} />
              <Flex align="center" gap="2" justify="space-between">
                <Box data-testid={`rack-stock-team-${line.productId}`} minW="0">
                  {teamOf(product)}
                </Box>
                <Text fontSize="sm" flexShrink={0}>
                  {t("racks.detail.onThisRack")}{" "}
                  <Span fontWeight="bold" data-testid={`rack-stock-onhand-${line.productId}`}>
                    {line.onHand.toString()}
                  </Span>
                </Text>
              </Flex>
              {showMoney && (
                <Text fontSize="sm" color="fg.muted">
                  <Span data-testid={`rack-unit-cost-${line.productId}`}>{money(line, line.unitCost)}</Span>
                  {` × ${line.onHand.toString()} … `}
                  <Span fontWeight="bold" color="fg" data-testid={`rack-line-value-${line.productId}`}>
                    {money(line, line.value)}
                  </Span>
                </Text>
              )}
            </Stack>
          );
        })}
      </Stack>
    );
  }

  return (
    // The table scrolls inside its own box, never the page.
    <Box overflowX="auto" w="full" maxW="full" minW="0">
      <Table.Root size="sm" data-testid={showMoney ? "rack-detail-prices" : "rack-detail-stock"}>
        <Table.Header>
          <Table.Row>
            <Table.ColumnHeader>{t("racks.detail.product")}</Table.ColumnHeader>
            <Table.ColumnHeader>{t("racks.detail.team")}</Table.ColumnHeader>
            {/* NOT "On hand" — the app already uses that for the warehouse-wide number
                (inventory.table.onHand), and this is one shelf's share of it. */}
            <Table.ColumnHeader textAlign="end">{t("racks.detail.onThisRack")}</Table.ColumnHeader>
            {showMoney && (
              <>
                <Table.ColumnHeader textAlign="end">{t("racks.detail.unitCost")}</Table.ColumnHeader>
                <Table.ColumnHeader textAlign="end">{t("racks.detail.lineValue")}</Table.ColumnHeader>
              </>
            )}
          </Table.Row>
        </Table.Header>

        <Table.Body>
          {lines.map((line) => {
            const { product, item } = productOf(line);

            return (
              // A row lights up under the pointer, every cell (a-table-row-lights-up).
              <Table.Row key={line.productId.toString()} css={LIGHTS_UP} data-testid={`rack-stock-row-${line.productId}`}>
                <Table.Cell>
                  <ProductListItem product={item} />
                </Table.Cell>
                <Table.Cell data-testid={`rack-stock-team-${line.productId}`}>{teamOf(product)}</Table.Cell>
                {/* Deliberately its own column rather than ProductListItem's `stock` badge: that badge means READY
                    STOCK across the warehouse, and this is the count on THIS rack. */}
                <Table.Cell textAlign="end" fontWeight="bold" data-testid={`rack-stock-onhand-${line.productId}`}>
                  {line.onHand.toString()}
                </Table.Cell>
                {showMoney && (
                  <>
                    <Table.Cell textAlign="end" data-testid={`rack-unit-cost-${line.productId}`}>
                      {money(line, line.unitCost)}
                    </Table.Cell>
                    <Table.Cell textAlign="end" fontWeight="bold" data-testid={`rack-line-value-${line.productId}`}>
                      {money(line, line.value)}
                    </Table.Cell>
                  </>
                )}
              </Table.Row>
            );
          })}
        </Table.Body>
      </Table.Root>
    </Box>
  );
}

interface RackHistoryProps {
  teamId: bigint | undefined;
  rackId: bigint;
  // Omitted = every kind. The two history tabs are the same ledger asked two different questions.
  kinds?: number[];
  // Bumped by a write on this page (a move, a sample), so the history asks again.
  reloadKey: number;
  testId: string;
}

// The names of a page of history rows' products. Never throws: a product the catalogue cannot name keeps its row, as
// "#id" — the same fallback the shelf's own table uses.
async function productNamesFor(teamId: bigint, ids: bigint[]): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  const wanted = [...new Set(ids.filter((id) => id > 0n))];
  if (wanted.length === 0) return names;

  try {
    const res = await productClient.productByIds({
      teamId,
      filter: { ids: wanted },
      dataRequest: productByIdsRowData(),
    });
    for (const product of productsFromByIds(res)) {
      names.set(product.id.toString(), product.name);
    }
  } catch {
    // Deliberately empty — see above.
  }

  return names;
}

// RackHistory is what has happened to THIS SHELF (#197) — a read `StockHistory` cannot serve, since
// it demands a product id and answers "what happened to this product".
function RackHistory({ teamId, rackId, kinds, reloadKey, testId }: RackHistoryProps) {
  const { t } = useTranslation();

  const [movements, setMovements] = useState<StockMovement[]>([]);
  // userId → name, and productId → name, for the page of rows: WHO did it (any-warehouse-member-may-move-goods — every
  // row names its person) and to WHAT. One batch each, committed with the rows; a failed lookup falls back to "#id".
  const [actorNames, setActorNames] = useState<Map<string, string>>(new Map());
  const [productNames, setProductNames] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [totalItems, setTotalItems] = useState(0);

  // The kinds array is a new literal on every render, so it is joined to a stable string for the
  // dependency list — depending on the array itself would refetch this tab forever.
  const kindKey = (kinds ?? []).join(",");

  useEffect(() => {
    if (teamId === undefined || rackId === 0n) {
      setLoading(false);
      return;
    }

    let ignore = false;

    setLoading(true);
    setError("");

    rackClient
      .rackHistory({
        teamId,
        filter: {
          rackId,
          kinds: kindKey === "" ? [] : kindKey.split(",").map(Number),
        },
        dataRequest: rackHistoryRowData(),
        page: { page, limit: pageSize },
      })
      .then(async (res) => {
        if (ignore) return;

        const rows = rackHistoryFromList(res.items, res.ids);
        const [actors, names] = await Promise.all([
          fetchActors(rows.map((m) => m.actorUserId)),
          productNamesFor(teamId, rows.map((m) => m.productId)),
        ]);
        if (ignore) return;

        const people = new Map<string, string>();
        for (const [id, user] of actors) {
          people.set(id, user.name || user.username);
        }

        setMovements(rows);
        setActorNames(people);
        setProductNames(names);
        setTotalItems(Number(res.pageInfo?.totalItems ?? 0n));
      })
      .catch((err) => {
        if (!ignore) {
          setError(rpcError(err));
          setMovements([]);
          setTotalItems(0);
        }
      })
      .finally(() => {
        if (!ignore) setLoading(false);
      });

    return () => {
      ignore = true;
    };
  }, [teamId, rackId, page, pageSize, kindKey, reloadKey]);

  if (error) {
    return (
      <Text color="error.fg" data-testid={`${testId}-error`}>
        {error}
      </Text>
    );
  }

  if (loading) {
    return <ListSkeleton rows={3} testId={`${testId}-loading`} />;
  }

  return (
    <Stack gap="card">
      {/* The shared ledger (features/inventory/MovementTable): this shelf's history names the PRODUCT
          that moved, since the rack is already the thing you are looking at. "On shelf after" stays
          this page's wording — it is one shelf's count, not the warehouse's (#135). */}
      <MovementTable
        movements={movements}
        testId={testId}
        columns={["product", "by"]}
        actorNames={actorNames}
        productLabel={(id) => productNames.get(id.toString()) ?? `#${id}`}
        afterLabel={t("racks.detail.after")}
        emptyText={t("racks.detail.noHistory")}
        // THE REWORKED LEDGER (an-empty-list-shows-a-hint, a-table-row-lights-up, a-phone-reads-each-line-as-a-block):
        // an empty history is a hint, the rows light up, and a phone reads each movement as two lines.
        emptyIcon={History}
        emptyDescription={t("racks.detail.noHistoryHint")}
      />

      <GrowingPager
        page={page}
        onPageChange={setPage}
        hasNext={page * pageSize < totalItems}
        resetKey={[kindKey, pageSize].join("|")}
        pageSize={pageSize}
        pageSizeOptions={PAGE_SIZE_OPTIONS}
        onPageSizeChange={(n) => {
          setPageSize(n);
          setPage(1);
        }}
      />
    </Stack>
  );
}

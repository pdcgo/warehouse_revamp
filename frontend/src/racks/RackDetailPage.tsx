import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router-dom";
import {
  Button,
  Card,
  Heading,
  Icon,
  SimpleGrid,
  Spinner,
  Stack,
  Table,
  Tabs,
  Text,
} from "@chakra-ui/react";
import { ArrowLeft } from "lucide-react";
import { productClient, rackClient, rpcError, teamClient } from "../api/clients";
import type { StockMovement } from "../gen/warehouse/inventory/v1/inventory_pb";
import type { Rack, RackStockLine, RackSummary } from "../gen/warehouse/inventory/v1/rack_pb";
import type { Product } from "../gen/warehouse/product/v1/product_pb";
import { useTeam } from "../team/TeamContext";
import { Pagination } from "../components/Pagination";
import { ProductListItem } from "../components/ProductListItem";
import { PLACEMENT_KINDS, kindLabel } from "../inventory/movementKind";
import { formatRupiah } from "../lib/money";

const PAGE_SIZE_OPTIONS = [10, 20, 50];

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
export function RackDetailPage() {
  const { t } = useTranslation();
  const { rackId: rackIdParam } = useParams();
  const navigate = useNavigate();
  const { current } = useTeam();

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

  // teamId -> name, for each row's team badge. The whole point of this page is that the shelf holds
  // other teams' goods, so "whose is this?" is worth a name rather than an id. Batched (TeamByIds),
  // never per row.
  const [teamNames, setTeamNames] = useState<Map<string, string>>(new Map());

  // Read inside the effect WITHOUT making it a dependency: `teamNames` grows as pages resolve, so
  // depending on it would re-run the effect on its own result.
  const teamNamesRef = useRef(teamNames);
  teamNamesRef.current = teamNames;

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
  }, [teamId, rackId, t]);

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
        const res = await rackClient.rackStock({ teamId, rackId, page: { page, limit: pageSize } });
        if (ignore) return;

        // Unique and non-zero: ProductByIds demands min_items:1, unique ids, each > 0 — so a
        // duplicate or an empty set must never become a call. The cap is 200 and a page is at most
        // 50, so a page's ids always fit in ONE call.
        const ids = [...new Set(res.lines.map((line) => line.productId).filter((id) => id > 0n))];

        const resolved = new Map<string, Product>();

        if (ids.length > 0) {
          try {
            // `teamId` here is the team the CALLER holds a role in — this warehouse — not the team
            // whose products come back. That is what lets it resolve a selling team's product.
            const productRes = await productClient.productByIds({ teamId, productIds: ids });
            if (ignore) return;

            for (const product of productRes.products) {
              resolved.set(product.id.toString(), product);
            }
          } catch {
            // Swallowed on purpose: the goods are on the shelf whether or not the catalogue can be
            // read. Every row falls back to the unresolved label and KEEPS ITS COUNT, which is the
            // number someone at the rack came for.
          }
        }

        if (ignore) return;

        setLines(res.lines);
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
  }, [teamId, rackId, page, pageSize]);

  // The owning team's name per row, resolved in ONE batch and cached for the page's life — paging
  // back, or a second page owned by the same teams, costs nothing. Deliberately does NOT gate
  // `stockLoading`: rows render with ProductListItem's "Team #<id>" fallback and upgrade in place.
  useEffect(() => {
    if (products.size === 0) return;

    const missing = [
      ...new Set(
        [...products.values()]
          .map((product) => product.teamId)
          .filter((id) => id > 0n && !teamNamesRef.current.has(id.toString())),
      ),
    ];

    if (missing.length === 0) return;

    let ignore = false;

    void (async () => {
      try {
        const res = await teamClient.teamByIds({ ids: missing });
        if (ignore) return;

        setTeamNames((prev) => {
          const next = new Map(prev);
          for (const [id, team] of Object.entries(res.data)) {
            next.set(id, team.name);
          }

          return next;
        });
      } catch {
        // A name is decoration: ProductListItem falls back to "Team #<id>".
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

  if (loading) {
    return <Spinner colorPalette="brand" />;
  }

  if (error || !rack) {
    return (
      <Stack gap="section">
        <Button
          size="xs"
          variant="ghost"
          alignSelf="flex-start"
          data-testid="rack-detail-back"
          onClick={() => navigate("/inventories/racks")}
        >
          <Icon as={ArrowLeft} boxSize="4" />
          {t("racks.detail.back")}
        </Button>
        <Text color="red.fg" data-testid="rack-detail-error">
          {error || t("racks.detail.notFound")}
        </Text>
      </Stack>
    );
  }

  const productsTable = (
    <RackStockTable
      lines={lines}
      products={products}
      teamNames={teamNames}
      loading={stockLoading}
      error={stockError}
      showMoney={false}
    />
  );

  return (
    <Stack gap="section" data-testid="rack-detail-page">
      <Button
        size="xs"
        variant="ghost"
        alignSelf="flex-start"
        data-testid="rack-detail-back"
        onClick={() => navigate("/inventories/racks")}
      >
        <Icon as={ArrowLeft} boxSize="4" />
        {t("racks.detail.back")}
      </Button>

      {/* THE HEADER (#197): the shelf's label, then the two numbers somebody wants at a glance. */}
      <SimpleGrid columns={{ base: 1, md: 3 }} gap="card" alignItems="stretch">
        <Stack gap="1" justify="center">
          {/* The CODE is what is painted on the shelf — it is how a person finds this rack in the
              building, so it is the heading. The name only qualifies it, and is legitimately empty. */}
          <Heading size="lg" data-testid="rack-detail-code">
            {rack.code}
          </Heading>
          {rack.name && (
            <Text fontSize="sm" fontWeight="medium" data-testid="rack-detail-name">
              {rack.name}
            </Text>
          )}
        </Stack>

        <Card.Root>
          <Card.Body>
            <Stack gap="0">
              <Text fontSize="xs" color="fg.muted">
                {t("racks.detail.countAndValue")}
              </Text>
              <Text fontWeight="medium" data-testid="rack-summary-count">
                {t("racks.detail.unitsOnShelf", {
                  count: Number(summary?.totalOnHand ?? 0n),
                })}
              </Text>
              <Text fontSize="sm" data-testid="rack-summary-value">
                {formatRupiah(summary?.totalValue ?? 0n)}
              </Text>

              {/* ⚠ THE VALUE IS A FLOOR, AND THE SCREEN SAYS SO. A product with no recorded cost adds
                  nothing to it, so a shelf of never-restocked goods would otherwise read as a
                  confident small number. */}
              {(summary?.unknownCostProducts ?? 0) > 0 && (
                <Text fontSize="xs" color="orange.fg" data-testid="rack-summary-unknown-cost">
                  {t("racks.detail.unknownCost", { count: summary?.unknownCostProducts ?? 0 })}
                </Text>
              )}
            </Stack>
          </Card.Body>
        </Card.Root>

        <Card.Root>
          <Card.Body>
            <Stack gap="0">
              <Text fontSize="xs" color="fg.muted">
                {t("racks.detail.lastCounted")}
              </Text>
              {/* "Never counted" is a real answer for a new shelf, and it must not render as a date. */}
              <Text fontWeight="medium" data-testid="rack-summary-last-counted">
                {summary?.lastCountedAt
                  ? new Date(summary.lastCountedAt).toLocaleDateString()
                  : t("racks.detail.neverCounted")}
              </Text>
            </Stack>
          </Card.Body>
        </Card.Root>
      </SimpleGrid>

      {/* VERTICAL tabs down the left, content beside them (#197). */}
      <Tabs.Root defaultValue="products" orientation="vertical" data-testid="rack-tabs">
        <Tabs.List minW="48">
          <Tabs.Trigger value="info" data-testid="rack-tab-info">
            {t("racks.detail.tab.info")}
          </Tabs.Trigger>
          <Tabs.Trigger value="products" data-testid="rack-tab-products">
            {t("racks.detail.tab.products")}
          </Tabs.Trigger>
          <Tabs.Trigger value="prices" data-testid="rack-tab-prices">
            {t("racks.detail.tab.prices")}
          </Tabs.Trigger>
          <Tabs.Trigger value="stockHistory" data-testid="rack-tab-stock-history">
            {t("racks.detail.tab.stockHistory")}
          </Tabs.Trigger>
          <Tabs.Trigger value="placementHistory" data-testid="rack-tab-placement-history">
            {t("racks.detail.tab.placementHistory")}
          </Tabs.Trigger>
        </Tabs.List>

        <Tabs.Content value="info" flex="1" data-testid="rack-info-panel">
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

        <Tabs.Content value="products" flex="1" data-testid="rack-products-panel">
          <Stack gap="card">
            {productsTable}
            <Pagination
              count={totalItems}
              pageSize={pageSize}
              page={page}
              onPageChange={setPage}
              pageSizeOptions={PAGE_SIZE_OPTIONS}
              onPageSizeChange={(n) => {
                setPageSize(n);
                setPage(1);
              }}
            />
          </Stack>
        </Tabs.Content>

        {/* PRICES reads the SAME call the Products tab does — one query, two views, so the count and
            the money beside it can never come from two different reads of the shelf. */}
        <Tabs.Content value="prices" flex="1" data-testid="rack-prices-panel">
          <Stack gap="card">
            <RackStockTable
              lines={lines}
              products={products}
              teamNames={teamNames}
              loading={stockLoading}
              error={stockError}
              showMoney
            />
            <Pagination
              count={totalItems}
              pageSize={pageSize}
              page={page}
              onPageChange={setPage}
              pageSizeOptions={PAGE_SIZE_OPTIONS}
              onPageSizeChange={(n) => {
                setPageSize(n);
                setPage(1);
              }}
            />
          </Stack>
        </Tabs.Content>

        <Tabs.Content value="stockHistory" flex="1" data-testid="rack-stock-history-panel">
          <RackHistory teamId={teamId} rackId={rackId} testId="rack-stock-history" />
        </Tabs.Content>

        {/* PLACEMENT HISTORY is the same ledger narrowed to the movements that decided goods LIVE
            here — put-aways and moves, rather than every change to a count. */}
        <Tabs.Content value="placementHistory" flex="1" data-testid="rack-placement-history-panel">
          <RackHistory
            teamId={teamId}
            rackId={rackId}
            kinds={PLACEMENT_KINDS}
            testId="rack-placement-history"
          />
        </Tabs.Content>
      </Tabs.Root>
    </Stack>
  );
}

function Field({ label, value, testId }: { label: string; value: string; testId: string }) {
  return (
    <Stack gap="0">
      <Text fontSize="xs" color="fg.muted">
        {label}
      </Text>
      <Text data-testid={testId}>{value}</Text>
    </Stack>
  );
}

interface RackStockTableProps {
  lines: RackStockLine[];
  products: Map<string, Product>;
  teamNames: Map<string, string>;
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
  teamNames,
  loading,
  error,
  showMoney,
}: RackStockTableProps) {
  const { t } = useTranslation();

  if (error) {
    return (
      <Text color="red.fg" data-testid="rack-detail-stock-error">
        {error}
      </Text>
    );
  }

  if (loading) {
    return <Spinner colorPalette="brand" />;
  }

  // Distinct testid per tab: BOTH panels mount this table (Products and Prices are one component,
  // two views), so a shared one resolves to two elements and any assertion on it is ambiguous rather
  // than wrong — the worst kind of test failure to read.
  if (lines.length === 0) {
    return (
      <Text color="fg.muted" data-testid={showMoney ? "rack-prices-empty" : "rack-detail-empty"}>
        {t("racks.detail.empty")}
      </Text>
    );
  }

  return (
    <Table.Root size="sm" data-testid={showMoney ? "rack-detail-prices" : "rack-detail-stock"}>
      <Table.Header>
        <Table.Row>
          <Table.ColumnHeader>{t("racks.detail.product")}</Table.ColumnHeader>
          {/* NOT "On hand" — the app already uses that for the warehouse-wide number
              (inventory.table.onHand), and this is one shelf's share of it. Naming both the same is
              how someone reads a rack's count as the warehouse's. */}
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
          const product = products.get(line.productId.toString());

          return (
            <Table.Row
              key={line.productId.toString()}
              data-testid={`rack-stock-row-${line.productId}`}
            >
              <Table.Cell>
                {/* A product that did not resolve still gets a ROW and still shows its count: the box
                    is physically on the shelf whether or not the catalogue still lists it, and
                    dropping or blanking it would hide stock someone can walk up and touch. It is
                    labelled as unknown rather than left to ProductListItem's neutral "Product #<id>"
                    fallback, which reads as a product that merely has no name. */}
                <ProductListItem
                  product={
                    product ?? {
                      id: line.productId,
                      name: t("racks.detail.productUnknown", { id: line.productId.toString() }),
                    }
                  }
                  teamName={product ? teamNames.get(product.teamId.toString()) : undefined}
                />
              </Table.Cell>

              {/* Deliberately its own column rather than ProductListItem's `stock` badge: that badge
                  means READY STOCK across the warehouse, and this is the count on THIS rack. */}
              <Table.Cell
                textAlign="end"
                fontWeight="medium"
                data-testid={`rack-stock-onhand-${line.productId}`}
              >
                {line.onHand.toString()}
              </Table.Cell>

              {showMoney && (
                <>
                  {/* ⚠ UNKNOWN IS NOT FREE. A dash rather than "Rp 0", because a zero here would say
                      the goods cost nothing — and the difference is the whole reason the server sends
                      `cost_known` rather than letting a screen infer it. */}
                  <Table.Cell textAlign="end" data-testid={`rack-unit-cost-${line.productId}`}>
                    {line.costKnown ? formatRupiah(line.unitCost) : t("racks.detail.costUnknown")}
                  </Table.Cell>
                  <Table.Cell
                    textAlign="end"
                    fontWeight="medium"
                    data-testid={`rack-line-value-${line.productId}`}
                  >
                    {line.costKnown ? formatRupiah(line.value) : t("racks.detail.costUnknown")}
                  </Table.Cell>
                </>
              )}
            </Table.Row>
          );
        })}
      </Table.Body>
    </Table.Root>
  );
}

interface RackHistoryProps {
  teamId: bigint | undefined;
  rackId: bigint;
  // Omitted = every kind. The two history tabs are the same ledger asked two different questions.
  kinds?: number[];
  testId: string;
}

// RackHistory is what has happened to THIS SHELF (#197) — a read `StockHistory` cannot serve, since
// it demands a product id and answers "what happened to this product".
function RackHistory({ teamId, rackId, kinds, testId }: RackHistoryProps) {
  const { t } = useTranslation();

  const [movements, setMovements] = useState<StockMovement[]>([]);
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
        rackId,
        page: { page, limit: pageSize },
        kinds: kindKey === "" ? [] : kindKey.split(",").map(Number),
      })
      .then((res) => {
        if (ignore) return;

        setMovements(res.movements);
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
  }, [teamId, rackId, page, pageSize, kindKey]);

  if (error) {
    return (
      <Text color="red.fg" data-testid={`${testId}-error`}>
        {error}
      </Text>
    );
  }

  if (loading) {
    return <Spinner colorPalette="brand" />;
  }

  if (movements.length === 0) {
    return (
      <Text color="fg.muted" data-testid={`${testId}-empty`}>
        {t("racks.detail.noHistory")}
      </Text>
    );
  }

  return (
    <Stack gap="card">
      <Table.Root size="sm" data-testid={`${testId}-table`}>
        <Table.Header>
          <Table.Row>
            <Table.ColumnHeader>{t("racks.detail.when")}</Table.ColumnHeader>
            <Table.ColumnHeader>{t("racks.detail.what")}</Table.ColumnHeader>
            <Table.ColumnHeader>{t("racks.detail.product")}</Table.ColumnHeader>
            <Table.ColumnHeader textAlign="end">{t("racks.detail.change")}</Table.ColumnHeader>
            <Table.ColumnHeader textAlign="end">{t("racks.detail.after")}</Table.ColumnHeader>
          </Table.Row>
        </Table.Header>

        <Table.Body>
          {movements.map((m) => (
            <Table.Row key={m.id.toString()} data-testid={`${testId}-row-${m.id}`}>
              <Table.Cell>{new Date(m.createdAt).toLocaleDateString()}</Table.Cell>
              <Table.Cell>{kindLabel(t, m.kind)}</Table.Cell>
              <Table.Cell>#{m.productId.toString()}</Table.Cell>
              {/* A ledger line IS a movement, so a sign is the honest rendering here — it says which
                  way the count went, which is what the row is about. */}
              <Table.Cell textAlign="end">
                {m.delta > 0n ? "+" : ""}
                {m.delta.toString()}
              </Table.Cell>
              <Table.Cell textAlign="end">{m.balance.toString()}</Table.Cell>
            </Table.Row>
          ))}
        </Table.Body>
      </Table.Root>

      <Pagination
        count={totalItems}
        pageSize={pageSize}
        page={page}
        onPageChange={setPage}
        pageSizeOptions={PAGE_SIZE_OPTIONS}
        onPageSizeChange={(n) => {
          setPageSize(n);
          setPage(1);
        }}
      />
    </Stack>
  );
}

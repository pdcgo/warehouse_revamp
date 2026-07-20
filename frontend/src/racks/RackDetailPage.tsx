import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router-dom";
import { Button, Card, Heading, Icon, Spinner, Stack, Table, Text } from "@chakra-ui/react";
import { ArrowLeft } from "lucide-react";
import { productClient, rackClient, rpcError, teamClient } from "../api/clients";
import type { Rack, RackStockLine } from "../gen/warehouse/inventory/v1/rack_pb";
import type { Product } from "../gen/warehouse/product/v1/product_pb";
import { useTeam } from "../team/TeamContext";
import { Pagination } from "../components/Pagination";
import { ProductListItem } from "../components/ProductListItem";

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

// RackDetailPage answers the two questions someone standing at a shelf actually has (#138): which
// rack is this, and what is on it — a PAGE, not a dialog, because it is a record being read.
//
// The page exists because a warehouse holds OTHER TEAMS' goods: a selling team raises a restock for
// its own product and accepting it (#137) puts that product on this warehouse's shelf. So RackStock
// returns product ids this warehouse does not own, and it deliberately returns ONLY ids — resolving
// them is the caller's job. That is why the products come from ProductByIds and NOT from ProductList:
// ProductList serves the warehouse's own catalogue, so a page built on it would silently omit every
// product belonging to a selling team, which is most of the shelf.
export function RackDetailPage() {
  const { t } = useTranslation();
  const { rackId: rackIdParam } = useParams();
  const navigate = useNavigate();
  const { current } = useTeam();

  const rackId = parseRackId(rackIdParam);
  const teamId = current?.teamId;

  const [rack, setRack] = useState<Rack | null>(null);
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

  // Which rack is this. Kept apart from the contents below so that paging the shelf does not re-ask
  // for the header, and a rack that fails to load fails the whole page (see the error return) —
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
        if (!ignore) setRack(res.rack ?? null);
      })
      .catch((err) => {
        // Another warehouse's rack is NotFound, and so is a deleted one — rpcError says which.
        if (!ignore) {
          setError(rpcError(err));
          setRack(null);
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

      {/* The CODE is what is painted on the shelf — it is how a person finds this rack in the
          building, so it is the heading. The name and description only qualify it, and both are
          legitimately empty. */}
      <Stack gap="1">
        <Heading size="lg" data-testid="rack-detail-code">
          {rack.code}
        </Heading>
        {rack.name && (
          <Text fontSize="sm" fontWeight="medium" data-testid="rack-detail-name">
            {rack.name}
          </Text>
        )}
        {rack.description && (
          <Text fontSize="sm" color="fg.muted" data-testid="rack-detail-description">
            {rack.description}
          </Text>
        )}
      </Stack>

      <Card.Root>
        <Card.Body>
          <Stack gap="card">
            <Text fontSize="sm" fontWeight="medium" color="fg.muted">
              {t("racks.detail.contents")}
            </Text>

            {stockError && (
              <Text color="red.fg" data-testid="rack-detail-stock-error">
                {stockError}
              </Text>
            )}

            {stockLoading ? (
              <Spinner colorPalette="brand" />
            ) : (
              <Table.Root size="sm" data-testid="rack-detail-stock">
                <Table.Header>
                  <Table.Row>
                    <Table.ColumnHeader>{t("racks.detail.product")}</Table.ColumnHeader>
                    {/* NOT "On hand" — the app already uses that for the warehouse-wide number
                        (inventory.table.onHand), and this is one shelf's share of it. Naming both
                        the same is how someone reads a rack's count as the warehouse's. */}
                    <Table.ColumnHeader textAlign="end">
                      {t("racks.detail.onThisRack")}
                    </Table.ColumnHeader>
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
                          {/* A product that did not resolve still gets a ROW and still shows its
                              count: the box is physically on the shelf whether or not the catalogue
                              still lists it, and dropping or blanking it would hide stock someone
                              can walk up and touch. It is labelled as unknown rather than left to
                              ProductListItem's neutral "Product #<id>" fallback, which reads as a
                              product that merely has no name. */}
                          <ProductListItem
                            product={
                              product ?? {
                                id: line.productId,
                                name: t("racks.detail.productUnknown", {
                                  id: line.productId.toString(),
                                }),
                              }
                            }
                            teamName={
                              product ? teamNames.get(product.teamId.toString()) : undefined
                            }
                          />
                        </Table.Cell>

                        {/* Deliberately its own column rather than ProductListItem's `stock` badge:
                            that badge means READY STOCK across the warehouse, and this is the count
                            on THIS rack. Same-looking badge, different number — so it gets a column
                            with a heading that says which one it is. */}
                        <Table.Cell
                          textAlign="end"
                          fontWeight="medium"
                          data-testid={`rack-stock-onhand-${line.productId}`}
                        >
                          {line.onHand.toString()}
                        </Table.Cell>
                      </Table.Row>
                    );
                  })}
                </Table.Body>
              </Table.Root>
            )}

            {!stockLoading && lines.length === 0 && !stockError && (
              <Text color="fg.muted" data-testid="rack-detail-empty">
                {t("racks.detail.empty")}
              </Text>
            )}

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
        </Card.Body>
      </Card.Root>
    </Stack>
  );
}

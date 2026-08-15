import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
import {
  Badge,
  Button,
  Card,
  Flex,
  Heading,
  Icon,
  Input,
  SimpleGrid,
  Spacer,
  Spinner,
  Stack,
  Table,
  Text,
  Textarea,
  VStack,
} from "@chakra-ui/react";
import { ClipboardCheck, TriangleAlert } from "lucide-react";

import { rpcError } from "../../api/clients";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { RackSelect, UNPLACED } from "../../components/RackSelect";
import { RefreshOverlay } from "../../components/RefreshOverlay";
import { toaster } from "../../components/Toaster";
import type { StockOpnameLine, StockOpnameResponse } from "../../gen/warehouse/inventory/v1/inventory_pb";
import { formatRupiah } from "../../lib/money";
import { useTeam } from "../../features/team/TeamContext";
import { usePostOpname, useShelfContents } from "./queries";
import type { CountRow } from "./queries";

// What the person typed, keyed by product id. `""` means NOT COUNTED — and that is the whole reason
// this is a string map rather than a number map.
//
// ⚠ NOT COUNTED IS NOT ZERO, and the distinction survives all the way to the wire. A blank box sends
// no line at all and the server leaves that product completely alone; a typed `0` sends a line saying
// the shelf is empty of it. Storing counts as numbers would need a sentinel for "blank", and the
// sentinel everybody reaches for is 0 — which is the one value that already means something else.
type Counts = Record<string, string>;

// OpnamePage — a STOCK OPNAME: stand at a shelf, count what is on it, correct the lot in one act.
//
// `StockAdjust` with reason RECOUNT has been able to correct one product on one shelf for a while.
// That is the posting, not the job: nobody walks to A-01-3 to count one product. The useful fact at
// the end is "A-01-3 was counted, and here is what was wrong", which needs the whole shelf in front of
// you and one button at the bottom.
//
// THE COUNT IS NOT BLIND. The expected figure is on screen beside the box. Blind counting is an
// audit-integrity practice for adversarial settings — it stops a counter writing down what the system
// already says — and this is a small crew working in pairs, where the far more common failure is
// standing at the wrong shelf. Showing the expected number is what makes that obvious in one glance.
// It is a trade, and it is worth naming: it does bias the count toward agreement.
export function OpnamePage() {
  const { current } = useTeam();
  const { t } = useTranslation();

  // THE SHELF LIVES IN THE URL, so `/inventories/opname?rack=163` opens straight onto that count.
  //
  // Not a nicety: the person doing this is standing in front of a shelf with a phone, and the shelf has
  // a label on it. A scannable link that lands on the right count removes the one step where somebody
  // picks the wrong rack from a dropdown — which is the error this whole screen is most afraid of. It
  // also makes a half-finished count survivable: reloading returns to the same shelf.
  //
  // ⚠ THE TYPED COUNTS ARE NOT IN THE URL, deliberately. They are an observation somebody is part-way
  // through making, not a view — putting them in a link would invite one person's half-count to be
  // opened, and posted, by another.
  const [params, setParams] = useSearchParams();
  const rackId = params.get("rack") ?? "";

  const [counts, setCounts] = useState<Counts>({});
  const [note, setNote] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState<StockOpnameResponse | null>(null);

  const teamId = current?.teamId;

  const shelf = useShelfContents({ warehouseId: teamId, rackId });
  const post = usePostOpname();

  const rows = shelf.data?.rows ?? [];

  // Only the boxes somebody actually filled in. This is the line between "counted" and "not counted",
  // and it is deliberately computed in one place rather than checked at each use site.
  const counted = useMemo(
    () =>
      rows
        .map((row) => ({ row, raw: (counts[row.productId.toString()] ?? "").trim() }))
        .filter(({ raw }) => raw !== "" && Number.isInteger(Number(raw)) && Number(raw) >= 0),
    [rows, counts],
  );

  const variances = counted.filter(({ row, raw }) => BigInt(raw) !== row.expected);

  function reset() {
    setCounts({});
    setNote("");
    setResult(null);
  }

  function pickRack(next: string) {
    // A count belongs to ONE shelf. Carrying typed numbers across a rack change would let somebody post
    // A-01-3's figures against A-02-1 — the exact "counted the wrong shelf" error the expected column
    // exists to prevent, arriving by a different route.
    //
    // `replace` so picking through three racks does not leave three back-button steps behind: the shelf
    // is what this screen IS, not somewhere it has been.
    setParams(next === "" ? {} : { rack: next }, { replace: true });
    reset();
  }

  async function submit() {
    if (teamId === undefined || rackId === "" || rackId === UNPLACED) return;

    const lines: StockOpnameLine[] = counted.map(({ row, raw }) => ({
      $typeName: "warehouse.inventory.v1.StockOpnameLine",
      productId: row.productId,
      countedQty: BigInt(raw),
    }));

    try {
      const res = await post.mutateAsync({ warehouseId: teamId, rackId: BigInt(rackId), lines, note });

      setResult(res);
      setCounts({});
      setNote("");
      toaster.create({ type: "success", title: t("opname.posted", { count: lines.length }) });
    } catch (err) {
      toaster.create({ type: "error", title: rpcError(err) });
    } finally {
      setConfirming(false);
    }
  }

  if (!current) {
    return (
      <Stack gap="section" data-testid="opname-page">
        <Heading size="md">{t("opname.title")}</Heading>
        <Text color="fg.muted" data-testid="opname-no-team">
          {t("opname.selectTeam")}
        </Text>
      </Stack>
    );
  }

  return (
    <Stack gap="section" data-testid="opname-page">
      <Flex align="center" gap="card" wrap="wrap">
        <Heading size="md">{t("opname.title")}</Heading>
        <Badge colorPalette="brand">{current.teamName}</Badge>
        <Spacer />
        <RackSelect
          warehouseId={teamId ?? 0n}
          value={rackId}
          onChange={pickRack}
          placeholder={t("opname.pickShelf")}
        />
      </Flex>

      {rackId === "" && (
        <VStack gap="card" py="10" color="fg.muted" data-testid="opname-pick-prompt">
          <Icon as={ClipboardCheck} boxSize="8" />
          <Text fontWeight="medium">{t("opname.pickShelfTitle")}</Text>
          <Text fontSize="sm" maxW="md" textAlign="center">
            {t("opname.pickShelfBody")}
          </Text>
        </VStack>
      )}

      {/* The unplaced pile is a real place that holds real stock, and it is NOT countable here yet.
          Saying so beats a screen that silently shows nothing: RackStock is a per-rack read, and the
          pile has no rack id, so counting it needs a read this screen does not have. */}
      {rackId === UNPLACED && (
        <Flex align="center" gap="2" color="orange.fg" data-testid="opname-unplaced-unsupported">
          <Icon as={TriangleAlert} boxSize="4" />
          <Text fontSize="sm">{t("opname.unplacedUnsupported")}</Text>
        </Flex>
      )}

      {result && <OpnameResult result={result} onDismiss={() => setResult(null)} />}

      {rackId !== "" && rackId !== UNPLACED && (
        <>
          {shelf.isError && (
            <Text color="red.fg" data-testid="opname-error">
              {rpcError(shelf.error)}
            </Text>
          )}

          {/* A shelf too big for one screen would be counted in part and posted as if whole. The
              uncounted rows are safe — the server never touches a product it was not sent — but the
              person would believe they had finished, so this says otherwise. */}
          {shelf.data?.truncated && (
            <Flex align="center" gap="2" color="orange.fg" data-testid="opname-truncated">
              <Icon as={TriangleAlert} boxSize="4" />
              <Text fontSize="sm">{t("opname.truncated")}</Text>
            </Flex>
          )}

          {shelf.isPending ? (
            <Spinner colorPalette="brand" />
          ) : rows.length === 0 ? (
            <Text color="fg.muted" data-testid="opname-empty-shelf">
              {t("opname.emptyShelf")}
            </Text>
          ) : (
            <RefreshOverlay busy={shelf.isFetching && !shelf.isPending}>
              <CountTable rows={rows} counts={counts} onCount={(id, v) => setCounts((c) => ({ ...c, [id]: v }))} />
            </RefreshOverlay>
          )}

          {rows.length > 0 && (
            <Card.Root data-testid="opname-summary">
              <Card.Body>
                <Stack gap="card">
                  <SimpleGrid columns={{ base: 2, md: 4 }} gap="card">
                    <Stat label={t("opname.onShelf")} value={String(rows.length)} />
                    <Stat
                      label={t("opname.counted")}
                      value={String(counted.length)}
                      testId="opname-counted-count"
                    />
                    <Stat
                      label={t("opname.notCounted")}
                      value={String(rows.length - counted.length)}
                      testId="opname-uncounted-count"
                      // Not an error — a partial count is legal and the uncounted rows are left alone.
                      // Amber because it is the thing somebody should look at before pressing post.
                      tone={rows.length - counted.length > 0 ? "orange.fg" : undefined}
                    />
                    <Stat
                      label={t("opname.variances")}
                      value={String(variances.length)}
                      testId="opname-variance-count"
                      tone={variances.length > 0 ? "orange.fg" : undefined}
                    />
                  </SimpleGrid>

                  <Textarea
                    placeholder={t("opname.notePlaceholder")}
                    value={note}
                    rows={2}
                    data-testid="opname-note"
                    onChange={(e) => setNote(e.target.value)}
                  />

                  <Flex>
                    <Spacer />
                    <Button
                      colorPalette="brand"
                      disabled={counted.length === 0 || post.isPending}
                      loading={post.isPending}
                      data-testid="opname-post"
                      onClick={() => setConfirming(true)}
                    >
                      {t("opname.post", { count: counted.length })}
                    </Button>
                  </Flex>
                </Stack>
              </Card.Body>
            </Card.Root>
          )}
        </>
      )}

      {/* A count changes real stock and writes off the value of anything missing. It is not trivially
          reversible — undoing it means another count — so it confirms (the destructive-action rule).
          The message names the numbers rather than asking a generic "are you sure": what a person needs
          to check at this moment is that the uncounted rows are uncounted on purpose. */}
      <ConfirmDialog
        open={confirming}
        title={t("opname.confirmTitle")}
        message={t("opname.confirmBody", {
          counted: counted.length,
          variances: variances.length,
          uncounted: rows.length - counted.length,
        })}
        confirmLabel={t("opname.confirmAction")}
        onConfirm={submit}
        onOpenChange={setConfirming}
      />
    </Stack>
  );
}

function Stat({
  label,
  value,
  tone,
  testId,
}: {
  label: string;
  value: string;
  tone?: string;
  testId?: string;
}) {
  return (
    <Stack gap="0">
      <Text fontSize="xs" color="fg.muted">
        {label}
      </Text>
      <Text fontSize="xl" fontWeight="medium" color={tone} data-testid={testId}>
        {value}
      </Text>
    </Stack>
  );
}

function CountTable({
  rows,
  counts,
  onCount,
}: {
  rows: CountRow[];
  counts: Counts;
  onCount: (productId: string, value: string) => void;
}) {
  const { t } = useTranslation();

  return (
    <Table.ScrollArea>
      <Table.Root size="sm" data-testid="opname-table">
        <Table.Header>
          <Table.Row>
            <Table.ColumnHeader>{t("opname.table.product")}</Table.ColumnHeader>
            <Table.ColumnHeader textAlign="end">{t("opname.table.expected")}</Table.ColumnHeader>
            <Table.ColumnHeader textAlign="end">{t("opname.table.counted")}</Table.ColumnHeader>
            <Table.ColumnHeader textAlign="end">{t("opname.table.variance")}</Table.ColumnHeader>
            <Table.ColumnHeader textAlign="end">{t("opname.table.value")}</Table.ColumnHeader>
          </Table.Row>
        </Table.Header>

        <Table.Body>
          {rows.map((row) => {
            const id = row.productId.toString();
            const raw = (counts[id] ?? "").trim();
            const valid = raw !== "" && Number.isInteger(Number(raw)) && Number(raw) >= 0;
            const delta = valid ? BigInt(raw) - row.expected : 0n;

            return (
              <Table.Row key={id} data-testid={`opname-row-${id}`}>
                <Table.Cell>
                  <Stack gap="0">
                    <Text fontWeight="medium">{row.name || t("opname.unknownProduct")}</Text>
                    <Text fontSize="xs" color="fg.muted">
                      {row.sku || id}
                    </Text>
                  </Stack>
                </Table.Cell>

                <Table.Cell textAlign="end">{row.expected.toString()}</Table.Cell>

                <Table.Cell textAlign="end">
                  <Input
                    type="number"
                    min="0"
                    w="24"
                    textAlign="end"
                    value={counts[id] ?? ""}
                    placeholder="—"
                    data-testid={`opname-count-${id}`}
                    onChange={(e) => onCount(id, e.target.value)}
                  />
                </Table.Cell>

                {/* A blank box reads as an em dash, not as 0. The whole contract of this screen is that
                    those two are different, so the column that shows the difference must not blur them. */}
                <Table.Cell
                  textAlign="end"
                  fontWeight="medium"
                  color={delta === 0n ? undefined : delta < 0n ? "red.fg" : "green.fg"}
                  data-testid={`opname-variance-${id}`}
                >
                  {!valid ? "—" : delta === 0n ? "0" : delta > 0n ? `+${delta}` : delta.toString()}
                </Table.Cell>

                <Table.Cell textAlign="end" color="fg.muted">
                  {/* What a shortfall is WORTH, at this warehouse's cost for the product. An estimate on
                      purpose: the server prices the write-off off the actual FIFO layers the draw
                      consumes, which this screen cannot know before it posts. `costKnown` is why an
                      unpriced product shows a dash rather than a confident Rp 0. */}
                  {!valid || delta >= 0n
                    ? "—"
                    : row.costKnown
                      ? formatRupiah(-delta * row.unitCost)
                      : t("opname.costUnknown")}
                </Table.Cell>
              </Table.Row>
            );
          })}
        </Table.Body>
      </Table.Root>
    </Table.ScrollArea>
  );
}

// What the count turned out to be, once posted. It stays on screen until dismissed rather than
// vanishing behind a toast: the variance list is the reason somebody did this, and it is the thing
// they will want to read out to whoever asks why the numbers moved.
function OpnameResult({ result, onDismiss }: { result: StockOpnameResponse; onDismiss: () => void }) {
  const { t } = useTranslation();

  const off = result.variances.filter((v) => v.delta !== 0n);

  return (
    <Card.Root data-testid="opname-result" borderColor="border.emphasized">
      <Card.Body>
        <Stack gap="card">
          <Flex align="center" gap="card">
            <Text fontWeight="semibold">
              {/* `count` is i18next's pluralisation key, so the counted figure has to travel under that
                  name — "Counted 1 products" is the kind of wrong that makes a screen look unfinished. */}
              {t("opname.resultTitle", {
                count: Number(result.countedProducts),
                variances: Number(result.varianceProducts),
              })}
            </Text>
            <Spacer />
            <Button variant="ghost" size="xs" onClick={onDismiss} data-testid="opname-result-dismiss">
              {t("opname.dismiss")}
            </Button>
          </Flex>

          {result.totalValueLoss > 0n && (
            <Flex align="center" gap="2" color="orange.fg" data-testid="opname-result-loss">
              <Icon as={TriangleAlert} boxSize="4" />
              <Text fontSize="sm">
                {/* `valueKnown` false means the figure is a FLOOR — some missing units came off a layer
                    whose cost was never recorded, so they were written off at nothing. */}
                {result.valueKnown
                  ? t("opname.resultLoss", { amount: formatRupiah(result.totalValueLoss) })
                  : t("opname.resultLossPartial", { amount: formatRupiah(result.totalValueLoss) })}
              </Text>
            </Flex>
          )}

          {off.length === 0 ? (
            <Text fontSize="sm" color="fg.muted" data-testid="opname-result-clean">
              {t("opname.resultClean")}
            </Text>
          ) : (
            <Table.Root size="sm" data-testid="opname-result-table">
              <Table.Header>
                <Table.Row>
                  <Table.ColumnHeader>{t("opname.table.product")}</Table.ColumnHeader>
                  <Table.ColumnHeader textAlign="end">{t("opname.table.expected")}</Table.ColumnHeader>
                  <Table.ColumnHeader textAlign="end">{t("opname.table.counted")}</Table.ColumnHeader>
                  <Table.ColumnHeader textAlign="end">{t("opname.table.variance")}</Table.ColumnHeader>
                  <Table.ColumnHeader textAlign="end">{t("opname.table.writtenOff")}</Table.ColumnHeader>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {off.map((v) => (
                  <Table.Row key={v.productId.toString()}>
                    <Table.Cell>{v.productId.toString()}</Table.Cell>
                    <Table.Cell textAlign="end">{v.expectedQty.toString()}</Table.Cell>
                    <Table.Cell textAlign="end">{v.countedQty.toString()}</Table.Cell>
                    <Table.Cell textAlign="end" color={v.delta < 0n ? "red.fg" : "green.fg"}>
                      {v.delta > 0n ? `+${v.delta}` : v.delta.toString()}
                    </Table.Cell>
                    <Table.Cell textAlign="end">
                      {v.valueLoss > 0n ? formatRupiah(v.valueLoss) : "—"}
                    </Table.Cell>
                  </Table.Row>
                ))}
              </Table.Body>
            </Table.Root>
          )}
        </Stack>
      </Card.Body>
    </Card.Root>
  );
}

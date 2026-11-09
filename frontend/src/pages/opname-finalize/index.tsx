import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router-dom";
import { Alert, Badge, Box, Button, Card, Flex, Heading, HStack, Icon, IconButton, Span, Spinner, Stack, Table, Text } from "@chakra-ui/react";
import { ArrowLeft, Flag } from "lucide-react";

import { rpcError } from "../../api/clients";
import {
  OpnameFinalizeBlock,
  type OpnameFinalizeProduct,
  OpnamePostType,
  OpnameSessionStatus,
} from "../../gen/warehouse/inventory/v1/opname_pb";
import { useTeam } from "../../features/team/TeamContext";
import { useTeamsByIds } from "../../features/teams/queries";
import { SummaryCard, SummaryStrip } from "../../features/orders/SummaryCard";
import { OpnameDifference, OpnamePlanBadge } from "../../features/opname/OpnameBadges";
import { useFinalizeOpnameSession, useOpnameFinalizePreview, useOpnameSession } from "../../features/opname/queries";
import { ConfirmDialog } from "../../components/feedback/ConfirmDialog";
import { toaster } from "../../components/feedback/Toaster";
import { useIsMobile } from "../../layouts/shell";
import { formatRupiahNumber } from "../../lib/money";
import { canManageOpname } from "../../lib/roles";

const POST: Record<OpnamePostType, { key: string; color: string }> = {
  [OpnamePostType.UNSPECIFIED]: { key: "opnameSession.finalize.post.unspecified", color: "gray" },
  [OpnamePostType.BROKEN]: { key: "opnameSession.finalize.post.broken", color: "warning" },
  [OpnamePostType.LOST]: { key: "opnameSession.finalize.post.lost", color: "error" },
  [OpnamePostType.CLAIM]: { key: "opnameSession.finalize.post.claim", color: "success" },
  [OpnamePostType.MINT]: { key: "opnameSession.finalize.post.mint", color: "info" },
};

const BLOCK_KEY: Record<OpnameFinalizeBlock, string> = {
  [OpnameFinalizeBlock.UNSPECIFIED]: "",
  [OpnameFinalizeBlock.NOT_ACTIVE]: "opnameSession.finalize.block.notActive",
  [OpnameFinalizeBlock.ROWS_NOT_COUNTED]: "opnameSession.finalize.block.rowsNotCounted",
  [OpnameFinalizeBlock.OWN_COUNT]: "opnameSession.finalize.block.ownCount",
};

// The transactions a team's share posts in (problem-and-found-replace-opname), in their order, each in its one colour:
// PROBLEM — broken and lost, what the warehouse owes; FOUND — claims back and new stock; MOVE — units only on the wrong
// rack, no money.
type Tx = "problem" | "found" | "move";

const TX_COLOR: Record<Tx, string> = { problem: "error", found: "success", move: "gray" };

function transactionsOf(p: OpnameFinalizeProduct): Tx[] {
  const out: Tx[] = [];
  if (p.lines.some((l) => l.type === OpnamePostType.BROKEN || l.type === OpnamePostType.LOST)) out.push("problem");
  if (p.lines.some((l) => l.type === OpnamePostType.CLAIM || l.type === OpnamePostType.MINT)) out.push("found");
  if (p.movedCount > 0n) out.push("move");

  return out;
}

// OpnameFinalizePage — WHAT FINALIZE WILL POST, before it does (opname.md §How We Manage Stock Problem In Warehouses).
// Each product is settled over all its racks: broken is posted as written, and only the rest is netted — short is lost,
// over claims an old loss back and then mints, 0 is a move (broken-posts-as-written-the-rest-nets). Each line is a batch,
// oldest first, broken before lost (broken-takes-its-batch-before-lost). The summary reads in the three transactions a
// team's share posts in, and each product names the ones it posts in.
//
// Finalizing IS the agreement (finalizing-is-the-agreement), so the second person reads this and confirms — and is never
// one of the session's counters (nobody-finalizes-their-own-count).
export function OpnameFinalizePage() {
  const { current } = useTeam();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const isMobile = useIsMobile();
  const params = useParams();
  const sessionId = BigInt(params.sessionId ?? "0");
  const [confirming, setConfirming] = useState(false);

  const teamId = current?.teamId;
  const detail = useOpnameSession({ teamId, sessionId });
  const preview = useOpnameFinalizePreview({ teamId, sessionId });
  const finalize = useFinalizeOpnameSession();
  const teams = useTeamsByIds({ ids: (preview.data?.products ?? []).map((p) => p.teamId) });

  if (!current || teamId === undefined) return <Text color="fg.muted">{t("opnameSession.selectTeam")}</Text>;
  if (!canManageOpname(current.role)) {
    return (
      <Text color="fg.muted" data-testid="opname-finalize-forbidden">
        {t("opnameSession.detail.managersOnly")}
      </Text>
    );
  }
  if (detail.isPending || preview.isPending) return <Spinner colorPalette="brand" />;

  const session = detail.data?.session ?? null;
  const data = preview.data;
  if (!session || !data) {
    return (
      <Text color="error.fg" data-testid="opname-finalize-error">
        {detail.isError ? rpcError(detail.error) : preview.isError ? rpcError(preview.error) : t("opnameSession.detail.notFound")}
      </Text>
    );
  }

  const teamName = (id: bigint) => teams.data?.[id.toString()]?.name ?? `#${id}`;
  const blocked = data.block !== OpnameFinalizeBlock.UNSPECIFIED;
  const active = session.status === OpnameSessionStatus.ACTIVE;
  const finished = session.status === OpnameSessionStatus.FINISH;
  const moved = data.products.reduce((sum, p) => sum + p.movedCount, 0n);

  async function confirmFinalize() {
    try {
      await finalize.mutateAsync({ teamId: teamId!, sessionId });
      toaster.create({ type: "success", title: t("opnameSession.finalize.done", { id: sessionId.toString() }) });
      navigate(`/inventories/opname/sessions/${sessionId}`);
    } catch (err) {
      toaster.create({ type: "error", title: rpcError(err) });
    }
  }

  return (
    <Stack gap="section" data-testid="opname-finalize-page">
      <Flex align="flex-start" gap="card" wrap="wrap">
        <Stack gap="1" flex="1 1 16rem" minW="0">
          <HStack gap="2" wrap="wrap">
            <IconButton
              size="xs"
              variant="ghost"
              aria-label={t("opnameSession.back")}
              onClick={() => navigate(`/inventories/opname/sessions/${sessionId}`)}
              data-testid="opname-finalize-back"
            >
              <Icon as={ArrowLeft} boxSize="4" />
            </IconButton>
            <Heading size="md" data-testid="opname-finalize-heading">
              {t("opnameSession.finalize.title", { id: sessionId.toString() })}
            </Heading>
            <OpnamePlanBadge plan={session.plan} />
          </HStack>
          <Text fontSize="sm" color="fg.muted">
            {t("opnameSession.finalize.subtitle")}
          </Text>
        </Stack>
        {active && (
          <Button size="xs" colorPalette="brand" disabled={blocked} onClick={() => setConfirming(true)} data-testid="opname-finalize-submit">
            <Icon as={Flag} boxSize="4" />
            {t("opnameSession.detail.finalize")}
          </Button>
        )}
      </Flex>

      {!active ? (
        <Text color="fg.muted" data-testid="opname-finalize-finished">
          {finished ? t("opnameSession.finalize.finished") : t("opnameSession.finalize.block.notActive")}
        </Text>
      ) : (
        <>
          {blocked && (
            <Alert.Root status="warning" data-testid={`opname-finalize-block-${data.block}`}>
              <Alert.Indicator />
              <Alert.Content>
                <Alert.Description>
                  {t(BLOCK_KEY[data.block], { left: (session.rowCount - session.countedRowCount).toString() })}
                </Alert.Description>
              </Alert.Content>
            </Alert.Root>
          )}

          <SummaryStrip testId="opname-finalize-summary">
            <SummaryCard
              label={t("opnameSession.finalize.summary.owed")}
              value={formatRupiahNumber(data.owedAmount)}
              line={t("opnameSession.finalize.summary.owedLine")}
              emphasis
              testId="opname-finalize-owed"
            />
            <SummaryCard
              label={t("opnameSession.finalize.summary.claimed")}
              value={formatRupiahNumber(data.claimedAmount)}
              line={t("opnameSession.finalize.summary.claimedLine")}
              testId="opname-finalize-claimed"
            />
            <SummaryCard
              label={t("opnameSession.finalize.summary.minted")}
              value={formatRupiahNumber(data.mintedAmount)}
              line={t("opnameSession.finalize.summary.mintedLine")}
              testId="opname-finalize-minted"
            />
            <SummaryCard
              label={t("opnameSession.finalize.summary.moved")}
              value={t("opnameSession.finalize.summary.movedValue", { count: Number(moved) })}
              line={t("opnameSession.finalize.summary.movedLine")}
              testId="opname-finalize-moved"
            />
            <SummaryCard
              label={t("opnameSession.finalize.summary.products")}
              value={data.products.length.toString()}
              line={t("opnameSession.finalize.summary.productsLine")}
              testId="opname-finalize-products"
            />
          </SummaryStrip>

          {data.products.length === 0 ? (
            <Text color="fg.muted" data-testid="opname-finalize-nothing">
              {t("opnameSession.finalize.nothing")}
            </Text>
          ) : (
            <Stack gap="card">
              {data.products.map((p) => (
                <ProductSettlement key={`${p.teamId}:${p.productId}`} product={p} teamName={teamName(p.teamId)} compact={isMobile} />
              ))}
            </Stack>
          )}
        </>
      )}

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        destructive={false}
        title={t("opnameSession.finalize.confirmTitle", { id: sessionId.toString() })}
        message={t("opnameSession.finalize.confirmMessage", { owed: formatRupiahNumber(data.owedAmount) })}
        confirmLabel={t("opnameSession.detail.finalize")}
        dismissLabel={t("opnameSession.create.dismiss")}
        onConfirm={confirmFinalize}
      />
    </Stack>
  );
}

// One product, settled over all its racks: the transactions it posts in, the arithmetic in one line, what posts per
// batch, and what only moves.
function ProductSettlement({ product, teamName, compact }: { product: OpnameFinalizeProduct; teamName: string; compact: boolean }) {
  const { t } = useTranslation();
  const p = product;

  return (
    <Card.Root variant="outline" size="sm" data-testid={`opname-finalize-product-${p.productId}`}>
      <Card.Body gap="3">
        <HStack justify="space-between" align="flex-start" gap="2" wrap="wrap">
          <Stack gap="0" minW="0">
            <Span fontWeight="bold">{p.productName}</Span>
            <Span fontSize="xs" color="fg.muted">
              {p.productCode} · {teamName}
            </Span>
          </Stack>
          <HStack gap="1" data-testid={`opname-finalize-tx-${p.productId}`}>
            {transactionsOf(p).map((tx) => (
              <Badge key={tx} variant="subtle" colorPalette={TX_COLOR[tx]}>
                {t(`opnameSession.finalize.tx.${tx}`)}
              </Badge>
            ))}
          </HStack>
        </HStack>

        <Text fontSize="sm" data-testid={`opname-finalize-arithmetic-${p.productId}`}>
          {t("opnameSession.finalize.arithmetic", {
            book: p.bookCount.toString(),
            sellable: p.sellableCount.toString(),
            broken: p.brokenCount.toString(),
          })}{" "}
          <OpnameDifference value={p.restCount} testId={`opname-finalize-rest-${p.productId}`} />
          {p.rackChangeCount > 0n && (
            <Span color="fg.muted"> · {t("opnameSession.finalize.racksChanged", { count: Number(p.rackChangeCount) })}</Span>
          )}
        </Text>

        {p.lines.length > 0 &&
          (compact ? (
            <Stack gap="1">
              {p.lines.map((l, i) => (
                <HStack key={i} gap="2" fontSize="sm" wrap="wrap">
                  <Badge colorPalette={POST[l.type].color}>{t(POST[l.type].key)}</Badge>
                  <Span>
                    {l.stockCount.toString()} × {formatRupiahNumber(l.priceUnit)}
                  </Span>
                  <Span fontWeight="bold">{formatRupiahNumber(l.amount)}</Span>
                </HStack>
              ))}
            </Stack>
          ) : (
            <Box overflowX="auto">
              <Table.Root size="sm" data-testid={`opname-finalize-lines-${p.productId}`}>
                <Table.Header>
                  <Table.Row>
                    <Table.ColumnHeader>{t("opnameSession.finalize.lines.type")}</Table.ColumnHeader>
                    <Table.ColumnHeader>{t("opnameSession.finalize.lines.batch")}</Table.ColumnHeader>
                    <Table.ColumnHeader textAlign="end">{t("opnameSession.finalize.lines.units")}</Table.ColumnHeader>
                    <Table.ColumnHeader textAlign="end">{t("opnameSession.finalize.lines.price")}</Table.ColumnHeader>
                    <Table.ColumnHeader textAlign="end">{t("opnameSession.finalize.lines.amount")}</Table.ColumnHeader>
                  </Table.Row>
                </Table.Header>
                <Table.Body>
                  {p.lines.map((l, i) => (
                    <Table.Row key={i} _hover={{ bg: "bg.subtle" }}>
                      <Table.Cell>
                        <Badge colorPalette={POST[l.type].color}>{t(POST[l.type].key)}</Badge>
                      </Table.Cell>
                      <Table.Cell color="fg.muted">
                        {l.type === OpnamePostType.MINT
                          ? t("opnameSession.finalize.lines.newBatch")
                          : `#${l.batchId.toString()}`}
                        {l.problemId > 0n && ` · ${t("opnameSession.finalize.lines.claims", { id: l.problemId.toString() })}`}
                      </Table.Cell>
                      <Table.Cell textAlign="end" fontVariantNumeric="tabular-nums">
                        {l.stockCount.toString()}
                      </Table.Cell>
                      <Table.Cell textAlign="end" fontVariantNumeric="tabular-nums">
                        {formatRupiahNumber(l.priceUnit)}
                      </Table.Cell>
                      <Table.Cell textAlign="end" fontWeight="bold" fontVariantNumeric="tabular-nums">
                        {formatRupiahNumber(l.amount)}
                      </Table.Cell>
                    </Table.Row>
                  ))}
                </Table.Body>
              </Table.Root>
            </Box>
          ))}

        {p.movedCount > 0n && (
          <Text fontSize="sm" color="fg.muted" data-testid={`opname-finalize-move-${p.productId}`}>
            {t("opnameSession.finalize.move", { count: Number(p.movedCount) })}
          </Text>
        )}
      </Card.Body>
    </Card.Root>
  );
}

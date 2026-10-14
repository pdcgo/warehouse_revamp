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
import { formatRupiah } from "../../lib/money";
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

// OpnameFinalizePage — WHAT FINALIZE WILL POST, before it does (opname.md §How We Manage Stock Problem In Warehouses).
// Each product is settled over all its racks: broken is posted as written, and only the rest is netted — short is lost,
// over claims an old loss back and then mints, 0 is a move (broken-posts-as-written-the-rest-nets). Each line is a batch,
// oldest first, broken before lost (broken-takes-its-batch-before-lost).
//
// Finalizing IS the agreement (finalizing-is-the-agreement), so the second person reads this and confirms — and is never
// one of the session's counters (nobody-finalizes-their-own-count).
//
// ⚠ PROTOTYPE until design_accept — Storybook's stub plays it.
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
  const finished = session.status === OpnameSessionStatus.FINISH;

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
        {!finished && (
          <Button size="xs" colorPalette="brand" disabled={blocked} onClick={() => setConfirming(true)} data-testid="opname-finalize-submit">
            <Icon as={Flag} boxSize="4" />
            {t("opnameSession.detail.finalize")}
          </Button>
        )}
      </Flex>

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
          value={formatRupiah(data.owedAmount)}
          line={t("opnameSession.finalize.summary.owedLine")}
          emphasis
          testId="opname-finalize-owed"
        />
        <SummaryCard
          label={t("opnameSession.finalize.summary.claimed")}
          value={formatRupiah(data.claimedAmount)}
          line={t("opnameSession.finalize.summary.claimedLine")}
          testId="opname-finalize-claimed"
        />
        <SummaryCard
          label={t("opnameSession.finalize.summary.minted")}
          value={formatRupiah(data.mintedAmount)}
          line={t("opnameSession.finalize.summary.mintedLine")}
          testId="opname-finalize-minted"
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

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        destructive={false}
        title={t("opnameSession.finalize.confirmTitle", { id: sessionId.toString() })}
        message={t("opnameSession.finalize.confirmMessage", { owed: formatRupiah(data.owedAmount) })}
        confirmLabel={t("opnameSession.detail.finalize")}
        dismissLabel={t("opnameSession.create.dismiss")}
        onConfirm={confirmFinalize}
      />
    </Stack>
  );
}

// One product, settled over all its racks: the arithmetic in one line, then what posts, per batch.
function ProductSettlement({ product, teamName, compact }: { product: OpnameFinalizeProduct; teamName: string; compact: boolean }) {
  const { t } = useTranslation();
  const p = product;
  const outcome =
    p.restCount < 0n ? "short" : p.restCount > 0n ? "over" : p.brokenCount > 0n ? "brokenOnly" : "move";

  return (
    <Card.Root variant="outline" size="sm" data-testid={`opname-finalize-product-${p.productId}`}>
      <Card.Body gap="3">
        <HStack justify="space-between" align="flex-start" gap="2" wrap="wrap">
          <Stack gap="0" minW="0">
            <Span fontWeight="bold">{p.productName}</Span>
            <Span fontSize="xs" color="fg.muted">
              {p.productSku} · {teamName}
            </Span>
          </Stack>
          <Badge variant="outline" data-testid={`opname-finalize-outcome-${p.productId}`}>
            {t(`opnameSession.finalize.outcome.${outcome}`)}
          </Badge>
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
                    {l.stockCount.toString()} × {formatRupiah(l.priceUnit)}
                  </Span>
                  <Span fontWeight="bold">{formatRupiah(l.amount)}</Span>
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
                        {formatRupiah(l.priceUnit)}
                      </Table.Cell>
                      <Table.Cell textAlign="end" fontWeight="bold" fontVariantNumeric="tabular-nums">
                        {formatRupiah(l.amount)}
                      </Table.Cell>
                    </Table.Row>
                  ))}
                </Table.Body>
              </Table.Root>
            </Box>
          ))}
      </Card.Body>
    </Card.Root>
  );
}

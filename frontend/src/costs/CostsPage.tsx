import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Badge,
  Card,
  Flex,
  Heading,
  Icon,
  IconButton,
  Input,
  Menu,
  Portal,
  SimpleGrid,
  Spacer,
  Spinner,
  Stack,
  Table,
  Text,
} from "@chakra-ui/react";
import { Ban, MoreHorizontal, Pencil } from "lucide-react";

import { costClient, rpcError } from "../api/clients";
import type { CostRecord, CostTotals } from "../gen/warehouse/cost/v1/cost_pb";
import { CostKind } from "../gen/warehouse/cost/v1/cost_pb";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { CostKindSelect, costKindLabel } from "../components/CostKindSelect";
import { Pagination } from "../components/Pagination";
import { toaster } from "../components/Toaster";
import { formatRupiah } from "../lib/money";
import { useTeam } from "../team/TeamContext";
import { monthRange, thisMonth } from "../lib/period";
import { RecordCostDialog } from "./RecordCostDialog";

const PAGE_SIZE_OPTIONS = [10, 20, 50];


// CostsPage lists what a team spent in a month (#170) — the money no order caused.
//
// The MONTH PICKER is the primary control, not a nicety: a cost list without a period is a wall of
// every cost ever recorded, and the same period is what the profit screen subtracts against.
export function CostsPage() {
  const { current } = useTeam();
  const { t } = useTranslation();

  const [month, setMonth] = useState(thisMonth);
  const [kind, setKind] = useState<CostKind>(CostKind.UNSPECIFIED);
  const [costs, setCosts] = useState<CostRecord[]>([]);
  const [totals, setTotals] = useState<CostTotals | undefined>(undefined);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [totalItems, setTotalItems] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<CostRecord | null>(null);

  const teamId = current?.teamId;

  const load = useCallback(async () => {
    if (teamId === undefined) return;

    setLoading(true);
    setError("");

    try {
      const { from, to } = monthRange(month);

      const res = await costClient.costList({
        teamId,
        from,
        to,
        kind,
        page: { page, limit: pageSize },
      });

      setCosts(res.costs);
      setTotals(res.totals);
      setTotalItems(Number(res.pageInfo?.totalItems ?? 0n));
    } catch (err) {
      setError(rpcError(err));
      setCosts([]);
      setTotals(undefined);
    } finally {
      setLoading(false);
    }
  }, [teamId, month, kind, page, pageSize]);

  useEffect(() => {
    void load();
  }, [load]);

  async function voidCost(cost: CostRecord) {
    if (teamId === undefined) return;

    try {
      await costClient.costVoid({ teamId, costId: cost.id });
      toaster.create({ type: "success", title: t("costs.toast.voided") });
      await load();
    } catch (err) {
      toaster.create({
        type: "error",
        title: t("costs.toast.voidFailed"),
        description: rpcError(err),
      });
    }
  }

  if (!current) {
    return (
      <Stack gap="section">
        <Heading size="md">{t("costs.title")}</Heading>
        <Text color="fg.muted" data-testid="costs-no-team">
          {t("costs.selectTeam")}
        </Text>
      </Stack>
    );
  }

  return (
    <Stack gap="section">
      <Flex align="center" gap="card" wrap="wrap">
        <Heading size="md">{t("costs.title")}</Heading>
        <Badge colorPalette="brand">{current.teamName}</Badge>
        <Spacer />

        {/* The period. First control on the page because it decides what every number below means. */}
        <Input
          type="month"
          w="40"
          value={month}
          data-testid="costs-month"
          onChange={(e) => {
            setMonth(e.target.value);
            setPage(1);
          }}
        />

        <RecordCostDialog teamId={current.teamId} onDone={() => void load()} />
      </Flex>

      {/* The summary — per kind and in total, for the WHOLE month rather than the page below. The
          server computes them (#168) precisely so this cannot drift into a page-derived figure. */}
      {!loading && totals && (
        <Card.Root data-testid="costs-totals">
          <Card.Body>
            <SimpleGrid columns={{ base: 2, md: 4 }} gap="card">
              {[CostKind.ADS, CostKind.PAYROLL, CostKind.OPERATIONAL].map((k) => (
                <Stack key={k} gap="0">
                  <Text fontSize="xs" color="fg.muted">
                    {costKindLabel(t, k)}
                  </Text>
                  <Text fontWeight="medium" data-testid={`costs-total-kind-${k}`}>
                    {/* A kind with nothing this month is ABSENT from the map (#168), which reads as
                        0 here — the only place absent and zero are allowed to look the same, because
                        on a summary card they mean the same thing. */}
                    {formatRupiah(totals.byKind[k] ?? 0n)}
                  </Text>
                </Stack>
              ))}

              <Stack gap="0">
                <Text fontSize="xs" color="fg.muted">
                  {t("costs.total")}
                </Text>
                <Text fontWeight="medium" data-testid="costs-total">
                  {formatRupiah(totals.total)}
                </Text>
              </Stack>
            </SimpleGrid>
          </Card.Body>
        </Card.Root>
      )}

      <Flex gap="card" wrap="wrap">
        <CostKindSelect
          filter
          testId="costs-kind-filter"
          value={kind}
          onChange={(k) => {
            setKind(k);
            setPage(1);
          }}
        />
      </Flex>

      {error && (
        <Text color="red.fg" data-testid="costs-error">
          {error}
        </Text>
      )}

      {loading ? (
        <Spinner colorPalette="brand" />
      ) : (
        <Table.Root size="sm" data-testid="costs-table">
          <Table.Header>
            <Table.Row>
              <Table.ColumnHeader>{t("costs.table.date")}</Table.ColumnHeader>
              <Table.ColumnHeader>{t("costs.table.kind")}</Table.ColumnHeader>
              <Table.ColumnHeader>{t("costs.table.note")}</Table.ColumnHeader>
              <Table.ColumnHeader textAlign="end">{t("costs.table.amount")}</Table.ColumnHeader>
              <Table.ColumnHeader textAlign="end">{t("costs.table.actions")}</Table.ColumnHeader>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {costs.map((cost) => (
              <Table.Row
                key={String(cost.id)}
                data-testid={`cost-row-${cost.id}`}
                // A VOIDED cost is shown, muted and struck through (#169). It was entered and then
                // retracted, and that is worth seeing — hidden is indistinguishable from deleted.
                color={cost.voided ? "fg.muted" : undefined}
                textDecoration={cost.voided ? "line-through" : undefined}
              >
                <Table.Cell>{cost.occurredAt}</Table.Cell>
                <Table.Cell>
                  {costKindLabel(t, cost.kind)}
                  {cost.voided && (
                    <Badge ml="2" colorPalette="gray" data-testid={`cost-voided-${cost.id}`}>
                      {t("costs.voided")}
                    </Badge>
                  )}
                </Table.Cell>
                <Table.Cell>{cost.note}</Table.Cell>
                <Table.Cell textAlign="end">{formatRupiah(cost.amount)}</Table.Cell>

                <Table.Cell textAlign="end" onClick={(e) => e.stopPropagation()}>
                  {/* Two actions behind an overflow menu, each with a leading icon — and a voided cost
                      offers neither, because it can no longer be edited (#169) and voiding it again
                      would do nothing. */}
                  {!cost.voided && (
                    <Menu.Root>
                      <Menu.Trigger asChild>
                        <IconButton
                          size="xs"
                          variant="ghost"
                          aria-label={t("costs.table.actions")}
                          data-testid={`cost-actions-${cost.id}`}
                        >
                          <Icon as={MoreHorizontal} boxSize="4" />
                        </IconButton>
                      </Menu.Trigger>
                      <Portal>
                        <Menu.Positioner>
                          <Menu.Content>
                            <Menu.Item
                              value="edit"
                              data-testid={`cost-edit-${cost.id}`}
                              onClick={() => setEditing(cost)}
                            >
                              <Icon as={Pencil} boxSize="4" />
                              {t("costs.edit")}
                            </Menu.Item>

                            {/* Voiding changes a profit figure, so it confirms first. */}
                            <ConfirmDialog
                              title={t("costs.voidDialog.title")}
                              message={t("costs.voidDialog.message")}
                              confirmLabel={t("costs.voidDialog.confirm")}
                              onConfirm={() => voidCost(cost)}
                              trigger={
                                <Menu.Item
                                  value="void"
                                  color="red.fg"
                                  data-testid={`cost-void-${cost.id}`}
                                  // The menu must NOT close on this one: it opens a confirm dialog,
                                  // and a menu that closes takes the dialog's trigger with it.
                                  closeOnSelect={false}
                                >
                                  <Icon as={Ban} boxSize="4" />
                                  {t("costs.void")}
                                </Menu.Item>
                              }
                            />
                          </Menu.Content>
                        </Menu.Positioner>
                      </Portal>
                    </Menu.Root>
                  )}
                </Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table.Root>
      )}

      {!loading && costs.length === 0 && !error && (
        <Text color="fg.muted" data-testid="costs-empty">
          {t("costs.empty")}
        </Text>
      )}

      {!loading && (
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
      )}

      {/* The edit form is the record re-opened — the same dialog, given a cost to start from. */}
      {editing && (
        <RecordCostDialog
          teamId={current.teamId}
          editing={editing}
          onDone={() => {
            setEditing(null);
            void load();
          }}
          onClose={() => setEditing(null)}
        />
      )}
    </Stack>
  );
}

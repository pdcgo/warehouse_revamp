import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import {
  Badge,
  Button,
  Flex,
  Heading,
  Icon,
  IconButton,
  Menu,
  Portal,
  SimpleGrid,
  Spacer,
  Spinner,
  Stack,
  Stat,
  Table,
  Text,
} from "@chakra-ui/react";
import { History, MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";

import { rpcError, teamClient } from "../../api/clients";
import { teamByIdsRowData, teamsByIds } from "../../features/teams/adapt";
import { useTeam } from "../../features/team/TeamContext";
import { useDeleteTerms, useLiabilityPositions, useLiabilityTerms } from "../../features/liability/queries";
import { Role } from "../../gen/warehouse/role_base/v1/role_pb";
import type { LiabilityTerms } from "../../gen/warehouse/liability/v1/liability_pb";
import { ConfirmDialog } from "../../components/feedback/ConfirmDialog";
import { RefreshOverlay } from "../../components/feedback/RefreshOverlay";
import { Pagination } from "../../components/chrome/Pagination";
import { formatRupiah } from "../../lib/money";
import { ChangeLogPanel } from "./components/ChangeLogPanel";
import { CreditMeter, WARN_AT, limitStateOf } from "./components/CreditMeter";
import { TermsEditDialog, type CounterpartyOption } from "./components/TermsEditDialog";

const PAGE_SIZE = 20;
// Big enough to hold every counterparty this creditor trades with — the page needs each one's debt
// beside its limit, and a second page of positions would show utilisation for half the table.
const POSITION_PAGE = 200;

// The roles that write SOMEBODY ELSE'S terms — `balance_context.md` §Balance Policy 1, *"manage by
// team owner and can override by admin/root team"*.
//
// ⚠ It shapes the form only; the server decides for real. But a UI that let one of these save with
// no reason would be offering a write the backend is going to refuse.
function isOverrideWriter(role: Role): boolean {
  return role === Role.ROOT || role === Role.ADMIN;
}

// LiabilityTermsPage — a creditor's rates and credit limits, one row per debtor (#189).
//
// ⚠ THE LIMIT IS THE ONLY CONTROL THIS DESIGN HAS. There is no settlement cycle, no due date and no
// overdue state (no-overdue-only-the-threshold), so a limit is simultaneously the exposure cap, the
// only thing that ends a block, and — because lowering it stops a debtor trading — the only
// instrument a creditor has to chase with. That is why this screen shows utilisation and history
// beside the number, rather than being a settings form.
export function LiabilityTermsPage() {
  const { current } = useTeam();
  const { t } = useTranslation();

  const teamId = current?.teamId;

  const [page, setPage] = useState(1);
  const [historyPage, setHistoryPage] = useState(1);
  // undefined = the whole log. ⚠ NOT 0n, which is the default row.
  const [historyOf, setHistoryOf] = useState<bigint | undefined>(undefined);
  const [editing, setEditing] = useState<LiabilityTerms | undefined>(undefined);
  const [dialogOpen, setDialogOpen] = useState(false);

  const termsQuery = useLiabilityTerms({ teamId, page, pageSize: PAGE_SIZE });
  const terms = termsQuery.data?.terms ?? [];

  // What each debtor owes RIGHT NOW, so a limit can be read against the exposure it caps.
  const positionsQuery = useLiabilityPositions({
    teamId,
    page: 1,
    pageSize: POSITION_PAGE,
    unsettledOnly: false,
  });
  const positions = positionsQuery.data?.positions ?? [];

  // Positive = they owe us. The debt against a limit is the RECEIVABLE side only: a counterparty we
  // owe money to is not consuming any of the credit we granted them.
  const debtOf = useMemo(() => {
    const m = new Map<string, bigint>();
    for (const p of positions) m.set(p.counterpartyId.toString(), p.balance > 0n ? p.balance : 0n);
    return m;
  }, [positions]);

  const ids = useMemo(
    () =>
      [
        ...new Set([
          ...terms.filter((x) => x.counterpartyId > 0n).map((x) => x.counterpartyId.toString()),
          ...positions.map((p) => p.counterpartyId.toString()),
        ]),
      ].map((s) => BigInt(s)),
    [terms, positions],
  );

  const teamsQuery = useQuery({
    queryKey: ["team-by-ids", ids.map((id) => id.toString()).sort()],
    enabled: ids.length > 0,
    queryFn: async () =>
      teamsByIds(await teamClient.teamByIds({ filter: { ids }, dataRequest: teamByIdsRowData() })),
  });
  const teamMap = teamsQuery.data ?? {};

  const nameOf = (id: bigint): string =>
    id === 0n
      ? t("terms.defaultRow")
      : (teamMap[id.toString()]?.name ?? t("terms.teamFallback", { id: id.toString() }));

  // The DEFAULT row first, always. It is the rule every other row is an exception to, so reading it
  // after its exceptions is reading the exceptions without knowing what they modify.
  const rows = useMemo(
    () =>
      [...terms].sort((a, b) => {
        if (a.counterpartyId === 0n) return -1;
        if (b.counterpartyId === 0n) return 1;
        return nameOf(a.counterpartyId).localeCompare(nameOf(b.counterpartyId));
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [terms, teamMap],
  );

  // Counterparties this creditor trades with that have NO terms row yet — the "add" list.
  const options: CounterpartyOption[] = useMemo(() => {
    const taken = new Set(terms.map((x) => x.counterpartyId.toString()));
    return positions
      .filter((p) => !taken.has(p.counterpartyId.toString()))
      .map((p) => ({ id: p.counterpartyId, name: nameOf(p.counterpartyId) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [positions, terms, teamMap]);

  const deleteTerms = useDeleteTerms();

  // The tiles: the three states, counted. "Near limit" is the one worth acting on.
  const nearLimit = rows.filter((x) => {
    if (limitStateOf(x.creditLimit) !== "capped") return false;
    const debt = debtOf.get(x.counterpartyId.toString()) ?? 0n;
    return debt * 10000n >= x.creditLimit! * BigInt(Math.round(WARN_AT * 10000));
  }).length;
  const frozen = rows.filter((x) => limitStateOf(x.creditLimit) === "frozen").length;
  const unlimited = rows.filter((x) => limitStateOf(x.creditLimit) === "unlimited").length;

  if (!current) {
    return (
      <Stack gap="section">
        <Heading size="md">{t("terms.title")}</Heading>
        <Text color="fg.muted">{t("liability.selectTeamView")}</Text>
      </Stack>
    );
  }

  const overrideWriter = isOverrideWriter(current.role);

  return (
    <Stack gap="section" data-testid="liability-terms-page">
      <Flex align="center" gap="card" wrap="wrap">
        <Heading size="md">{t("terms.title")}</Heading>
        <Badge colorPalette="brand">{current.teamName}</Badge>
        {overrideWriter && (
          <Badge colorPalette="purple" data-testid="terms-override-writer">
            {t("terms.overrideWriter")}
          </Badge>
        )}
        <Spacer />
        <Button
          size="xs"
          colorPalette="brand"
          data-testid="terms-add"
          onClick={() => {
            setEditing(undefined);
            setDialogOpen(true);
          }}
        >
          <Icon as={Plus} boxSize="4" />
          {t("terms.setTerms")}
        </Button>
      </Flex>

      {/* What this screen is FOR, in one line — the limit is the only control the design has. */}
      <Text color="fg.muted">{t("terms.intro")}</Text>

      <SimpleGrid columns={{ base: 3 }} gap="card">
        <Stat.Root>
          <Stat.Label>{t("terms.tileNear")}</Stat.Label>
          <Stat.ValueText color={nearLimit > 0 ? "orange.fg" : undefined} data-testid="terms-tile-near">
            {nearLimit.toString()}
          </Stat.ValueText>
          <Stat.HelpText>{t("terms.tileNearHelp")}</Stat.HelpText>
        </Stat.Root>
        <Stat.Root>
          <Stat.Label>{t("terms.tileFrozen")}</Stat.Label>
          <Stat.ValueText color={frozen > 0 ? "red.fg" : undefined} data-testid="terms-tile-frozen">
            {frozen.toString()}
          </Stat.ValueText>
          <Stat.HelpText>{t("terms.tileFrozenHelp")}</Stat.HelpText>
        </Stat.Root>
        <Stat.Root>
          <Stat.Label>{t("terms.tileUnlimited")}</Stat.Label>
          <Stat.ValueText data-testid="terms-tile-unlimited">{unlimited.toString()}</Stat.ValueText>
          <Stat.HelpText>{t("terms.tileUnlimitedHelp")}</Stat.HelpText>
        </Stat.Root>
      </SimpleGrid>

      {termsQuery.isPending ? (
        <Spinner colorPalette="brand" />
      ) : termsQuery.isError ? (
        <Text color="red.fg" data-testid="terms-error">
          {rpcError(termsQuery.error)}
        </Text>
      ) : (
        <RefreshOverlay busy={termsQuery.isFetching && !termsQuery.isPending}>
          <Stack gap="card">
            <Table.Root size="sm" data-testid="terms-table">
              <Table.Header>
                <Table.Row>
                  <Table.ColumnHeader>{t("terms.counterparty")}</Table.ColumnHeader>
                  <Table.ColumnHeader>{t("terms.creditLimit")}</Table.ColumnHeader>
                  <Table.ColumnHeader textAlign="end">{t("terms.handlingFee")}</Table.ColumnHeader>
                  <Table.ColumnHeader textAlign="end">{t("terms.markup")}</Table.ColumnHeader>
                  <Table.ColumnHeader />
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {rows.map((x) => {
                  const isDefault = x.counterpartyId === 0n;
                  const debt = debtOf.get(x.counterpartyId.toString()) ?? 0n;

                  return (
                    <Table.Row
                      key={x.counterpartyId.toString()}
                      bg={isDefault ? "bg.muted" : undefined}
                      data-testid={`terms-row-${x.counterpartyId}`}
                    >
                      <Table.Cell>
                        <Text as="span" fontWeight="medium">
                          {nameOf(x.counterpartyId)}
                        </Text>
                        {isDefault && (
                          <Text color="fg.subtle" fontSize="xs">
                            {t("terms.defaultRowHelp")}
                          </Text>
                        )}
                      </Table.Cell>
                      <Table.Cell>
                        {/* The default row caps nobody in particular, so a utilisation bar against
                            it would be meaningless — it shows the limit as words only. */}
                        {isDefault ? (
                          <CreditMeter
                            limit={x.creditLimit}
                            debt={0n}
                            testId={`terms-meter-${x.counterpartyId}`}
                          />
                        ) : (
                          <CreditMeter
                            limit={x.creditLimit}
                            debt={debt}
                            testId={`terms-meter-${x.counterpartyId}`}
                          />
                        )}
                      </Table.Cell>
                      <Table.Cell textAlign="end">
                        {x.handlingFee > 0n ? (
                          formatRupiah(x.handlingFee)
                        ) : (
                          <Text as="span" color="fg.subtle">
                            {t("terms.chargesNothing")}
                          </Text>
                        )}
                      </Table.Cell>
                      <Table.Cell textAlign="end">
                        {x.productMarkupBp > 0n ? (
                          `${(Number(x.productMarkupBp) / 100).toFixed(2).replace(/\.?0+$/, "")}%`
                        ) : (
                          <Text as="span" color="fg.subtle">
                            {t("terms.chargesNothing")}
                          </Text>
                        )}
                      </Table.Cell>
                      <Table.Cell>
                        {/* Three actions, so an overflow menu — each item with a leading icon. */}
                        <Menu.Root>
                          <Menu.Trigger asChild>
                            <IconButton
                              size="xs"
                              variant="ghost"
                              aria-label={t("terms.actions")}
                              data-testid={`terms-actions-${x.counterpartyId}`}
                            >
                              <Icon as={MoreHorizontal} boxSize="4" />
                            </IconButton>
                          </Menu.Trigger>
                          <Portal>
                            <Menu.Positioner>
                              <Menu.Content>
                                <Menu.Item
                                  value="edit"
                                  data-testid={`terms-edit-${x.counterpartyId}`}
                                  onClick={() => {
                                    setEditing(x);
                                    setDialogOpen(true);
                                  }}
                                >
                                  <Icon as={Pencil} boxSize="4" />
                                  {t("terms.edit")}
                                </Menu.Item>

                                <Menu.Item
                                  value="history"
                                  data-testid={`terms-history-${x.counterpartyId}`}
                                  onClick={() => {
                                    setHistoryOf(x.counterpartyId);
                                    setHistoryPage(1);
                                  }}
                                >
                                  <Icon as={History} boxSize="4" />
                                  {t("terms.viewHistory")}
                                </Menu.Item>

                                {/* ⚠ REMOVING TERMS RAISES THE CEILING. It is the only way to say
                                    "unlimited" once a limit exists, because 0 means the opposite —
                                    so it confirms, like any act that is not trivially reversible. */}
                                <ConfirmDialog
                                  title={t("terms.removeDialog.title", { name: nameOf(x.counterpartyId) })}
                                  message={t("terms.removeDialog.message")}
                                  confirmLabel={t("terms.removeDialog.confirm")}
                                  trigger={
                                    <Menu.Item
                                      value="remove"
                                      color="red.fg"
                                      data-testid={`terms-remove-${x.counterpartyId}`}
                                      // The menu must NOT close on this one: it opens a confirm
                                      // dialog, and a menu that closes takes the trigger with it.
                                      closeOnSelect={false}
                                    >
                                      <Icon as={Trash2} boxSize="4" />
                                      {t("terms.remove")}
                                    </Menu.Item>
                                  }
                                  onConfirm={async () => {
                                    await deleteTerms.mutateAsync({
                                      teamId: current.teamId,
                                      counterpartyId: x.counterpartyId,
                                      reason: "",
                                    });
                                  }}
                                />
                              </Menu.Content>
                            </Menu.Positioner>
                          </Portal>
                        </Menu.Root>
                      </Table.Cell>
                    </Table.Row>
                  );
                })}
              </Table.Body>
            </Table.Root>

            {rows.length === 0 ? (
              <Text color="fg.muted" data-testid="terms-empty">
                {t("terms.empty")}
              </Text>
            ) : (
              <Pagination
                page={page}
                pageSize={PAGE_SIZE}
                count={termsQuery.data?.totalItems ?? 0}
                onPageChange={setPage}
              />
            )}
          </Stack>
        </RefreshOverlay>
      )}

      {historyOf !== undefined && (
        <Button
          size="xs"
          variant="outline"
          alignSelf="start"
          data-testid="terms-history-all"
          onClick={() => {
            setHistoryOf(undefined);
            setHistoryPage(1);
          }}
        >
          {t("terms.showAllHistory")}
        </Button>
      )}

      <ChangeLogPanel
        teamId={current.teamId}
        counterpartyId={historyOf}
        nameOf={nameOf}
        page={historyPage}
        onPageChange={setHistoryPage}
      />

      <TermsEditDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        teamId={current.teamId}
        editing={editing}
        options={options}
        overrideWriter={overrideWriter}
      />
    </Stack>
  );
}

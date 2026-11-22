import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  Alert,
  Badge,
  Card,
  Collapsible,
  Flex,
  HStack,
  Icon,
  Portal,
  Select,
  Separator,
  SimpleGrid,
  Spacer,
  Stack,
  Text,
  createListCollection,
} from "@chakra-ui/react";
import { ArrowDownLeft, ArrowUpRight, ChevronDown, Landmark } from "lucide-react";

import {
  ExpenseKind,
  ExpenseOrigin,
  ExpenseType,
  type ExpenseRecord,
  type ExpenseTotals,
} from "../../../gen/warehouse/expense/v1/expense_pb";
import { FinancialAccountChangeType } from "../../../gen/warehouse/financial_account/v1/financial_account_pb";
import { expenseKindLabel } from "../../../components/pickers/ExpenseKindSelect";
import { CHANGE_TYPE_PALETTE } from "../../../features/financialAccount/vocab";
import { formatRupiah } from "../../../lib/money";
import {
  EXPENSE_TYPES,
  type ExpenseTypeDef,
  TYPE_GROUPS,
  fullTypeLabel,
  typeDef,
  typeLabel,
} from "../../../features/expense/expenseTypes";

// THE EXPENSE TYPES ON BIAYA — backlog #99 P1, the accepted design live (the-expense-types-prototype-is-accepted,
// expense-types-sit-under-groups): the record dialog's grouped picker and its direction line, the month card (Biaya ·
// Uang masuk · Modal · Total bulan ini, then each group with its types), the filter by group or one type, and the rows'
// *Grup › Jenis* with the Modal / Masuk marks. The figures are the SERVER's (ExpenseList.totals) — never summed here.

/** The capital colour — the account page's own *Modal* badge (vocab.ts CHANGE_TYPE_PALETTE), so both doors read alike. */
const CAPITAL_PALETTE = CHANGE_TYPE_PALETTE[FinancialAccountChangeType.CAPITAL] ?? "teal";

// ── Marks ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** A type's marks — *Masuk* on money in, *Modal* on the owner's capital. Nothing on an ordinary cost. */
export function TypeMarks({ def, size = "sm", testIdPrefix }: { def: ExpenseTypeDef; size?: "xs" | "sm"; testIdPrefix?: string }) {
  const { t } = useTranslation();
  if (!def.capital && def.direction !== "in") return null;

  return (
    <HStack gap="1" flexShrink={0}>
      {def.capital && (
        <Badge colorPalette={CAPITAL_PALETTE} size={size} data-testid={testIdPrefix ? `${testIdPrefix}-capital` : undefined}>
          {t("expenses.types.capital")}
        </Badge>
      )}
      {def.direction === "in" && (
        <Badge colorPalette="success" size={size} data-testid={testIdPrefix ? `${testIdPrefix}-in` : undefined}>
          <Icon as={ArrowDownLeft} boxSize="3" />
          {t("expenses.types.in")}
        </Badge>
      )}
    </HStack>
  );
}

// ── The record dialog's picker ───────────────────────────────────────────────────────────────────────────────────────

/**
 * THE TYPE PICKER — the types under their group's heading (expense-types-sit-under-groups). A plain Chakra Select, not a
 * search: the set is static and small, changed by a proto edit (a-picker-over-data-that-grows-is-a-search-select's
 * exception, as ExpenseKindSelect). The trigger reads *Group › Type*; money in and capital carry their marks.
 */
export function ExpenseTypeSelect({
  value,
  onChange,
  disabled,
  testId = "expense-type-select",
}: {
  value: ExpenseType;
  onChange: (typeId: ExpenseType) => void;
  disabled?: boolean;
  testId?: string;
}) {
  const { t } = useTranslation();
  const collection = useMemo(
    () => createListCollection({ items: EXPENSE_TYPES.map((d) => ({ label: typeLabel(t, d), value: String(d.id) })) }),
    [t],
  );
  const picked = typeDef(value);

  return (
    <Select.Root
      collection={collection}
      disabled={disabled}
      value={picked ? [String(picked.id)] : []}
      onValueChange={(e) => {
        const v = e.value[0];
        if (v !== undefined) onChange(Number(v) as ExpenseType);
      }}
    >
      <Select.HiddenSelect />
      <Select.Control>
        <Select.Trigger data-testid={testId}>
          <Select.ValueText placeholder={t("expenses.types.choose")}>
            {picked ? fullTypeLabel(t, picked.group, picked) : undefined}
          </Select.ValueText>
        </Select.Trigger>
        <Select.IndicatorGroup>
          <Select.Indicator />
        </Select.IndicatorGroup>
      </Select.Control>

      <Portal>
        <Select.Positioner>
          <Select.Content>
            {TYPE_GROUPS.map((group) => (
              <Select.ItemGroup key={group} data-testid={`${testId}-group-${group}`}>
                <GroupHeading group={group} />
                {EXPENSE_TYPES.filter((d) => d.group === group).map((d) => (
                  <Select.Item item={collection.items.find((i) => i.value === String(d.id))!} key={d.id} data-testid={`${testId}-${d.key}`}>
                    <Select.ItemText flex="1">{typeLabel(t, d)}</Select.ItemText>
                    <TypeMarks def={d} size="xs" />
                    <Select.ItemIndicator />
                  </Select.Item>
                ))}
              </Select.ItemGroup>
            ))}
          </Select.Content>
        </Select.Positioner>
      </Portal>
    </Select.Root>
  );
}

function GroupHeading({ group }: { group: ExpenseKind }) {
  const { t } = useTranslation();

  return (
    <Select.ItemGroupLabel fontSize="xs" fontWeight="bold" color="fg.muted" textTransform="uppercase" letterSpacing="wide">
      {expenseKindLabel(t, group)}
    </Select.ItemGroupLabel>
  );
}

/**
 * UNDER THE PICKER, THE DIRECTION — the amount stays positive and the type says which way the money goes: a badge for
 * both ways, a sentence for money in, and for Prive / Setoran modal the line that it is the account's capital row, the
 * same record as Setor / Tarik Modal (prive-and-deposit-on-pengeluaran-are-the-accounts-capital).
 */
export function ExpenseTypeLine({ typeId }: { typeId: ExpenseType }) {
  const { t } = useTranslation();
  const def = typeDef(typeId);
  if (!def) return null;

  const inward = def.direction === "in";

  return (
    <Stack gap="2" mt="1.5" w="full">
      <HStack gap="2" align="center" data-testid="expense-direction" data-direction={def.direction}>
        <Badge colorPalette={inward ? "success" : "gray"} size="sm" flexShrink={0}>
          <Icon as={inward ? ArrowDownLeft : ArrowUpRight} boxSize="3" />
          {t(inward ? "expenses.types.moneyIn" : "expenses.types.moneyOut")}
        </Badge>
        <Text fontSize="xs" color="fg.muted">
          {t(inward ? "expenses.types.inLine" : "expenses.types.outLine")}
        </Text>
      </HStack>

      {def.capital && (
        <Alert.Root status="info" size="sm" data-testid="expense-capital-line">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Description>{t(inward ? "expenses.types.depositLine" : "expenses.types.priveLine")}</Alert.Description>
          </Alert.Content>
        </Alert.Root>
      )}
    </Stack>
  );
}

// ── Pengeluaran's list ───────────────────────────────────────────────────────────────────────────────────────────────

/** A row's kind cell — *Group › Type*; a row from before the types reads its group alone (its *Tanpa jenis*). */
export function ExpenseKindText({ cost }: { cost: ExpenseRecord }) {
  const { t } = useTranslation();

  return (
    <Text as="span" data-testid={`expense-type-${cost.id}`}>
      {fullTypeLabel(t, cost.kind, typeDef(cost.type))}
    </Text>
  );
}

/** A row's marks — *Modal* on a prive or setoran, *Masuk* on money in; nothing on an ordinary cost. */
export function ExpenseTypeMarks({ cost }: { cost: ExpenseRecord }) {
  const def = typeDef(cost.type);
  if (!def) return null;

  return <TypeMarks def={def} testIdPrefix={`expense-mark-${cost.id}`} />;
}

/**
 * CAPITAL'S SECOND DOOR (prive-and-deposit-on-pengeluaran-are-the-accounts-capital — one act, one record, two doors): a
 * selling team's Setor / Tarik Modal made on the account page is this row too, and says so — *Dicatat di halaman akun*
 * (ExpenseRecord.origin = ACCOUNT_PAGE). Its corrections are made here, on Biaya, so they carry no line.
 */
export function ExpenseOriginLine({ cost }: { cost: ExpenseRecord }) {
  const { t } = useTranslation();
  if (cost.origin !== ExpenseOrigin.ACCOUNT_PAGE || cost.adjustsExpenseId !== 0n) return null;

  return (
    <HStack gap="1" fontSize="xs" color="fg.muted" data-testid={`expense-origin-${cost.id}`}>
      <Icon as={Landmark} boxSize="3" />
      <Text>{t("expenses.types.fromAccountPage")}</Text>
    </HStack>
  );
}

/** The amount's colour — money in reads in the success tone; undefined (today's) for everything else. */
export function amountTone(cost: ExpenseRecord): string | undefined {
  return typeDef(cost.type)?.direction === "in" ? "success.fg" : undefined;
}

// ── Pengeluaran's filter ─────────────────────────────────────────────────────────────────────────────────────────────

const ANY = "any";

/**
 * THE FILTER — a group, or one type of it (expense-types-sit-under-groups). Each group opens with *All <group>*; the
 * automatic Stok hilang/rusak stays at the foot, as the kind filter had it. Both are the page's, kept in the URL
 * (`?kind=` the group, `?type=` the one type — a-lists-filters-live-in-the-url): picking a type also sets its group, so
 * an old `?kind=` link still opens the group. The trigger keeps today's test id and the groups keep today's option
 * ids, so a spec that picks a kind still finds it.
 */
export function ExpenseTypeFilter({
  kind,
  type,
  onChange,
  testId = "expenses-kind-filter",
}: {
  kind: ExpenseKind;
  type: ExpenseType;
  onChange: (kind: ExpenseKind, type: ExpenseType) => void;
  testId?: string;
}) {
  const { t } = useTranslation();

  const collection = useMemo(() => {
    const items = [{ label: t("expenses.kind.any"), value: ANY }];
    for (const group of TYPE_GROUPS) {
      items.push({ label: t("expenses.types.allOf", { group: expenseKindLabel(t, group) }), value: `g${group}` });
      for (const d of EXPENSE_TYPES.filter((x) => x.group === group)) items.push({ label: typeLabel(t, d), value: `t${d.id}` });
    }
    items.push({ label: expenseKindLabel(t, ExpenseKind.STOCK_LOSS), value: `g${ExpenseKind.STOCK_LOSS}` });

    return createListCollection({ items });
  }, [t]);

  const filterDef = typeDef(type);
  const selected = filterDef ? `t${filterDef.id}` : kind === ExpenseKind.UNSPECIFIED ? ANY : `g${kind}`;
  const shown = filterDef
    ? fullTypeLabel(t, filterDef.group, filterDef)
    : kind === ExpenseKind.UNSPECIFIED
      ? t("expenses.kind.any")
      : t("expenses.types.allOf", { group: expenseKindLabel(t, kind) });
  const item = (value: string) => collection.items.find((i) => i.value === value)!;
  const optionId = (value: string) =>
    value === ANY ? `${testId}-any` : value.startsWith("g") ? `${testId}-${value.slice(1)}` : `${testId}-type-${typeDef(Number(value.slice(1)))!.key}`;

  return (
    <Select.Root
      collection={collection}
      value={[selected]}
      onValueChange={(e) => {
        const v = e.value[0];
        if (v === undefined) return;
        if (v === ANY) {
          onChange(ExpenseKind.UNSPECIFIED, ExpenseType.UNSPECIFIED);
        } else if (v.startsWith("g")) {
          onChange(Number(v.slice(1)) as ExpenseKind, ExpenseType.UNSPECIFIED);
        } else {
          const d = typeDef(Number(v.slice(1)))!;
          onChange(d.group, d.id);
        }
      }}
    >
      <Select.HiddenSelect />
      <Select.Control>
        <Select.Trigger data-testid={testId}>
          <Select.ValueText>{shown}</Select.ValueText>
        </Select.Trigger>
        <Select.IndicatorGroup>
          <Select.Indicator />
        </Select.IndicatorGroup>
      </Select.Control>

      <Portal>
        <Select.Positioner>
          <Select.Content>
            <Select.Item item={item(ANY)} data-testid={optionId(ANY)}>
              <Select.ItemText>{item(ANY).label}</Select.ItemText>
              <Select.ItemIndicator />
            </Select.Item>
            {TYPE_GROUPS.map((group) => (
              <Select.ItemGroup key={group} data-testid={`${testId}-group-${group}`}>
                <GroupHeading group={group} />
                {[`g${group}`, ...EXPENSE_TYPES.filter((d) => d.group === group).map((d) => `t${d.id}`)].map((value) => {
                  const def = value.startsWith("t") ? typeDef(Number(value.slice(1))) : undefined;

                  return (
                    <Select.Item item={item(value)} key={value} data-testid={optionId(value)}>
                      <Select.ItemText flex="1" fontWeight={def ? undefined : "bold"}>
                        {item(value).label}
                      </Select.ItemText>
                      {def && <TypeMarks def={def} size="xs" />}
                      <Select.ItemIndicator />
                    </Select.Item>
                  );
                })}
              </Select.ItemGroup>
            ))}
            <Separator my="1" />
            <Select.Item item={item(`g${ExpenseKind.STOCK_LOSS}`)} data-testid={optionId(`g${ExpenseKind.STOCK_LOSS}`)}>
              <Select.ItemText>{item(`g${ExpenseKind.STOCK_LOSS}`).label}</Select.ItemText>
              <Select.ItemIndicator />
            </Select.Item>
          </Select.Content>
        </Select.Positioner>
      </Portal>
    </Select.Root>
  );
}


// ── The month's figures, as the server sent them ─────────────────────────────────────────────────────────────────────

interface TypeLine {
  /** UNSPECIFIED = the group's rows from before the types. */
  typeId: ExpenseType;
  /** Signed: money in is negative. */
  total: number;
}

interface GroupTotal {
  kind: ExpenseKind;
  /** The group's net (by_kind). */
  total: number;
  lines: TypeLine[];
}

/** The card's shape: the four groups always (an empty one reads Rp 0, as the kinds did), stock loss only with rows; each
 * group's lines its rows from before the types first, then its types in the picker's order — only those with a figure. */
function monthOf(w: ExpenseTotals) {
  const kinds = [...TYPE_GROUPS, ...(w.byKind[ExpenseKind.STOCK_LOSS] !== undefined ? [ExpenseKind.STOCK_LOSS] : [])];
  const groups: GroupTotal[] = kinds.map((kind) => {
    const lines: TypeLine[] = [];
    const untyped = w.byKindUntyped[kind] ?? 0;
    if (untyped !== 0 && kind !== ExpenseKind.STOCK_LOSS) lines.push({ typeId: ExpenseType.UNSPECIFIED, total: untyped });
    for (const d of EXPENSE_TYPES.filter((x) => x.group === kind)) {
      const v = w.byType[d.id] ?? 0;
      if (v !== 0) lines.push({ typeId: d.id, total: v });
    }

    return { kind, total: w.byKind[kind] ?? 0, lines };
  });

  return { groups, spending: w.spending, moneyIn: w.moneyIn, capital: w.capital, total: w.total };
}

// ── Pengeluaran's month ──────────────────────────────────────────────────────────────────────────────────────────────

/**
 * THE MONTH'S TOTALS, BY GROUP WITH ITS TYPES UNDER IT (expense-types-sit-under-groups, checklist given 28).
 *
 * The top line keeps spending apart from the rest: *Biaya* is every money-out row but Prive — what the month SPENT;
 * *Uang masuk* is the money-in types, which lower the total (givens 21, 22); *Modal* is Prive − Setoran modal, never an
 * expense in the profit (prive-and-deposit-on-pengeluaran-are-the-accounts-capital); *Total bulan ini* is the
 * checklist's month total, which moves with every one of them (givens 17–22) — and is the groups' sum as well.
 *
 * A group lists only the types that have a figure this month, its rows from before the types first as *Tanpa jenis*.
 * On a phone the groups fold: the figure on the line, its types on a tap. Every figure is the server's
 * (ExpenseList.totals, signed by the type's direction): nothing is summed here.
 */
export function ExpenseTypeTotals({ totals: wire, isMobile }: { totals: ExpenseTotals; isMobile: boolean }) {
  const { t } = useTranslation();
  const totals = monthOf(wire);

  const summary = [
    { key: "spending", label: t("expenses.types.spending"), value: totals.spending, testId: "expenses-total-spending" },
    {
      key: "moneyIn",
      label: t("expenses.types.moneyIn"),
      value: -totals.moneyIn,
      testId: "expenses-total-money-in",
      tone: totals.moneyIn !== 0 ? "success.fg" : undefined,
    },
    {
      key: "capital",
      label: t("expenses.types.capitalNet"),
      // A phone's three cells are narrow: the short word, its figure under it.
      short: t("expenses.types.capital"),
      value: totals.capital,
      testId: "expenses-total-capital",
      hint: t("expenses.types.capitalHint"),
    },
  ];

  if (isMobile) {
    return (
      <Card.Root data-testid="expenses-totals" size="sm">
        <Card.Body>
          <Stack gap="2">
            <Flex align="baseline" gap="2">
              <Text fontSize="sm" color="fg.muted">
                {t("expenses.types.monthTotal")}
              </Text>
              <Spacer />
              <Text fontWeight="bold" whiteSpace="nowrap" data-testid="expenses-total">
                {formatRupiah(totals.total)}
              </Text>
            </Flex>
            <SimpleGrid columns={3} gap="2">
              {summary.map((s) => (
                <Stack key={s.key} gap="0" minW="0">
                  <Text fontSize="xs" color="fg.muted" truncate>
                    {s.short ?? s.label}
                  </Text>
                  <Text fontSize="sm" whiteSpace="nowrap" color={s.tone} data-testid={s.testId}>
                    {formatRupiah(s.value)}
                  </Text>
                </Stack>
              ))}
            </SimpleGrid>
            <Separator />
            {totals.groups.map((g) => (
              <PhoneGroup key={g.kind} group={g} />
            ))}
          </Stack>
        </Card.Body>
      </Card.Root>
    );
  }

  return (
    <Card.Root data-testid="expenses-totals">
      <Card.Body>
        <Stack gap="card">
          <SimpleGrid columns={4} gap="card" data-testid="expenses-totals-summary">
            {summary.map((s) => (
              <Stack key={s.key} gap="0">
                <Text fontSize="xs" color="fg.muted">
                  {s.label}
                </Text>
                <Text fontWeight="medium" color={s.tone} data-testid={s.testId}>
                  {formatRupiah(s.value)}
                </Text>
                {s.hint && (
                  <Text fontSize="xs" color="fg.muted">
                    {s.hint}
                  </Text>
                )}
              </Stack>
            ))}
            <Stack gap="0">
              <Text fontSize="xs" color="fg.muted">
                {t("expenses.types.monthTotal")}
              </Text>
              <Text fontWeight="bold" fontSize="lg" data-testid="expenses-total">
                {formatRupiah(totals.total)}
              </Text>
              <Text fontSize="xs" color="fg.muted">
                {t("expenses.types.monthTotalHint")}
              </Text>
            </Stack>
          </SimpleGrid>

          <Separator />

          <SimpleGrid columns={totals.groups.length} gap="card">
            {totals.groups.map((g) => (
              <Stack key={g.kind} gap="1" minW="0" data-testid={`expenses-group-${g.kind}`}>
                <Text fontSize="xs" color="fg.muted">
                  {expenseKindLabel(t, g.kind)}
                </Text>
                <Text fontWeight="medium" data-testid={`expenses-total-kind-${g.kind}`}>
                  {formatRupiah(g.total)}
                </Text>
                <Stack gap="0.5" pt="1">
                  {g.lines.map((line) => (
                    <TypeLineRow key={line.typeId} group={g.kind} line={line} />
                  ))}
                </Stack>
              </Stack>
            ))}
          </SimpleGrid>
        </Stack>
      </Card.Body>
    </Card.Root>
  );
}

/** One type's line under its group — its words (and marks), its figure; a money-in figure in the success tone. */
function TypeLineRow({ group, line }: { group: ExpenseKind; line: TypeLine }) {
  const { t } = useTranslation();
  const def = typeDef(line.typeId);

  return (
    <Flex gap="2" align="start" fontSize="xs" data-testid={`expenses-total-type-${def ? def.key : `none-${group}`}`}>
      <HStack gap="1" flex="1" minW="0" wrap="wrap" color="fg.muted">
        <Text>{def ? typeLabel(t, def) : t("expenses.types.noType")}</Text>
        {def && <TypeMarks def={def} size="xs" />}
      </HStack>
      <Text whiteSpace="nowrap" color={line.total < 0 ? "success.fg" : undefined}>
        {formatRupiah(line.total)}
      </Text>
    </Flex>
  );
}

/** A phone's group — its figure on the line; a tap shows its types. */
function PhoneGroup({ group }: { group: GroupTotal }) {
  const { t } = useTranslation();

  return (
    <Collapsible.Root data-testid={`expenses-group-${group.kind}`}>
      <Collapsible.Trigger
        display="flex"
        alignItems="center"
        gap="2"
        w="full"
        cursor="pointer"
        disabled={group.lines.length === 0}
        css={{ "&[data-state=open] .group-chevron": { transform: "rotate(180deg)" } }}
        data-testid={`expenses-group-toggle-${group.kind}`}
      >
        <Text fontSize="sm">{expenseKindLabel(t, group.kind)}</Text>
        {group.lines.length > 0 && (
          <Icon as={ChevronDown} boxSize="4" color="fg.muted" className="group-chevron" transition="transform 120ms" />
        )}
        <Spacer />
        <Text fontSize="sm" whiteSpace="nowrap" data-testid={`expenses-total-kind-${group.kind}`}>
          {formatRupiah(group.total)}
        </Text>
      </Collapsible.Trigger>
      <Collapsible.Content>
        <Stack gap="1" ps="3" pt="1.5" pb="1">
          {group.lines.map((line) => (
            <TypeLineRow key={line.typeId} group={group.kind} line={line} />
          ))}
        </Stack>
      </Collapsible.Content>
    </Collapsible.Root>
  );
}


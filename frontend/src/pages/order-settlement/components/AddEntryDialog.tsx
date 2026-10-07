import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Box,
  Button,
  Dialog,
  Field,
  Flex,
  Icon,
  Portal,
  RadioCard,
  Select,
  SimpleGrid,
  Stack,
  Text,
  Textarea,
  createListCollection,
} from "@chakra-ui/react";
import { ArrowDownLeft, ArrowUpRight, Info, TriangleAlert } from "lucide-react";

import { CurrencyInput } from "../../../components/inputs/CurrencyInput";
import { DatePicker } from "../../../components/datetime/DatePicker";
import { formatRupiah } from "../../../lib/money";
import { manualTypesFor, type OrderSettlement, type PostingRole, type SettlementType } from "../model";

// ADDING AN ENTRY BY HAND — `context.md` §What Frontend Expected 1.
//
// ⚠ A PROTOTYPE. It hands a draft to its caller and writes nothing.
//
// ── This form is where two open questions become visible ────────────────────────────────────────
//
// It is a DIALOG rather than a page because it is a focused action, not a record to read (CLAUDE.md).
// Everything else about it is an argument about what a person should be allowed to do to a ledger
// that nothing can check afterwards:
//
//   1. **WHICH TYPES.** DECIDED, and it depends on the role AND on the account:
//      `initial-total-is-postable-by-cs-and-owners` lets root, admin, team_owner and CS author the
//      sale figure — but only when the account does not already hold one, because a second
//      `initial_total` ADDS rather than replaces and would double the sale. `manualTypesFor` is
//      where both halves are answered; this dialog only renders the answer.
//
//   2. **WHO.** DECIDED — `the-write-set-is-cs-and-up`. The dialog still does not gate itself: the
//      caller passes `canPost` for "may write at all" and `role` for "may write WHAT".
//
// ── The sign is a CHOICE, not a number ──────────────────────────────────────────────────────────
//
// `change` is signed, and a signed text field is how somebody eventually posts −45.000 meaning
// +45.000. So the amount is always positive and the DIRECTION is two radio cards: money that reached
// us, or money taken from us. The preview line underneath shows the signed figure that will actually
// be written, in words, before anybody presses the button.
//
// ── Chakra's own controls (owner, `the-add-entry-form-picks-with-chakra-controls`) ──────────────
//
// The type is Chakra's composable `Select` — a static, small list, so a plain list rather than a search
// — and the direction a `RadioCard` pair, its chosen card in the main tone like the submit
// (`a-chosen-option-is-in-the-main-tone`, set in theme.ts, not here).
export interface EntryDraft {
  settlementType: SettlementType;
  /** Signed, whole rupiah — direction already applied. */
  change: bigint;
  occurredOn: string;
  note: string;
}

export interface AddEntryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (draft: EntryDraft) => void;
  /** Today, as `yyyy-mm-dd`. Passed in so the story is deterministic. */
  today: string;
  /**
   * The account being posted to. Needed because the TYPE LIST depends on what it already holds —
   * `initial_total` disappears once a live one exists, whatever the role.
   */
  settlement: OrderSettlement;
  /** Who is posting. Decides whether the sale figure is offered at all. */
  role: PostingRole;
}

export function AddEntryDialog({
  open,
  onOpenChange,
  onSubmit,
  today,
  settlement,
  role,
}: AddEntryDialogProps) {
  const { t } = useTranslation();

  const types = manualTypesFor(role, settlement);
  // Keyed on the list's CONTENT: `manualTypesFor` hands back a new array every render.
  const typeKey = types.join(",");
  const typeCollection = useMemo(
    () =>
      createListCollection({
        items: types.map((type) => ({ value: type, label: t(`orderSettlement.type.${type}`) })),
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [typeKey, t],
  );
  const [settlementType, setSettlementType] = useState<SettlementType>("marketplace_adjustment");
  const [direction, setDirection] = useState<"in" | "out">("out");
  const [amount, setAmount] = useState("");
  const [occurredOn, setOccurredOn] = useState(today);
  const [note, setNote] = useState("");

  const magnitude = amount === "" ? 0n : BigInt(amount);
  const change = direction === "in" ? magnitude : -magnitude;
  const valid = magnitude > 0n && occurredOn !== "";

  function reset() {
    setSettlementType("marketplace_adjustment");
    setDirection("out");
    setAmount("");
    setOccurredOn(today);
    setNote("");
  }

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(e) => {
        onOpenChange(e.open);
        if (!e.open) reset();
      }}
    >
      <Portal>
        <Dialog.Backdrop />
        <Dialog.Positioner>
          <Dialog.Content data-testid="add-entry-dialog">
            <Dialog.Header>
              {/* Title Case — CLAUDE.md. */}
              <Dialog.Title>{t("orderSettlement.addDialogTitle")}</Dialog.Title>
            </Dialog.Header>

            <Dialog.Body>
              <Stack gap="field">
                <Field.Root>
                  <Field.Label>{t("orderSettlement.field.type")}</Field.Label>
                  <Select.Root
                    collection={typeCollection}
                    value={[settlementType]}
                    onValueChange={(e) => {
                      const picked = e.value[0];
                      if (picked) setSettlementType(picked as SettlementType);
                    }}
                  >
                    <Select.HiddenSelect />
                    <Select.Control>
                      <Select.Trigger data-testid="entry-type">
                        <Select.ValueText />
                      </Select.Trigger>
                      <Select.IndicatorGroup>
                        <Select.Indicator />
                      </Select.IndicatorGroup>
                    </Select.Control>
                    {/* No Portal: a portalled listbox renders OUTSIDE this modal, where the dialog makes
                        it inert — the same reason as MarketplaceSelect. */}
                    <Select.Positioner>
                      <Select.Content>
                        {/* ⚠ `initial_total` appears here ONLY for a role that may author the sale
                            AND on an account that has none — see `manualTypesFor`. */}
                        {typeCollection.items.map((item) => (
                          <Select.Item item={item} key={item.value} data-testid={`entry-type-option-${item.value}`}>
                            <Select.ItemText>{item.label}</Select.ItemText>
                            <Select.ItemIndicator />
                          </Select.Item>
                        ))}
                      </Select.Content>
                    </Select.Positioner>
                  </Select.Root>
                </Field.Root>

                <Field.Root>
                  <Field.Label>{t("orderSettlement.field.direction")}</Field.Label>
                  {/* Two cards side by side, each the whole width of its half — a target a thumb finds
                      on a phone, with the arrow saying which way before the words do. */}
                  <RadioCard.Root
                    size="sm"
                    w="full"
                    value={direction}
                    onValueChange={(e) => e.value && setDirection(e.value as "in" | "out")}
                    aria-label={t("orderSettlement.field.direction")}
                  >
                    <SimpleGrid columns={2} gap="2">
                      {(["in", "out"] as const).map((d) => (
                        <RadioCard.Item key={d} value={d} data-testid={`direction-${d}`}>
                          <RadioCard.ItemHiddenInput />
                          <RadioCard.ItemControl alignItems="center">
                            <Icon as={d === "in" ? ArrowDownLeft : ArrowUpRight} boxSize="4" color="fg.muted" />
                            <RadioCard.ItemContent>
                              <RadioCard.ItemText>
                                {t(d === "in" ? "orderSettlement.directionIn" : "orderSettlement.directionOut")}
                              </RadioCard.ItemText>
                            </RadioCard.ItemContent>
                            <RadioCard.ItemIndicator />
                          </RadioCard.ItemControl>
                        </RadioCard.Item>
                      ))}
                    </SimpleGrid>
                  </RadioCard.Root>
                </Field.Root>

                <Field.Root>
                  <Field.Label>{t("orderSettlement.field.amount")}</Field.Label>
                  <CurrencyInput
                    value={amount}
                    onChange={setAmount}
                    data-testid="entry-amount"
                    aria-label={t("orderSettlement.field.amount")}
                  />
                </Field.Root>

                <Field.Root>
                  <Field.Label>{t("orderSettlement.field.occurredOn")}</Field.Label>
                  <DatePicker value={occurredOn} onChange={setOccurredOn} testId="entry-date" />
                  {/* `two-dates-occurred-and-posted` — the person supplies the day it BELONGS to;
                      `posted_on` is stamped by the server. Saying so is the only way the two stay
                      distinguishable when a person is backdating a fee they just found out about. */}
                  <Field.HelperText>{t("orderSettlement.occurredHelp")}</Field.HelperText>
                </Field.Root>

                <Field.Root>
                  <Field.Label>{t("orderSettlement.field.note")}</Field.Label>
                  {/* A TEXTAREA (owner): a note says why a fee was charged, which is a sentence, not a
                      word — three rows, and it grows by hand if the reason runs longer. */}
                  <Textarea
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    maxLength={200}
                    rows={3}
                    resize="vertical"
                    data-testid="entry-note"
                  />
                </Field.Root>

                {/* The signed figure, in words, before it is written. */}
                <Box
                  borderWidth="1px"
                  borderRadius="md"
                  p="card"
                  data-testid="entry-preview"
                  aria-live="polite"
                >
                  <Text fontSize="sm">
                    {t(
                      direction === "in"
                        ? "orderSettlement.previewIn"
                        : "orderSettlement.previewOut",
                      { amount: formatRupiah(magnitude) },
                    )}
                  </Text>

                  {/* THE SALE FIGURE GETS ITS OWN WARNING, and it is the loudest thing on the form.
                      Every other type is one line in a long account; this one is the DENOMINATOR —
                      it moves the loss, the margin and the take rate on every screen at once, and
                      `a-correction-is-a-new-row` means it can only ever be offset, never removed. */}
                  {settlementType === "initial_total" && (
                    <Flex align="center" gap="2" mt="2" data-testid="initial-total-warning">
                      <Icon as={TriangleAlert} boxSize="3" color="fg.error" />
                      <Text fontSize="xs" color="fg.error">
                        {t("orderSettlement.initialTotalWarning")}
                      </Text>
                    </Flex>
                  )}
                  <Flex align="center" gap="2" mt="1">
                    <Icon as={Info} boxSize="3" color="fg.muted" />
                    {/* Append-only, said at the moment it matters — not only in a notice below the
                        table that nobody reads before typing. */}
                    <Text fontSize="xs" color="fg.muted">
                      {t("orderSettlement.addDialogWarning")}
                    </Text>
                  </Flex>
                </Box>
              </Stack>
            </Dialog.Body>

            <Dialog.Footer>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                {t("common.cancel")}
              </Button>
              {/* The dialog's one action in the main tone, like every other form's submit (owner). */}
              <Button
                colorPalette="brand"
                disabled={!valid}
                onClick={() => {
                  onSubmit({ settlementType, change, occurredOn, note });
                  onOpenChange(false);
                  reset();
                }}
                data-testid="entry-submit"
              >
                {t("orderSettlement.addDialogConfirm")}
              </Button>
            </Dialog.Footer>
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  );
}

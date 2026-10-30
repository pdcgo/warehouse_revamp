import type { ReactNode } from "react";
import { Button, Card, Field, Flex, Icon, SimpleGrid, Stack, Text, Textarea } from "@chakra-ui/react";
import { useTranslation } from "react-i18next";
import { TriangleAlert } from "lucide-react";

// THE LAST THING YOU WRITE, AND THE BUTTON YOU PRESS AFTER IT (owner).
//
// The note and the exits were two cards; they are one, because they are one moment. The note is what
// is remembered last — the customer's parting instruction, the thing the packer has to know — and
// Create is what happens immediately after. A card boundary between them made the note look like one
// more field to fill rather than the final word before the order goes.
//
// ⚠ THE NOTE COMES FIRST. Under the buttons it would be a field placed after a submit, which is a
// field people do not fill in.
//
// It lives at the foot of the STICKY rail, so both stay reachable while a long list of products
// scrolls past — see the note where it is mounted.

interface NoteAndSubmitCardProps {
  note: string;
  onNoteChange: (value: string) => void;
  /** How many of the order's cross-team products still have no return mapping. */
  unmappedReturns: number;
  compact?: boolean;
  /** Create is a SUBMIT — the form around it owns the handler (see the page). */
  canSave: boolean;
  saving: boolean;
  // ⚠ CREATE ALONE — no Save as Draft, because a person never drafts (a-draft-becomes-an-order-through-order-create),
  // and a draft is finished on this same form (the-draft-opens-in-the-order-form), so there is no Promote either.
  /** A ⚠ beside the note's title — on a draft, the note is not stored. */
  noteMark?: ReactNode;
  /** Under the buttons — on a draft, what still stands between it and an order. */
  footer?: ReactNode;
}

export function NoteAndSubmitCard({
  note,
  onNoteChange,
  unmappedReturns,
  compact,
  canSave,
  saving,
  noteMark,
  footer,
}: NoteAndSubmitCardProps) {
  const { t } = useTranslation();

  return (
    <Card.Root>
      <Card.Header pb={compact ? "0" : undefined}>
        <Flex align="center" gap="2">
          <Card.Title>{t("orders.note")}</Card.Title>
          {noteMark}
        </Flex>
        {!compact && <Card.Description>{t("orders.noteHelp")}</Card.Description>}
      </Card.Header>

      <Card.Body pt={compact ? "3" : undefined} pb={compact ? "3" : undefined}>
        <Stack gap="card">
          <Field.Root>
            <Textarea
              rows={compact ? 2 : 3}
              maxLength={2000}
              value={note}
              placeholder={t("orders.notePlaceholder")}
              aria-label={t("orders.note")}
              data-testid="order-create-note"
              onChange={(e) => onNoteChange(e.target.value)}
            />
          </Field.Root>

          <Stack gap="2">
            <SimpleGrid columns={1} gap="2">
              {/* ⚠ A SUBMIT, not a click handler: the page wraps this card in its <form>, so Enter in
                  any field places the order the same way this button does. */}
              <Button
                type="submit"
                w="full"
                colorPalette="brand"
                loading={saving}
                disabled={!canSave}
                data-testid="order-create-save"
              >
                {t("orders.createOrder")}
              </Button>
            </SimpleGrid>

            {/* ⚠ THE UNANSWERED RETURN MAPPINGS, NAMED HERE — the owner's "if they do not choose,
                how do we know?". The mapping card can be a screen away on a long order, so the rule
                that would refuse this order is stated where the refusal happens. */}
            {unmappedReturns > 0 && (
              <Flex align="center" gap="2">
                <Icon as={TriangleAlert} boxSize="4" color="warning.fg" />
                <Text fontSize="xs" color="warning.fg" data-testid="order-create-blocked-mapping">
                  {t("orderForm.totals.blockedByMapping", { count: unmappedReturns })}
                </Text>
              </Flex>
            )}

            {footer}
          </Stack>
        </Stack>
      </Card.Body>
    </Card.Root>
  );
}

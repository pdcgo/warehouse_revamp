import { Field, Flex, Input, Stack, Text } from "@chakra-ui/react";
import { useTranslation } from "react-i18next";

import { CurrencyInput } from "../../../components/inputs/CurrencyInput";

// THE COURIER'S CHARGE AT THE DOOR — one amount and one note per restock (the-courier-is-paid-once-per-restock).
//
// The warehouse pays it on the spot and the selling team owes it back
// (the-warehouse-cost-is-the-couriers-charge-at-the-door), so it is entered here and nowhere else. The note is REQUIRED
// once the amount is above 0 — every incidental cost says what it was for — and the field says so the moment the
// amount is typed, rather than after a full count when Accept would not press.
//
// It is NOT part of the restock's total (the-couriers-charge-stays-out-of-total): the summary shows it on its own line,
// owed by the selling team. It IS in the unit price, so every HPP on the page moves as it is typed.
export function CourierCharge({
  amount,
  note,
  charged,
  noteMissing,
  onAmount,
  onNote,
}: {
  amount: string;
  note: string;
  /** The amount is above 0 — which is when the note becomes required. */
  charged: boolean;
  noteMissing: boolean;
  onAmount: (value: string) => void;
  onNote: (value: string) => void;
}) {
  const { t } = useTranslation();

  return (
    <Stack gap="field" data-testid="accept-courier">
      <Stack gap="0.5">
        <Text fontWeight="bold">{t("restock.accept.courier.title")}</Text>
        <Text fontSize="xs" color="fg.muted">
          {t("restock.accept.courier.hint")}
        </Text>
      </Stack>

      <Flex gap="field" wrap="wrap" align="flex-start">
        <Field.Root maxW={{ base: "full", md: "14rem" }}>
          <Field.Label>{t("restock.accept.courier.amount")}</Field.Label>
          <CurrencyInput value={amount} onChange={onAmount} data-testid="accept-courier-charge" />
        </Field.Root>

        <Field.Root required={charged} invalid={noteMissing} flex="1" minW={{ base: "full", md: "16rem" }} maxW="32rem">
          <Field.Label>
            {t("restock.accept.courier.note")}
            <Field.RequiredIndicator />
          </Field.Label>
          <Input
            value={note}
            maxLength={200}
            placeholder={t("restock.accept.courier.notePlaceholder")}
            data-testid="accept-courier-note"
            onChange={(e) => onNote(e.target.value)}
          />
          {noteMissing && (
            <Field.ErrorText data-testid="accept-courier-note-error">
              {t("restock.accept.courier.noteRequired")}
            </Field.ErrorText>
          )}
        </Field.Root>
      </Flex>
    </Stack>
  );
}

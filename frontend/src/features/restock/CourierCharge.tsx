import type { ReactNode } from "react";
import { Field, Flex, HStack, Input, Stack, Text } from "@chakra-ui/react";
import { useTranslation } from "react-i18next";

import { CurrencyInput } from "../../components/inputs/CurrencyInput";
import { PhotoPick } from "./PhotoPick";

// THE COURIER'S CHARGE AT THE DOOR — one amount and one note per restock (the-courier-is-paid-once-per-restock).
//
// The warehouse pays it on the spot and the selling team owes it back
// (the-warehouse-cost-is-the-couriers-charge-at-the-door). It is entered at EITHER of the warehouse's two acts
// (the-cod-can-be-noted-when-the-box-arrives): noted at Tandai Tiba, when the courier asks for it, and final at Terima —
// so it lives here, in the domain, and both the sign dialog and the accept page draw it. The note is REQUIRED once the
// amount is above 0 — every incidental cost says what it was for — and the field says so the moment the amount is typed,
// rather than when the button will not press.
//
// It is NOT part of the restock's total (the-couriers-charge-stays-out-of-total): the summary shows it on its own line,
// owed by the selling team. It IS in the unit price, so every HPP on the accept page moves as it is typed.
//
// A PHOTO OF THE COURIER'S SLIP, optional (owner: *"kurasa masuk akal kalau opsional"*,
// the-courier-slip-has-an-optional-photo) — under the amount and the note, at both acts. ⚠ Not kept (PhotoPick).
export function CourierCharge({
  amount,
  note,
  charged,
  noteMissing,
  onAmount,
  onNote,
  photo = null,
  onPhoto,
  photoMark,
  hint,
  mark,
  testId = "accept-courier",
}: {
  amount: string;
  note: string;
  /** The amount is above 0 — which is when the note becomes required. */
  charged: boolean;
  noteMissing: boolean;
  onAmount: (value: string) => void;
  onNote: (value: string) => void;
  /** The slip's photo — shown only where `onPhoto` is given. */
  photo?: File | null;
  onPhoto?: (file: File | null) => void;
  /** A pending mark beside the photo, where the charge itself IS kept but the photo is not. */
  photoMark?: ReactNode;
  /** What this act means for the charge — the accept page's by default. */
  hint?: string;
  /** A pending mark beside the title, where the charge is not kept yet. */
  mark?: ReactNode;
  /** Prefix for the test ids: `<testId>`, `<testId>-charge`, `<testId>-note`, `<testId>-note-error`, `<testId>-photo`. */
  testId?: string;
}) {
  const { t } = useTranslation();

  return (
    <Stack gap="field" data-testid={testId}>
      <Stack gap="0.5">
        <HStack gap="1.5">
          <Text fontWeight="bold">{t("restock.accept.courier.title")}</Text>
          {mark}
        </HStack>
        <Text fontSize="xs" color="fg.muted">
          {hint ?? t("restock.accept.courier.hint")}
        </Text>
      </Stack>

      <Flex gap="field" wrap="wrap" align="flex-start">
        <Field.Root maxW={{ base: "full", md: "14rem" }}>
          <Field.Label>{t("restock.accept.courier.amount")}</Field.Label>
          <CurrencyInput value={amount} onChange={onAmount} data-testid={`${testId}-charge`} />
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
            data-testid={`${testId}-note`}
            onChange={(e) => onNote(e.target.value)}
          />
          {noteMissing && (
            <Field.ErrorText data-testid={`${testId}-note-error`}>
              {t("restock.accept.courier.noteRequired")}
            </Field.ErrorText>
          )}
        </Field.Root>
      </Flex>

      {onPhoto && (
        <Field.Root>
          <Field.Label>{t("restock.accept.courier.photo")}</Field.Label>
          <PhotoPick
            file={photo}
            onChange={onPhoto}
            alt={t("restock.accept.courier.photoAlt")}
            mark={photoMark}
            testId={`${testId}-photo`}
          />
        </Field.Root>
      )}
    </Stack>
  );
}

import type { ReactNode } from "react";
import { Field, Flex, HStack, Stack, Text, Textarea } from "@chakra-ui/react";
import { useTranslation } from "react-i18next";

import { CurrencyInput } from "../../components/inputs/CurrencyInput";
import { RadioPills } from "../../components/inputs/RadioPills";
import { PhotoPick } from "./PhotoPick";

/** The longest the charge's note may be — the contract's `max_len` (`warehouse_additional_cost_note`). */
const MAX_CHARGE_NOTE = 200;

// THE COURIER'S CHARGE AT THE DOOR — one amount and one note per restock (the-courier-is-paid-once-per-restock).
//
// The warehouse pays it on the spot and the selling team owes it back
// (the-warehouse-cost-is-the-couriers-charge-at-the-door). It is entered at EITHER of the warehouse's two acts
// (the-cod-can-be-noted-when-the-box-arrives): noted at Tandai Tiba, when the courier asks for it, and final at Terima —
// so it lives here, in the domain, and both the sign dialog and the accept page draw it.
//
// ASKED FIRST, THEN FILLED (owner: *"default formnya ongkir dsb itu disabled, baru enabled saat interaksi tertentu"*,
// the-charge-is-asked-for-before-it-is-filled) — a RADIO PILL, the owner's pick over a tick (*"desain kurir meminta ongkir
// di tandai tiba aku belum suka"*), as every choice in a dialog is (a-dialog-choice-is-a-radio-pill):
//
//   Ongkir COD dari kurir
//   (• Tidak ada) (  Ada  )                ← the default: nothing to fill, nothing checked, nothing sent
//   (  Tidak ada) (• Ada  )
//     Jumlah *  [ Rp 15.000 ]   Untuk apa *  [ biaya COD … ] 0/200   Foto nota (opsional) [📷]
//
// The fields are HIDDEN until Ada, not disabled: the dialog is narrow, and a disabled field still reads as something to
// fill. On Ada, the amount and the note are REQUIRED — the person has said there was a charge; the photo stays optional.
// The note is a textarea (owner: *"catatannya textarea"*): what the charge was for is a sentence, not a word.
//
// It is NOT part of the restock's total (the-couriers-charge-stays-out-of-total): the summary shows it on its own line,
// owed by the selling team. It IS in the unit price, so every HPP on the accept page moves as it is typed.
//
// A PHOTO OF THE COURIER'S SLIP, optional (owner: *"kurasa masuk akal kalau opsional"*,
// the-courier-slip-has-an-optional-photo) — under the amount and the note, at both acts. ⚠ Not kept (PhotoPick).
export function CourierCharge({
  asked,
  onAsked,
  amount,
  note,
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
  /** The courier asked for a charge — Ada, which reveals the fields. */
  asked: boolean;
  onAsked: (asked: boolean) => void;
  amount: string;
  note: string;
  /** Say under the note that it is missing — the caller decides when (once there is an amount). */
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
  /**
   * Prefix for the test ids: `<testId>`, `<testId>-asked` (the pills), `<testId>-asked-none`, `<testId>-asked-yes`,
   * `<testId>-charge`, `<testId>-note`, `<testId>-note-count`, `<testId>-note-error`, `<testId>-photo`.
   */
  testId?: string;
}) {
  const { t } = useTranslation();

  return (
    <Stack gap="field" data-testid={testId}>
      <Stack gap="0.5">
        <HStack gap="1.5" wrap="wrap">
          <Text fontWeight="bold">{t("restock.accept.courier.title")}</Text>
          {mark}
        </HStack>
        <Text fontSize="xs" color="fg.muted">
          {hint ?? t("restock.accept.courier.hint")}
        </Text>
      </Stack>

      {/* A RADIO PILL, as every choice in a dialog is (a-dialog-choice-is-a-radio-pill) — "none" is the default. */}
      <RadioPills<"none" | "asked">
        value={asked ? "asked" : "none"}
        onChange={(value) => onAsked(value === "asked")}
        ariaLabel={t("restock.accept.courier.title")}
        testId={`${testId}-asked`}
        options={[
          { value: "none", label: t("restock.accept.courier.askedNone"), testId: `${testId}-asked-none` },
          { value: "asked", label: t("restock.accept.courier.askedYes"), testId: `${testId}-asked-yes` },
        ]}
      />

      {asked && (
        <>
          <Flex gap="field" wrap="wrap" align="flex-start">
            <Field.Root required maxW={{ base: "full", md: "14rem" }}>
              <Field.Label>
                {t("restock.accept.courier.amount")}
                <Field.RequiredIndicator />
              </Field.Label>
              <CurrencyInput value={amount} onChange={onAmount} data-testid={`${testId}-charge`} />
            </Field.Root>

            <Field.Root required invalid={noteMissing} flex="1" minW={{ base: "full", md: "16rem" }} maxW="32rem">
              <Field.Label>
                {t("restock.accept.courier.note")}
                <Field.RequiredIndicator />
              </Field.Label>
              <Textarea
                value={note}
                maxLength={MAX_CHARGE_NOTE}
                rows={2}
                autoresize
                placeholder={t("restock.accept.courier.notePlaceholder")}
                data-testid={`${testId}-note`}
                onChange={(e) => onNote(e.target.value)}
              />
              {noteMissing ? (
                <Field.ErrorText data-testid={`${testId}-note-error`}>
                  {t("restock.accept.courier.noteRequired")}
                </Field.ErrorText>
              ) : (
                // How much of the limit is used (a-limited-field-shows-its-count).
                <Field.HelperText alignSelf="end" data-testid={`${testId}-note-count`}>
                  {note.length}/{MAX_CHARGE_NOTE}
                </Field.HelperText>
              )}
            </Field.Root>
          </Flex>

          {onPhoto && (
            <Field.Root>
              <Field.Label>
                {t("restock.accept.courier.photo")}{" "}
                <Text as="span" color="fg.subtle" fontWeight="normal">
                  {t("restock.accept.courier.optional")}
                </Text>
              </Field.Label>
              <PhotoPick
                file={photo}
                onChange={onPhoto}
                alt={t("restock.accept.courier.photoAlt")}
                mark={photoMark}
                testId={`${testId}-photo`}
              />
            </Field.Root>
          )}
        </>
      )}
    </Stack>
  );
}

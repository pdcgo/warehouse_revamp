import { useState } from "react";
import type { ReactNode } from "react";
import { Button, Flex, HStack, Icon, Spacer, Stack, Text } from "@chakra-ui/react";
import { useTranslation } from "react-i18next";
import { Check, Pencil } from "lucide-react";

import { CourierCharge } from "../../../features/restock/CourierCharge";
import { formatRupiahNumber } from "../../../lib/money";

// THE COURIER'S COD CHARGE ON TERIMA — WHAT WAS PAID, AS TEXT; CHANGED ON ASKING (owner: *"di paket ongkir hilangkan, di
// section ongkir cod dari kurir kasih teks keterangan berapa yang dibayarkan, nanti ada interaksi untuk bisa
// mengubahnya"*, the-cod-paid-is-said-in-its-own-section):
//
//   Ongkir COD dari kurir ⚠3                                      [✎ Ubah]
//   Dibayar gudang Rp 15.000
//   Biaya COD · diganti oleh Toko Melati
//
//   — or, with none —   Tidak ada ongkir COD yang dibayar gudang.
//
// Ubah opens the charge's form (CourierCharge — asked first, then filled) with what is there: a charge set at Tandai Tiba
// opens in it, so nothing is typed twice (terima-starts-from-the-charge-noted-at-tiba). Selesai folds it back to the text,
// once what it asks is complete; Terima sends whatever is in it either way.
export function ChargeSection({
  asked,
  onAsked,
  amount,
  charge,
  note,
  noteMissing,
  onAmount,
  onNote,
  photo,
  onPhoto,
  team,
  mark,
  photoMark,
}: {
  asked: boolean;
  onAsked: (asked: boolean) => void;
  /** What is typed, as digits. */
  amount: string;
  /** The charge it comes to — 0 when none. */
  charge: number;
  note: string;
  noteMissing: boolean;
  onAmount: (value: string) => void;
  onNote: (value: string) => void;
  photo: File | null;
  onPhoto: (file: File | null) => void;
  /** The selling team that owes it back. */
  team: string;
  mark?: ReactNode;
  photoMark?: ReactNode;
}) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  // Ada with an amount and its note, or Tidak ada — anything else is still being filled, and the form stays open.
  const complete = !asked || (charge > 0 && note.trim() !== "");

  if (editing) {
    return (
      <Stack gap="field">
        <CourierCharge
          asked={asked}
          onAsked={onAsked}
          amount={amount}
          note={note}
          noteMissing={noteMissing}
          onAmount={onAmount}
          onNote={onNote}
          photo={photo}
          onPhoto={onPhoto}
          mark={mark}
          photoMark={photoMark}
        />
        <Button
          size="xs"
          variant="outline"
          alignSelf="flex-end"
          disabled={!complete}
          data-testid="accept-courier-done"
          onClick={() => setEditing(false)}
        >
          <Icon as={Check} boxSize="4" />
          {t("restock.accept.courier.done")}
        </Button>
      </Stack>
    );
  }

  const paid = asked && charge > 0;

  return (
    <Stack gap="field" data-testid="accept-courier">
      {/* No hint here (owner: *"teksnya kepanjangan"*): the text under the title already says who paid and who owes it. */}
      <Flex align="center" gap="1.5">
        <Text fontWeight="bold">{t("restock.accept.courier.title")}</Text>
        {mark}
        <Spacer />
        <Button size="xs" variant="ghost" flexShrink={0} data-testid="accept-courier-edit" onClick={() => setEditing(true)}>
          <Icon as={Pencil} boxSize="3.5" />
          {t("restock.accept.courier.edit")}
        </Button>
      </Flex>

      {paid ? (
        <Stack gap="0.5" data-testid="accept-courier-paid">
          <HStack gap="1.5" wrap="wrap">
            <Text fontSize="sm">{t("restock.accept.courier.paidBy")}</Text>
            <Text fontSize="lg" fontWeight="bold" whiteSpace="nowrap" data-testid="accept-courier-owed">
              {formatRupiahNumber(charge)}
            </Text>
          </HStack>
          <Text fontSize="xs" color="fg.muted" data-testid="accept-courier-paid-line">
            {note.trim() !== ""
              ? t("restock.accept.courier.paidLine", { note: note.trim(), team })
              : t("restock.accept.courier.owedBy", { team })}
          </Text>
        </Stack>
      ) : (
        <Text fontSize="sm" color="fg.muted" data-testid="accept-courier-none">
          {t("restock.accept.courier.none")}
        </Text>
      )}
    </Stack>
  );
}

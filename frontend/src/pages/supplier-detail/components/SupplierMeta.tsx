import { useTranslation } from "react-i18next";
import { Flex, HStack, Icon, Stack, Text } from "@chakra-ui/react";
import { MapPin, Phone } from "lucide-react";

import { CopyText } from "../../../components/chrome/CopyText";
import type { SupplierRecord } from "../../../features/suppliers/adapt";

// WHO THE SUPPLIER IS, UNDER ITS NAME (owner: *"aku tidak mau detailnya seperti kontak, alamat seperti statistik"* —
// tried beside the tabs, *"terlalu sedikit ternyata, kalau gitu ganti A"*, `the-supplier-is-described-under-its-name`).
// Its identity, not a figure: a line of icons and words, then its note — no card, no uppercase label over a value as
// the figures' cards have. The contact copies with one click — it is what somebody opens the page to find.
//
//   PT Sumber Makmur                                  [✎ Ubah] [🗑 Hapus]
//   ☎ 0812-1111-2222 ⧉    📍 Jl. Soekarno-Hatta 112, Bandung
//   Grosir kain dan benang, minimal order 1 rol.          ← muted: the supplier's own note
//
// A field left empty is left out — a supplier with nothing but a name shows its name.
export function SupplierMeta({ supplier }: { supplier: SupplierRecord }) {
  const { t } = useTranslation();

  if (!supplier.contact && !supplier.address && !supplier.description) {
    return null;
  }

  return (
    <Stack gap="1" data-testid="supplier-meta">
      {(supplier.contact || supplier.address) && (
        <Flex gap="1.5" columnGap="5" wrap="wrap" align="center">
          {supplier.contact && (
            <HStack gap="1.5" minW="0">
              <Icon as={Phone} boxSize="4" color="fg.muted" flexShrink={0} aria-label={t("supplierChannel.detail.contact")} role="img" />
              <CopyText value={supplier.contact} fontSize="sm" testId="supplier-detail-contact" />
            </HStack>
          )}
          {supplier.address && (
            <HStack gap="1.5" minW="0" align="start">
              <Icon as={MapPin} boxSize="4" color="fg.muted" flexShrink={0} mt="0.5" aria-label={t("supplierChannel.detail.address")} role="img" />
              <Text fontSize="sm" data-testid="supplier-detail-address">
                {supplier.address}
              </Text>
            </HStack>
          )}
        </Flex>
      )}

      {supplier.description && (
        <Text fontSize="sm" color="fg.muted" whiteSpace="pre-line" data-testid="supplier-detail-description">
          {supplier.description}
        </Text>
      )}
    </Stack>
  );
}

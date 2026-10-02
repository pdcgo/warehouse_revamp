import { Badge, HStack, Stack, Text } from "@chakra-ui/react";
import { useTranslation } from "react-i18next";

// THE PRODUCT AS THE MARKETPLACE NAMED IT — above our product, the way the order draft shows it
// (owner: *"di draft itu ada teks khusus untuk nama produknya, jadi teks itu harusnya juga tampil di
// sini"*).
//
// ⚠ THE SAME PRESENTATION AS THE DRAFT, ON PURPOSE: the same "Hasil pindaian" badge, the external SKU
// beside it, the title under. Somebody who mapped the line on the draft recognises it here as the
// same evidence rather than a new fact — and the reason it is on screen at all is the comparison it
// allows. A marketplace title that reads nothing like our product name is what a wrong mapping looks
// like, and the picker is the last person who can catch it.
//
// ⚠ NOTHING WHEN THERE IS NONE, unlike the draft's "no scraped name". A draft is BY DEFINITION a
// scrape, so an empty title there is an anomaly worth a sentence; an order is often typed by hand,
// and a "no marketplace title" line on every such order would be noise on the normal case.
export function ScrapedName({ evidence }: { evidence?: { name: string; sku: string } }) {
  const { t } = useTranslation();

  if (!evidence) {
    return null;
  }

  return (
    <Stack gap="0.5" mb="2" data-testid="order-item-scraped">
      <HStack gap="2">
        <Badge size="xs" colorPalette="gray">
          {t("orderDrafts.scraped")}
        </Badge>
        {evidence.sku && (
          <Text fontSize="xs" color="fg.muted">
            {evidence.sku}
          </Text>
        )}
      </HStack>
      <Text fontSize="sm" lineClamp={2}>
        {evidence.name}
      </Text>
    </Stack>
  );
}

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Badge, Box, Button, CloseButton, Dialog, HStack, Icon, Image, Portal, Stack, Table, Text, Tooltip } from "@chakra-ui/react";
import { Package } from "lucide-react";

import type { SampleDerived } from "./derivedSample";

// A ROW LIGHTS UP under the pointer, every cell of it (a-table-row-lights-up).
const LIGHTS_UP = { _hover: { "& > td": { bg: "bg.muted" } } } as const;

// PRODUK TURUNAN — the link a RETURN TO ANOTHER TEAM makes between two products (owner: *"barang yang retur ke team beda
// team"*), shown BOTH WAYS, because the product on screen can be either end of it (owner: *"bisa jadi yang sekarang itu
// juga turunan"*):
//
//   Turunan dari   the product this one came from, in another team — at most one, one line
//   Turunannya     the products other teams made of this one through a return — any number
//
// ⚠ THERE CAN BE MANY (owner: *"dia bisa banyak, design sekarang kalau kepanjangan membingungkan"*), and a side card that
// grows a block per return stops being readable. So the card holds the COUNT, the first few as ONE LINE each — the team,
// the SKU and its READY STOCK as just "N pcs", what the number is said by a tooltip (owner: *"tidak perlu dikasih
// tanggal"*, *"pcs stok readynya bukan diretur sejumlah"*, then *"cuma pcs aja di produk turunan, siapnya jadi tooltip
// aja"*) — and "Lihat Semua" opens the whole list in a dialog, as a table with the derived product's name and SKU.
// ⚠ The rows are SAMPLES until the link exists (each page's pending.ts `derived`).
//
// The product's own page and its discover detail both (owner: *"produk turunan juga ditampilkan"*,
// the-discover-detail-shows-no-markup) — the body of the section card each page draws.

/** How many the card shows before "see all". */
const IN_CARD = 3;

/** One derived product as a single line — which team, its SKU, its stock ready. */
function DerivedLine({ item, testId }: { item: SampleDerived; testId: string }) {
  const { t } = useTranslation();

  return (
    <HStack justify="space-between" gap="2" py="1.5" borderBottomWidth="1px" borderColor="border.muted" minW="0" data-testid={testId}>
      <HStack gap="2" minW="0">
        <Badge size="sm" colorPalette="gray" flexShrink={0}>
          {item.teamName}
        </Badge>
        <Text fontSize="xs" color="fg.muted" truncate title={item.sku}>
          {item.sku}
        </Text>
      </HStack>
      <Tooltip.Root openDelay={100} closeDelay={80}>
        <Tooltip.Trigger asChild>
          <Text
            fontSize="xs"
            color="fg.muted"
            flexShrink={0}
            aria-label={t("products.detail.derived.ready", { n: item.readyQty })}
            data-testid={`${testId}-pcs`}
          >
            {t("products.stat.pcs", { n: item.readyQty })}
          </Text>
        </Tooltip.Trigger>
        <Portal>
          <Tooltip.Positioner>
            <Tooltip.Content>{t("products.detail.derived.units")}</Tooltip.Content>
          </Tooltip.Positioner>
        </Portal>
      </Tooltip.Root>
    </HStack>
  );
}

export function DerivedSection({ derived }: { derived: { from?: SampleDerived; to: SampleDerived[] } }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const rest = derived.to.length - IN_CARD;

  return (
    <Stack gap="card">
      <Stack gap="1" data-testid="pd-derived-from">
        <Text fontSize="xs" fontWeight="bold" color="fg.label">
          {t("products.detail.derived.from")}
        </Text>
        {derived.from ? (
          <DerivedLine item={derived.from} testId="pd-derived-from-item" />
        ) : (
          <Text fontSize="sm" color="fg.muted">
            {t("products.detail.derived.fromNone")}
          </Text>
        )}
      </Stack>

      <Stack gap="1" data-testid="pd-derived-to">
        <HStack justify="space-between">
          <Text fontSize="xs" fontWeight="bold" color="fg.label">
            {t("products.detail.derived.to")}
          </Text>
          <Badge size="sm" variant="subtle" data-testid="pd-derived-count">
            {derived.to.length}
          </Badge>
        </HStack>
        {derived.to.length === 0 ? (
          <Text fontSize="sm" color="fg.muted">
            {t("products.detail.derived.toNone")}
          </Text>
        ) : (
          <Box>
            {derived.to.slice(0, IN_CARD).map((item, i) => (
              <DerivedLine key={i} item={item} testId={`pd-derived-to-${i}`} />
            ))}
          </Box>
        )}

        {rest > 0 && (
          <Dialog.Root open={open} onOpenChange={(e) => setOpen(e.open)} size="lg" scrollBehavior="inside">
            <Dialog.Trigger asChild>
              <Button size="xs" variant="ghost" alignSelf="flex-start" data-testid="pd-derived-see-all">
                {t("products.detail.derived.seeAll", { count: derived.to.length })}
              </Button>
            </Dialog.Trigger>
            <Portal>
              <Dialog.Backdrop />
              <Dialog.Positioner>
                <Dialog.Content data-testid="pd-derived-dialog">
                  <Dialog.Header>
                    <Dialog.Title>{t("products.detail.section.derived")}</Dialog.Title>
                  </Dialog.Header>
                  <Dialog.Body>
                    <Table.Root size="sm" data-testid="pd-derived-table">
                      <Table.Header>
                        <Table.Row>
                          <Table.ColumnHeader>{t("products.detail.derived.product")}</Table.ColumnHeader>
                          <Table.ColumnHeader>{t("products.detail.derived.team")}</Table.ColumnHeader>
                          <Table.ColumnHeader textAlign="end">{t("products.detail.derived.units")}</Table.ColumnHeader>
                        </Table.Row>
                      </Table.Header>
                      <Table.Body>
                        {derived.to.map((item, i) => (
                          <Table.Row key={i} css={LIGHTS_UP} data-testid={`pd-derived-row-${i}`}>
                            <Table.Cell>
                              {/* WITH ITS PICTURE (owner: *"produk turunan di modal ada gambarnya"*) — a product is
                                  recognised by what it looks like before its name is read. */}
                              <HStack gap="3" minW="0">
                                {item.imageUrl ? (
                                  <Image
                                    src={item.imageUrl}
                                    alt=""
                                    boxSize="10"
                                    objectFit="cover"
                                    borderRadius="md"
                                    borderWidth="1px"
                                    flexShrink={0}
                                    data-testid={`pd-derived-image-${i}`}
                                  />
                                ) : (
                                  <Box
                                    boxSize="10"
                                    borderRadius="md"
                                    borderWidth="1px"
                                    bg="bg.muted"
                                    display="flex"
                                    alignItems="center"
                                    justifyContent="center"
                                    flexShrink={0}
                                  >
                                    <Icon as={Package} boxSize="4" color="fg.subtle" />
                                  </Box>
                                )}
                                <Stack gap="0" minW="0">
                                  <Text lineClamp={1}>{item.name}</Text>
                                  <Text fontSize="xs" color="fg.muted">
                                    {item.sku}
                                  </Text>
                                </Stack>
                              </HStack>
                            </Table.Cell>
                            <Table.Cell>{item.teamName}</Table.Cell>
                            <Table.Cell textAlign="end">{t("products.stat.pcs", { n: item.readyQty })}</Table.Cell>
                          </Table.Row>
                        ))}
                      </Table.Body>
                    </Table.Root>
                  </Dialog.Body>
                  <Dialog.CloseTrigger asChild>
                    <CloseButton size="sm" />
                  </Dialog.CloseTrigger>
                </Dialog.Content>
              </Dialog.Positioner>
            </Portal>
          </Dialog.Root>
        )}
      </Stack>
    </Stack>
  );
}

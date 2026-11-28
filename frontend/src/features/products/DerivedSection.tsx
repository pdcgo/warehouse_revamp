import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Badge, Box, Button, CloseButton, Dialog, HStack, Icon, Image, Portal, Spinner, Stack, Table, Text, Tooltip } from "@chakra-ui/react";
import { Package } from "lucide-react";

import type { DerivedProduct, DerivedProducts } from "./adapt";

// A ROW LIGHTS UP under the pointer, every cell of it (a-table-row-lights-up).
const LIGHTS_UP = { _hover: { "& > td": { bg: "bg.muted" } } } as const;

// PRODUK TURUNAN — the link a RETURN TO ANOTHER TEAM makes between two products (owner: *"barang yang retur ke team beda
// team"*), shown BOTH WAYS, because the product on screen can be either end of it (owner: *"bisa jadi yang sekarang itu
// juga turunan"*). It IS the return map (produk-turunan-is-the-return-map):
//
//   Turunan dari   the other teams' products this one was mapped FROM — one line each; usually one, but a team may land
//                  several borrowed products on one product of its own (the map is unique on its source, not on its
//                  own product: the-map-is-unique-on-its-source), so each gets its own line in the same style
//   Turunannya     every team's own product mapped from this one — any number, one per team
//
// ⚠ THERE CAN BE MANY (owner: *"dia bisa banyak, design sekarang kalau kepanjangan membingungkan"*), and a side card that
// grows a block per return stops being readable. So the card holds the COUNT, the first few as ONE LINE each — the team,
// the SKU and its READY STOCK as just "N pcs", what the number is said by a tooltip (owner: *"tidak perlu dikasih
// tanggal"*, *"pcs stok readynya bukan diretur sejumlah"*, then *"cuma pcs aja di produk turunan, siapnya jadi tooltip
// aja"*) — and "Lihat Semua" opens the whole list in a dialog, as a table with the derived product's name and SKU.
//
// REAL since 2026-11-27 (#140): the maps are TeamReturnConfigurationService.ProductDerivedList, read across teams, and the
// page names them with the reads it already makes — ProductByIds, TeamByIds, DiscoverStockByIds (useProductDerived).
// The product's own page and its discover detail both (owner: *"produk turunan juga ditampilkan"*,
// the-discover-detail-shows-no-markup) — the body of the section card each page draws.

/** How many the card shows before "see all". */
const IN_CARD = 3;

/** A product with no maps either way — what an empty answer draws. */
const NONE: DerivedProducts = { from: [], to: [], fromTotal: 0, toTotal: 0 };

/** One derived product as a single line — which team, its SKU, its stock ready. */
function DerivedLine({ item, testId }: { item: DerivedProduct; testId: string }) {
  const { t } = useTranslation();
  const ready = item.readyQty.toString();

  return (
    <HStack justify="space-between" gap="2" py="1.5" borderBottomWidth="1px" borderColor="border.muted" minW="0" data-testid={testId}>
      <HStack gap="2" minW="0">
        <Badge size="sm" colorPalette="gray" flexShrink={0}>
          {item.teamName}
        </Badge>
        <Text fontSize="xs" color="fg.muted" truncate title={item.productCode}>
          {item.productCode}
        </Text>
      </HStack>
      <Tooltip.Root openDelay={100} closeDelay={80}>
        <Tooltip.Trigger asChild>
          <Text
            fontSize="xs"
            color="fg.muted"
            flexShrink={0}
            aria-label={t("products.detail.derived.ready", { n: ready })}
            data-testid={`${testId}-pcs`}
          >
            {t("products.stat.pcs", { n: ready })}
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

/**
 * The section's body: `derived` once the maps and their names have answered, `loading` while they have not, `error` when
 * the read was refused or failed — said in place, so the rest of the page stands.
 */
export function DerivedSection({ derived, loading, error }: { derived?: DerivedProducts; loading: boolean; error?: string }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  // While the maps and their names load — the section's own spinner, as its neighbours' (Pemasok, Keluar Masuk Harian).
  if (loading) {
    return <Spinner colorPalette="brand" size="sm" data-testid="pd-derived-loading" />;
  }

  if (error) {
    return (
      <Text color="error.fg" fontSize="sm" data-testid="pd-derived-error">
        {error}
      </Text>
    );
  }

  const shown = derived ?? NONE;
  const rest = shown.to.length - IN_CARD;

  return (
    <Stack gap="card">
      <Stack gap="1" data-testid="pd-derived-from">
        <Text fontSize="xs" fontWeight="bold" color="fg.label">
          {t("products.detail.derived.from")}
        </Text>
        {shown.from.length === 0 ? (
          <Text fontSize="sm" color="fg.muted">
            {t("products.detail.derived.fromNone")}
          </Text>
        ) : (
          <Box>
            {shown.from.map((item, i) => (
              // The first keeps the section's one-line id; a second source onto the same product is numbered.
              <DerivedLine key={i} item={item} testId={i === 0 ? "pd-derived-from-item" : `pd-derived-from-item-${i}`} />
            ))}
          </Box>
        )}
      </Stack>

      <Stack gap="1" data-testid="pd-derived-to">
        <HStack justify="space-between">
          <Text fontSize="xs" fontWeight="bold" color="fg.label">
            {t("products.detail.derived.to")}
          </Text>
          <Badge size="sm" variant="subtle" data-testid="pd-derived-count">
            {shown.toTotal}
          </Badge>
        </HStack>
        {shown.to.length === 0 ? (
          <Text fontSize="sm" color="fg.muted">
            {t("products.detail.derived.toNone")}
          </Text>
        ) : (
          <Box>
            {shown.to.slice(0, IN_CARD).map((item, i) => (
              <DerivedLine key={i} item={item} testId={`pd-derived-to-${i}`} />
            ))}
          </Box>
        )}

        {rest > 0 && (
          <Dialog.Root open={open} onOpenChange={(e) => setOpen(e.open)} size="lg" scrollBehavior="inside">
            <Dialog.Trigger asChild>
              <Button size="xs" variant="ghost" alignSelf="flex-start" data-testid="pd-derived-see-all">
                {t("products.detail.derived.seeAll", { count: shown.toTotal })}
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
                        {shown.to.map((item, i) => (
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
                                    {item.productCode}
                                  </Text>
                                </Stack>
                              </HStack>
                            </Table.Cell>
                            <Table.Cell>{item.teamName}</Table.Cell>
                            <Table.Cell textAlign="end">{t("products.stat.pcs", { n: item.readyQty.toString() })}</Table.Cell>
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

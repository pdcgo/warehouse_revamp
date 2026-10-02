import { useState } from "react";
import {
  Box,
  Button,
  CloseButton,
  Dialog,
  Flex,
  Icon,
  Portal,
  SimpleGrid,
  Stack,
  Text,
} from "@chakra-ui/react";
import { useTranslation } from "react-i18next";
import { ArrowLeft, FileSpreadsheet, Upload } from "lucide-react";

import { MarketplaceBadge, marketplaceLabel } from "../../../components/badges/MarketplaceBadge";
import { MARKETPLACES } from "../../../components/pickers/MarketplaceSelect";
import { Marketplace } from "../../../gen/warehouse/marketplace/v1/marketplace_pb";
import { NotImplemented } from "../../../features/pending/NotImplemented";
import { ORDERS_LIST_PENDING } from "../pending";

// What a marketplace's export actually arrives as. Both, because which one you get is the
// marketplace's choice, not ours — Shopee hands out .xlsx, others a plain .csv.
const ACCEPT = ".csv,.xls,.xlsx,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

// THE MARKETPLACE IS CHOSEN FIRST, AND THAT IS THE WHOLE STRUCTURE OF THIS DIALOG (owner).
//
// "Import orders" sounds like one action and is not: every storefront exports a DIFFERENT sheet —
// different column names, different status words, a different place the payout figure sits. So there
// is no such thing as "the order import file", and a single drop zone with a marketplace dropdown
// underneath would read as though there were, inviting somebody to drop Tokopedia's sheet while the
// picker still said Shopee.
//
//   step 1  WHICH STOREFRONT  → a grid of the marketplaces, each in its standard colour
//   step 2  WHICH FILE        → the drop zone, titled with the storefront it belongs to
//
// ⚠ NOTHING IS SENT. There is no import RPC and no parser; the file is named on screen and goes no
// further. The dialog exists so the SHAPE can be reviewed before any of that is built — see the
// `import` entry in this screen's pending list.
export function ImportOrdersDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();

  const [marketplace, setMarketplace] = useState<Marketplace | undefined>(undefined);
  const [file, setFile] = useState<File | undefined>(undefined);
  const [dragging, setDragging] = useState(false);

  // Closing RESETS, rather than keeping half a choice for next time. A dialog that reopens on
  // "Tokopedia, 3 files ago" is one somebody imports the wrong sheet from.
  function change(next: boolean) {
    if (!next) {
      setMarketplace(undefined);
      setFile(undefined);
      setDragging(false);
    }

    onOpenChange(next);
  }

  return (
    <Dialog.Root open={open} onOpenChange={(e) => change(e.open)} size="lg">
      <Portal>
        <Dialog.Backdrop />
        <Dialog.Positioner>
          <Dialog.Content data-testid="import-orders-dialog">
            <Dialog.Header>
              <Stack gap="1">
                <Flex align="center" gap="2">
                  <Dialog.Title>{t("orders.import.title")}</Dialog.Title>
                  {/* THE CHOSEN STOREFRONT, IN ITS OWN COLOUR, from the moment it is chosen — the
                      file about to be dropped belongs to exactly one of them, and the sentence
                      underneath is not where somebody checks that. */}
                  {marketplace !== undefined && <MarketplaceBadge marketplace={marketplace} />}
                  <NotImplemented list={ORDERS_LIST_PENDING} id="import" />
                </Flex>
                <Text fontSize="sm" color="fg.muted">
                  {marketplace === undefined
                    ? t("orders.import.chooseMarketplace")
                    : t("orders.import.chooseFile", { marketplace: marketplaceLabel(marketplace) })}
                </Text>
              </Stack>
            </Dialog.Header>

            <Dialog.Body>
              {marketplace === undefined ? (
                /* ⚠ EVERY MARKETPLACE IS OFFERED, including the ones whose parser will land last.
                   A grid that showed only the finished ones would answer "can I import Lazada?"
                   with silence, which reads as "Lazada is not supported" rather than "not yet". */
                <SimpleGrid columns={{ base: 2, sm: 3 }} gap="3" data-testid="import-marketplaces">
                  {MARKETPLACES.map((m) => (
                    <Button
                      key={m}
                      variant="outline"
                      colorPalette="gray"
                      h="16"
                      data-testid={`import-marketplace-${m}`}
                      onClick={() => setMarketplace(m)}
                    >
                      <MarketplaceBadge marketplace={m} />
                    </Button>
                  ))}
                </SimpleGrid>
              ) : (
                <Stack gap="card">
                  {/* WHAT THIS FILE IS EXPECTED TO DO, said before the file is chosen — an import
                      that quietly rewrites a status is one nobody trusts a second time. Which
                      columns carry it is the per-marketplace work that is not done. */}
                  <Box borderWidth="1px" borderRadius="l2" bg="bg.subtle" p="card">
                    <Stack gap="1">
                      <Text fontSize="sm" fontWeight="bold" color="fg.label">
                        {t("orders.import.updatesTitle")}
                      </Text>
                      <Text fontSize="sm" color="fg.muted">
                        {t("orders.import.updatesStatus")}
                      </Text>
                      <Flex align="center" gap="2">
                        <Text fontSize="sm" color="fg.muted">
                          {t("orders.import.updatesWithdrawal")}
                        </Text>
                        <NotImplemented list={ORDERS_LIST_PENDING} id="withdrawal" />
                      </Flex>
                    </Stack>
                  </Box>

                  {/* The drop zone takes a DROP as well as a click, for the same reason the receipt
                      preview does: the file was downloaded from the marketplace a second ago and is
                      already on screen. */}
                  <Box
                    as="label"
                    borderWidth="1px"
                    borderStyle="dashed"
                    borderColor={dragging ? "brand.focusRing" : "border"}
                    bg={dragging ? "brand.subtle" : "bg.subtle"}
                    borderRadius="l2"
                    h="40"
                    p="card"
                    display="flex"
                    alignItems="center"
                    justifyContent="center"
                    cursor="pointer"
                    transition="background 0.12s, border-color 0.12s"
                    data-testid="import-drop-zone"
                    onDragOver={(e) => {
                      e.preventDefault();
                      setDragging(true);
                    }}
                    onDragLeave={() => setDragging(false)}
                    onDrop={(e) => {
                      e.preventDefault();
                      setDragging(false);

                      const dropped = e.dataTransfer.files[0];
                      if (dropped) setFile(dropped);
                    }}
                  >
                    <Stack gap="1" align="center" textAlign="center" maxW="full">
                      <Icon
                        as={FileSpreadsheet}
                        boxSize="6"
                        color={file ? "fg.muted" : "fg.subtle"}
                      />
                      <Text fontSize="sm" lineClamp={1} maxW="full">
                        {file ? file.name : t("orders.import.noFile")}
                      </Text>
                      <Text fontSize="xs" color="fg.subtle">
                        {t("orders.import.dropHere")}
                      </Text>
                    </Stack>

                    {/* The native input is the file PICKER, which has no Chakra equivalent — it is
                        hidden inside the label rather than styled, so the whole zone is the target. */}
                    <input
                      type="file"
                      accept={ACCEPT}
                      hidden
                      data-testid="import-file-input"
                      onChange={(e) => setFile(e.target.files?.[0] ?? undefined)}
                    />
                  </Box>
                </Stack>
              )}
            </Dialog.Body>

            <Dialog.Footer>
              {marketplace !== undefined && (
                /* Back to the grid, because picking the wrong storefront is the easy mistake here
                   and re-opening the dialog to fix it would throw away the chosen file. */
                <Button
                  variant="ghost"
                  colorPalette="gray"
                  mr="auto"
                  data-testid="import-back"
                  onClick={() => {
                    setMarketplace(undefined);
                    setFile(undefined);
                  }}
                >
                  <Icon as={ArrowLeft} boxSize="4" />
                  {t("orders.import.back")}
                </Button>
              )}

              <Dialog.ActionTrigger asChild>
                <Button variant="outline" colorPalette="gray" data-testid="import-cancel">
                  {t("common.cancel")}
                </Button>
              </Dialog.ActionTrigger>

              {/* Disabled until BOTH halves are answered — there is no import of a file without a
                  storefront to read it as. It does nothing when enabled either; see the mark in the
                  header. */}
              <Button
                colorPalette="brand"
                disabled={marketplace === undefined || file === undefined}
                data-testid="import-submit"
                onClick={() => change(false)}
              >
                <Icon as={Upload} boxSize="4" />
                {t("orders.import.submit")}
              </Button>
            </Dialog.Footer>

            <Dialog.CloseTrigger asChild>
              <CloseButton size="sm" />
            </Dialog.CloseTrigger>
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  );
}

import { useState } from "react";
import {
  Box,
  Button,
  CloseButton,
  Dialog,
  Field,
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
import { ShopSelect } from "../../../components/pickers/ShopSelect";
import { Marketplace } from "../../../gen/warehouse/marketplace/v1/marketplace_pb";
import { NotImplemented } from "../../../features/pending/NotImplemented";
import { ORDERS_LIST_PENDING } from "../pending";
import { OrderImportLog } from "./OrderImportLog";
import { MAX_ORDER_FILE_BYTES, canImportOrdersFrom, useOrderImport } from "./useOrderImport";

// What a marketplace's export actually arrives as. Both, because which one you get is the
// marketplace's choice, not ours — Shopee hands out .xlsx, others a plain .csv.
const ACCEPT = ".csv,.xls,.xlsx,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

// THREE STEPS, IN THE OWNER'S ORDER (the-import-is-platform-then-shop-and-file-then-log).
//
// "Import orders" sounds like one action and is not: every storefront exports a DIFFERENT sheet —
// different column names, different status words. So there is no such thing as "the order import file",
// and a single drop zone with a marketplace dropdown underneath would read as though there were,
// inviting somebody to drop Tokopedia's sheet while the picker still said Shopee.
//
//   step 1  WHICH STOREFRONT     → a grid of the marketplaces, each in its standard colour
//   step 2  WHICH SHOP + FILE    → the shop, narrowed to that storefront, and the drop zone. The shop is
//                                  asked because a row is matched on shop + ref, and the file names no shop
//   step 3  THE LOG              → what the import did with each row
//
// Shopee and TikTok are read (the-order-import-is-one-rpc-per-platform); every other marketplace is offered in the
// grid and told "not yet" at step 2. ⚠ Both readers are built against MOCK exports — see the `import` entry in this
// screen's pending list.
export function ImportOrdersDialog({
  teamId,
  open,
  onOpenChange,
}: {
  teamId: bigint;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();

  const [marketplace, setMarketplace] = useState<Marketplace | undefined>(undefined);
  const [shopId, setShopId] = useState(0n);
  const [file, setFile] = useState<File | undefined>(undefined);
  const [fileError, setFileError] = useState("");
  const [dragging, setDragging] = useState(false);
  const { result, start, reset } = useOrderImport();
  const importable = canImportOrdersFrom(marketplace);

  // Closing RESETS, rather than keeping half a choice for next time. A dialog that reopens on
  // "Tokopedia, 3 files ago" is one somebody imports the wrong sheet from.
  function change(next: boolean) {
    if (!next) {
      setMarketplace(undefined);
      setShopId(0n);
      setFile(undefined);
      setFileError("");
      setDragging(false);
      reset();
    }

    onOpenChange(next);
  }

  // A file over the server's ceiling is refused here, before it is sent.
  function pick(picked: File | undefined) {
    setFileError("");
    setFile(undefined);
    if (!picked) return;

    if (picked.size > MAX_ORDER_FILE_BYTES) {
      setFileError(t("orders.import.tooLarge"));
      return;
    }

    setFile(picked);
  }

  function begin() {
    if (marketplace === undefined || shopId === 0n || file === undefined || !importable) return;

    void start({ teamId, shopId, marketplace, file });
  }

  const subtitle =
    marketplace === undefined
      ? t("orders.import.chooseMarketplace")
      : result === undefined
        ? t("orders.import.chooseShopAndFile", { marketplace: marketplaceLabel(marketplace) })
        : file?.name;

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
                <Text fontSize="sm" color="fg.muted" data-testid="import-subtitle">
                  {subtitle}
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
              ) : result !== undefined ? (
                <Stack gap="card">
                  <OrderImportLog result={result} />
                  {result.phase === "running" && (
                    <Text fontSize="sm" color="fg.muted" data-testid="import-keeps-going">
                      {t("orders.import.keepsGoing")}
                    </Text>
                  )}
                </Stack>
              ) : !importable ? (
                /* NOT YET, said where the file would go — the grid offered this marketplace, so the answer is here
                   rather than silence. */
                <Text fontSize="sm" color="warning.fg" data-testid="import-unsupported">
                  {t("orders.import.unsupported", { marketplace: marketplaceLabel(marketplace) })}
                </Text>
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
                      {/* THE MONEY IS NOT THIS FILE'S (the-order-import-moves-statuses-only): payouts and
                          withdrawals come from the statement, through Settlement Imports — said here so
                          nobody waits for this file to post them. */}
                      <Text fontSize="sm" color="fg.muted" data-testid="import-money-elsewhere">
                        {t("orders.import.moneyFromSettlement")}
                      </Text>
                    </Stack>
                  </Box>

                  {/* ONLY THIS STOREFRONT'S SHOPS. A Shopee sheet matched against a TikTok shop's refs
                      would find nothing, so the other shops are not offered at all. */}
                  <Field.Root required>
                    <Field.Label>
                      {t("orders.import.shop")}
                      <Field.RequiredIndicator />
                    </Field.Label>
                    <Box w="full" data-testid="import-shop">
                      <ShopSelect
                        teamId={teamId}
                        marketplace={marketplace}
                        value={shopId}
                        placeholder={t("orders.import.shopPlaceholder", { marketplace: marketplaceLabel(marketplace) })}
                        onChange={setShopId}
                      />
                    </Box>
                  </Field.Root>

                  {/* The drop zone takes a DROP as well as a click, for the same reason the receipt
                      preview does: the file was downloaded from the marketplace a second ago and is
                      already on screen. */}
                  <Field.Root required invalid={fileError !== ""}>
                    <Field.Label>
                      {t("orders.import.file")}
                      <Field.RequiredIndicator />
                    </Field.Label>
                    <Box
                      as="label"
                      w="full"
                      borderWidth="1px"
                      borderStyle="dashed"
                      borderColor={dragging ? "brand.focusRing" : "border"}
                      bg={dragging ? "brand.subtle" : "bg.subtle"}
                      borderRadius="l2"
                      h="32"
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

                        pick(e.dataTransfer.files[0]);
                      }}
                    >
                      <Stack gap="1" align="center" textAlign="center" maxW="full">
                        <Icon
                          as={FileSpreadsheet}
                          boxSize="6"
                          color={file ? "fg.muted" : "fg.subtle"}
                        />
                        <Text fontSize="sm" lineClamp={1} maxW="full" data-testid="import-file-name">
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
                        onChange={(e) => pick(e.target.files?.[0] ?? undefined)}
                      />
                    </Box>
                    {fileError ? (
                      <Field.ErrorText data-testid="import-file-error">{fileError}</Field.ErrorText>
                    ) : (
                      <Field.HelperText>
                        {t("orders.import.fileHelp", { marketplace: marketplaceLabel(marketplace) })}
                      </Field.HelperText>
                    )}
                  </Field.Root>
                </Stack>
              )}
            </Dialog.Body>

            <Dialog.Footer>
              {result !== undefined ? (
                <Dialog.ActionTrigger asChild>
                  <Button colorPalette={result.phase === "running" ? "gray" : "brand"} variant={result.phase === "running" ? "outline" : "solid"} data-testid="import-close">
                    {t("orders.import.close")}
                  </Button>
                </Dialog.ActionTrigger>
              ) : (
                <>
                  {marketplace !== undefined && (
                    /* Back to the grid, because picking the wrong storefront is the easy mistake here.
                       The shop and the file go with it: a shop of the old storefront is not a shop of the
                       new one, and its sheet is not the new one's either. */
                    <Button
                      variant="ghost"
                      colorPalette="gray"
                      mr="auto"
                      data-testid="import-back"
                      onClick={() => {
                        setMarketplace(undefined);
                        setShopId(0n);
                        setFile(undefined);
                        setFileError("");
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

                  {/* Disabled until the shop AND the file are given — there is no import of a file
                      without the shop whose refs it names. */}
                  <Button
                    colorPalette="brand"
                    disabled={!importable || shopId === 0n || file === undefined}
                    data-testid="import-submit"
                    onClick={begin}
                  >
                    <Icon as={Upload} boxSize="4" />
                    {t("orders.import.submit")}
                  </Button>
                </>
              )}
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

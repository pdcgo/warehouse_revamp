import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Alert, Badge, Box, Button, Card, Flex, Grid, Heading, Icon, IconButton, Portal, Spacer, Stack, Text } from "@chakra-ui/react";
import { ArrowLeft, CircleCheck, Printer, Tags } from "lucide-react";

import { rpcError } from "../../api/rpcError";
import { CompactActions } from "../../components/chrome/CompactActions";
import { EmptyHint } from "../../components/feedback/EmptyHint";
import { ListSkeleton } from "../../components/feedback/ListSkeleton";
import { RefreshOverlay } from "../../components/feedback/RefreshOverlay";
import { toaster } from "../../components/feedback/Toaster";
import { LabelPaper, LabelSticker } from "../../features/labels/LabelPaper";
import type { PrintLabel } from "../../features/labels/LabelPaper";
import { PrintStyles } from "../../features/labels/PrintStyles";
import { PX_PER_MM, labelBox, loadSettings, papersOf, runOf } from "../../features/labels/settings";
import type { ReprintLabel } from "../../features/products/reprint/reprintQueries";
import { useProductReprint, useRecordReprint } from "../../features/products/reprint/reprintQueries";
import { canWrite, useTeam } from "../../features/team/TeamContext";
import { TeamType } from "../../gen/warehouse/team/v1/team_pb";
import { useIsMobile } from "../../layouts/shell";
import { formatUnixDate } from "../../lib/datetime";
import { useElementWidth } from "../../lib/useElementWidth";

/** Where the warehouse's Products list opens the reprint (router.tsx). */
export const REPRINT_LABELS_PATH = "/products/reprint-labels";

// CETAK ULANG KODE — the warehouse's reprint of the products whose code changed (backlog #151, live since
// the-team-code-and-product-tags-prototype-is-accepted, row *the reprint*). Opened from the warehouse's Products list
// (*Cetak ulang kode (N)*), as the owner decided (products-have-their-own-tag-list, 🔄 *what clears*: "a NEW print, of
// the tagged products' placements, opened from the warehouse's Products list").
//
//   [←] Cetak Ulang Kode [Gudang Pusat]                          3 label · 2 produk   [🖨 Cetak]
//   ⓘ  These products' codes changed. Print … stick each on its shelf …
//   Label setup: 35 × 15 mm · 1 × 1 — set up on this device's Cetak Label.
//   ┌ Pratinjau ─────────────┐
//   ├ Yang Dicetak ──────────────────────────────────────────────┐
//   │ Minyak Goreng Sawit 2L — Satuan   SL-03-ANG-001 · was TA-ANG-001 │
//   │   [sticker]  A-01-1 · 30 pcs   [sticker]  A-01-2 · 24 pcs       │
//   └─────────────────────────────────────────────────────────────┘
//
// THE RULES IT DRAWS — the server's (InventoryService.ProductReprintList / ProductReprintRecord):
//   · ONE LABEL PER PLACEMENT (the acceptance's given 3: 2 products on 3 shelf spots → 3 labels) — each with the
//     product's LIVE code (the QR and the SKU line, the-label-qr-is-the-product-code), its shelf spot, and its quantity
//     beside it, as Cetak Label's Yang Dicetak says each label and its count. Only the products still waiting for THIS
//     warehouse are listed (given 3's *reprint shows only tagged products*), the code they carried before beside each;
//   · THE DEVICE'S LABEL SETUP — the paper, the grid, the text sizes Cetak Label saved on this device (features/labels,
//     the-label-settings-are-remembered): one device, one label printer, one setup. No settings panel of its own;
//   · CETAK IS THE RECORDED PRINT (as the order labels' Print, a-changed-label-asks-the-warehouse-to-reprint): the
//     browser's print dialog, then ProductReprintRecord with the products this run printed WHOLE and the codes it
//     printed — they leave this warehouse's list at once (the page re-reads); `need_reprint_code` comes off a product once
//     every warehouse holding its stock has printed (⚠5, the acceptance's given 4: the other warehouse still sees it in
//     its reprint). A code changed again since the read is not cleared — the re-read shows its newest code to print;
//   · a warehouse's own people print — every warehouse role, never a monitor, who reads (the policy, `warehouse:all`).
export function ProductReprintLabelsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const mobile = useIsMobile();
  const { current } = useTeam();
  const [settings] = useState(loadSettings);
  const [previewRef, previewWidth] = useElementWidth<HTMLDivElement>();

  const isWarehouse = current?.teamType === TeamType.WAREHOUSE;
  const warehouseId = isWarehouse ? current?.teamId : undefined;
  const query = useProductReprint(warehouseId);
  const record = useRecordReprint(warehouseId);

  const products = query.data?.products ?? [];
  const labels = products.flatMap((p) => p.labels);

  // The run — the device's limit of labels at once (runOf); a product is recorded only when ALL its labels are in it (one
  // with nothing on a shelf here has none, and is printed whole by any run).
  const run = runOf(labels, settings.limit, 1);
  const papers = papersOf(run.items.map(toPrintLabel), settings);
  const printedWhole = products.filter((p) => p.labels.every((l) => run.items.includes(l)));
  const today = formatUnixDate(BigInt(Math.floor(Date.now() / 1000)));

  const paperPx = settings.paperWidth * PX_PER_MM;
  const scale = previewWidth > 0 ? Math.min(3, Math.max(1, (previewWidth - 24) / paperPx)) : 1;
  const stickerPx = labelBox(settings).width * PX_PER_MM;
  const stickerScale = Math.min(2, Math.max(1, 200 / Math.max(1, stickerPx)));

  if (!current || !isWarehouse || warehouseId === undefined) {
    return (
      <Stack gap="section">
        <Heading size="md">{t("products.reprint.title")}</Heading>
        <Text color="fg.muted" data-testid="reprint-not-warehouse">
          {t("products.reprint.warehouseOnly")}
        </Text>
      </Stack>
    );
  }

  const writable = canWrite(current);
  const error = query.isError ? rpcError(query.error) : "";

  // CETAK — the print dialog first (the papers on the page ARE the print), then the record of what it carried.
  const print = async () => {
    if (printedWhole.length === 0 || record.isPending) return;
    if (papers.length > 0) window.print();

    try {
      const done = await record.mutateAsync(printedWhole.map((p) => ({ productId: p.productId, productCode: p.productCode })));

      toaster.create({ type: "success", title: t("products.reprint.printed", { count: done.cleared.length }) });
      if (done.codeChanged.length > 0) {
        toaster.create({ type: "warning", title: t("products.reprint.codeChanged", { count: done.codeChanged.length }) });
      }
    } catch (err) {
      toaster.create({ type: "error", title: rpcError(err) });
    }
  };

  const back = (
    <IconButton
      size="sm"
      variant="ghost"
      flexShrink={0}
      className="no-print"
      aria-label={t("products.reprint.back")}
      title={t("products.reprint.back")}
      onClick={() => navigate("/products")}
      data-testid="reprint-back"
    >
      <Icon as={ArrowLeft} boxSize="4" />
    </IconButton>
  );

  const summary = (
    <Text fontSize="sm" textAlign={mobile ? "start" : "end"} data-testid="reprint-count">
      {t("products.reprint.count", { labels: labels.length, count: products.length })}
    </Text>
  );

  const canPrint = writable && products.length > 0;

  return (
    <Stack gap="section" animationStyle="enter" data-testid="reprint-page">
      <PrintStyles settings={settings} />

      <Flex align="center" gap={mobile ? "2" : "card"} wrap={mobile ? "nowrap" : "wrap"} className="no-print">
        {back}
        <Heading size="md" truncate data-testid="reprint-heading">
          {t("products.reprint.title")}
        </Heading>
        <Badge colorPalette="brand" flexShrink={0}>
          {current.teamName}
        </Badge>
        <Spacer />
        {canPrint &&
          (mobile ? (
            <CompactActions
              menuLabel={t("products.table.actions")}
              actions={[{ id: "print", label: t("restock.labels.print"), icon: Printer, primary: true, testId: "reprint-print", onClick: print }]}
            />
          ) : (
            <>
              {summary}
              <Button colorPalette="brand" onClick={print} loading={record.isPending} data-testid="reprint-print">
                <Icon as={Printer} boxSize="4" />
                {t("restock.labels.print")}
              </Button>
            </>
          ))}
      </Flex>

      {error && (
        <Text color="error.fg" className="no-print" data-testid="reprint-error">
          {error}
        </Text>
      )}

      {query.isPending ? (
        <ListSkeleton testId="reprint-loading" />
      ) : products.length === 0 ? (
        // NOTHING LEFT — every product whose code changed has its labels printed here (or none ever waited).
        !error && <EmptyHint icon={CircleCheck} title={t("products.reprint.none")} description={t("products.reprint.noneHint")} testId="reprint-empty" />
      ) : (
        <>
          {mobile && <Box className="no-print">{summary}</Box>}

          <Alert.Root status="info" className="no-print" data-testid="reprint-lead">
            <Alert.Indicator />
            <Alert.Content>
              <Alert.Description>{t("products.reprint.lead")}</Alert.Description>
            </Alert.Content>
          </Alert.Root>

          <Text fontSize="xs" color="fg.muted" className="no-print" data-testid="reprint-settings-line">
            {t("products.reprint.settingsLine", {
              width: settings.paperWidth,
              height: settings.paperHeight,
              rows: settings.rows,
              columns: settings.columns,
            })}
          </Text>

          {run.pages > 1 && (
            <Text fontSize="xs" color="warning.fg" className="no-print" data-testid="reprint-more">
              {t("products.reprint.more", { count: labels.length - run.items.length })}
            </Text>
          )}

          {/* More products wait than one read holds — they come in once these are printed and the page reads again. */}
          {(query.data?.totalProducts ?? 0) > products.length && (
            <Text fontSize="xs" color="warning.fg" className="no-print" data-testid="reprint-more-products">
              {t("products.reprint.moreProducts", { count: (query.data?.totalProducts ?? 0) - products.length })}
            </Text>
          )}

          <RefreshOverlay busy={query.isFetching && !query.isPending}>
            <Grid templateColumns={{ base: "minmax(0, 1fr)", lg: "minmax(0, 20rem) minmax(0, 1fr)" }} gap="section" alignItems="start" className="no-print">
              <Card.Root minW="0" data-testid="reprint-preview">
                <Card.Body>
                  <Stack gap="card">
                    <Text fontWeight="bold">{t("restock.labels.settings.preview")}</Text>
                    <Box ref={previewRef} bg="bg.muted" borderRadius="md" p="card" overflowX="auto" minW="0">
                      <Flex justify="center">
                        <Box flexShrink={0} bg="white" borderRadius="sm" boxShadow="sm" overflow="hidden">
                          <Box style={{ zoom: scale }}>
                            <LabelPaper labels={papers[0] ?? []} settings={settings} today={today} testId="reprint-paper-0" />
                          </Box>
                        </Box>
                      </Flex>
                    </Box>
                  </Stack>
                </Card.Body>
              </Card.Root>

              <Card.Root minW="0" data-testid="reprint-to-print">
                <Card.Body>
                  <Stack gap="card">
                    <Flex align="baseline" gap="2" wrap="wrap">
                      <Text fontWeight="bold">{t("restock.labels.settings.toPrint")}</Text>
                      <Text fontSize="xs" color="fg.muted">
                        {t("products.reprint.toPrintLine", { count: labels.length })}
                      </Text>
                    </Flex>

                    <Stack gap="section" data-testid="reprint-sheet">
                      {products.map((group) => (
                        <Stack key={group.productId.toString()} gap="2" data-testid={`reprint-product-${group.productId}`}>
                          <Flex align="baseline" gap="2" wrap="wrap">
                            <Text fontSize="sm" fontWeight="bold" lineClamp={1}>
                              {group.name}
                            </Text>
                            <Text fontSize="sm" fontFamily="mono" data-testid={`reprint-product-${group.productId}-code`}>
                              {group.productCode}
                            </Text>
                            {group.formerCode && (
                              <Text fontSize="xs" color="fg.muted" data-testid={`reprint-product-${group.productId}-former`}>
                                {t("products.reprint.formerCode", { code: group.formerCode })}
                              </Text>
                            )}
                          </Flex>
                          <Grid templateColumns="repeat(auto-fill, minmax(min(13rem, 100%), 1fr))" gap="card">
                            {group.labels.map((label) => {
                              const index = labels.indexOf(label);

                              return (
                                <Stack key={index} gap="2" borderWidth="1px" borderColor="border" borderRadius="md" p="3" data-testid={`reprint-label-${index}`}>
                                  <Flex justify="center" bg="bg.muted" borderRadius="sm" p="2" overflowX="auto">
                                    <Box flexShrink={0} bg="white" boxShadow="xs" borderRadius="xs" overflow="hidden">
                                      <Box style={{ zoom: stickerScale }}>
                                        <LabelSticker label={toPrintLabel(label)} settings={settings} today={today} />
                                      </Box>
                                    </Box>
                                  </Flex>
                                  <Text fontSize="xs" color="fg.muted" data-testid={`reprint-label-${index}-where`}>
                                    {t("products.reprint.where", { placement: label.placementCode, count: Number(label.quantity) })}
                                  </Text>
                                </Stack>
                              );
                            })}
                          </Grid>
                        </Stack>
                      ))}
                    </Stack>
                  </Stack>
                </Card.Body>
              </Card.Root>
            </Grid>
          </RefreshOverlay>

          {/* WHAT PRINTS — every paper of the run at its true size, one a page; hidden on screen (PrintStyles). */}
          <Portal>
            <div className="labels-print-root" data-testid="reprint-print-root">
              {papers.map((paper, i) => (
                <LabelPaper key={i} labels={paper} settings={settings} today={today} />
              ))}
            </div>
          </Portal>
        </>
      )}

      {!query.isPending && products.length === 0 && (
        <Flex className="no-print">
          <Button variant="outline" onClick={() => navigate("/products")} data-testid="reprint-done-back">
            <Icon as={Tags} boxSize="4" />
            {t("products.reprint.back")}
          </Button>
        </Flex>
      )}
    </Stack>
  );
}

function toPrintLabel(label: ReprintLabel): PrintLabel {
  return { productCode: label.productCode, name: label.name, placementCode: label.placementCode };
}

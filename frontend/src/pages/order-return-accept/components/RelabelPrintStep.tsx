import type { ReactNode } from "react";
import { useState } from "react";
import { Alert, Box, Button, Card, Flex, Grid, Heading, Icon, Portal, Spacer, Stack, Text } from "@chakra-ui/react";
import { useTranslation } from "react-i18next";
import { Check, Printer } from "lucide-react";

import type { OrderReturnLabel } from "../../../gen/warehouse/selling/v1/order_pb";
import { OrderStatus } from "../../../gen/warehouse/selling/v1/order_pb";
import { OrderStatusBadge } from "../../../components/badges/OrderStatusBadge";
import { CompactActions } from "../../../components/chrome/CompactActions";
import type { PrintLabel } from "../../../features/labels/LabelPaper";
import { LabelPaper, LabelSticker } from "../../../features/labels/LabelPaper";
import { PrintStyles } from "../../../features/labels/PrintStyles";
import { PX_PER_MM, labelBox, loadSettings, papersOf } from "../../../features/labels/settings";
import { formatUnixDate } from "../../../lib/datetime";

/** A returned borrowed unit's new label — the selling team's OWN product, no placement. */
function printLabelOf(label: OrderReturnLabel): PrintLabel {
  return { productCode: label.ownProductCode, name: label.ownProductName, placementCode: "" };
}

// THE ACCEPT'S LABELS, PRINTED (a-returned-borrowed-unit-is-relabelled-at-the-accept: "when a return is accepted, each
// unit of a borrowed line gets the mapped product's label printed and stuck over the lender's"; the accept's then *can
// print barcode of mapped own product*). The accept answers them (`OrderReturnAcceptResponse.labels`): per borrowed line
// the mapped own product and its SOUND units — one label each. So once a return with borrowed lines is accepted the page
// stays here, the units still in the crew's hands, until they print and say Done; a return of own products only goes back
// as before.
//
// THE APP'S ONE LABEL PRINT, not a second one: Cetak Label's sticker (the product code in the QR,
// the-label-qr-is-the-product-code) on the paper set up on this device (features/labels/settings.ts), sent through the
// browser's own print dialog — which is where a PDF is saved too (cetak-is-the-one-print-button). Every label of the
// return prints in one go: a parcel is never near a run's limit.
export function RelabelPrintStep({
  orderId,
  title,
  back,
  mobile,
  labels,
  onDone,
}: {
  orderId: bigint;
  title: string;
  back: ReactNode;
  mobile: boolean;
  labels: OrderReturnLabel[];
  onDone: () => void;
}) {
  const { t } = useTranslation();
  // The paper Cetak Label set up on this device, read once — this page has no settings of its own.
  const [settings] = useState(loadSettings);
  const today = formatUnixDate(BigInt(Math.floor(Date.now() / 1000)));

  // One label per sound unit, line by line.
  const job: PrintLabel[] = [];
  for (const label of labels) {
    for (let n = 0; n < label.quantity; n++) job.push(printLabelOf(label));
  }
  const papers = papersOf(job, settings);
  // Each sticker shown at up to 2× its box, as Cetak Label's list shows them.
  const stickerPx = labelBox(settings).width * PX_PER_MM;
  const stickerScale = Math.min(2, Math.max(1, 200 / Math.max(1, stickerPx)));

  const print = () => window.print();

  const actions = mobile ? (
    <CompactActions
      menuLabel={t("picking.returnAccept.actions")}
      actions={[
        {
          id: "print",
          label: t("picking.returnAccept.relabelPrint.print"),
          icon: Printer,
          primary: true,
          testId: "return-accept-relabel-print",
          onClick: print,
        },
        {
          id: "done",
          label: t("picking.returnAccept.relabelPrint.done"),
          icon: Check,
          testId: "return-accept-relabels-done",
          onClick: onDone,
        },
      ]}
    />
  ) : (
    <>
      <Button variant="outline" onClick={onDone} data-testid="return-accept-relabels-done">
        <Icon as={Check} boxSize="4" />
        {t("picking.returnAccept.relabelPrint.done")}
      </Button>
      <Button colorPalette="brand" onClick={print} data-testid="return-accept-relabel-print">
        <Icon as={Printer} boxSize="4" />
        {t("picking.returnAccept.relabelPrint.print")}
      </Button>
    </>
  );

  return (
    <Stack gap="section" data-testid="return-accept-page">
      <PrintStyles settings={settings} />

      <Flex align="center" gap={mobile ? "2" : "card"} wrap={mobile ? "nowrap" : "wrap"} className="no-print">
        {back}
        <Heading size="md" truncate data-testid="return-accept-title">
          {title}
        </Heading>
        <OrderStatusBadge status={OrderStatus.RETURN_COMPLETED} />
        <Spacer />
        {actions}
      </Flex>

      <Alert.Root status="success" maxW="3xl" data-testid="return-accept-relabels-accepted">
        <Alert.Indicator />
        <Alert.Content>
          <Alert.Title>{t("picking.returnAccept.relabelPrint.accepted", { id: orderId.toString() })}</Alert.Title>
          <Alert.Description>{t("picking.returnAccept.relabelPrint.intro")}</Alert.Description>
        </Alert.Content>
      </Alert.Root>

      <Card.Root data-testid="return-accept-relabels">
        <Card.Header>
          <Card.Title>{t("picking.returnAccept.relabelPrint.title")}</Card.Title>
          <Card.Description data-testid="return-accept-relabels-total">
            {t("picking.returnAccept.relabelPrint.total", { count: job.length })} ·{" "}
            {t("picking.returnAccept.relabelPrint.paper", {
              width: settings.paperWidth,
              height: settings.paperHeight,
            })}
          </Card.Description>
        </Card.Header>
        <Card.Body>
          <Grid templateColumns="repeat(auto-fill, minmax(min(15rem, 100%), 1fr))" gap="card">
            {labels.map((label) => {
              const id = label.orderItemId.toString();

              return (
                <Stack
                  key={id}
                  gap="2"
                  borderWidth="1px"
                  borderColor="border"
                  borderRadius="md"
                  p="3"
                  data-testid={`return-accept-relabels-line-${id}`}
                >
                  <Flex justify="center" bg="bg.muted" borderRadius="sm" p="2" overflowX="auto">
                    <Box flexShrink={0} bg="white" boxShadow="xs" borderRadius="xs" overflow="hidden">
                      <Box style={{ zoom: stickerScale }}>
                        <LabelSticker label={printLabelOf(label)} settings={settings} today={today} />
                      </Box>
                    </Box>
                  </Flex>
                  <Text fontFamily="mono" fontWeight="bold" data-testid={`return-accept-relabels-code-${id}`}>
                    {label.ownProductCode}
                  </Text>
                  <Text fontSize="sm" lineClamp={1} title={label.ownProductName}>
                    {label.ownProductName}
                  </Text>
                  <Text fontSize="xs" color="fg.muted" data-testid={`return-accept-relabels-count-${id}`}>
                    {t("picking.returnAccept.relabelCount", { count: label.quantity, code: label.borrowedProductCode })}
                  </Text>
                </Stack>
              );
            })}
          </Grid>
        </Card.Body>
      </Card.Root>

      {/* WHAT PRINTS — every label of the return at its true size, one paper a page. Hidden on screen; outside the app's
          root, so the print drops everything else whole (PrintStyles). */}
      <Portal>
        <div className="labels-print-root" data-testid="return-accept-relabels-root">
          {papers.map((paperLabels, i) => (
            <LabelPaper key={i} labels={paperLabels} settings={settings} today={today} />
          ))}
        </div>
      </Portal>
    </Stack>
  );
}

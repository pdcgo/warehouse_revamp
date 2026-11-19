import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Alert,
  Box,
  Button,
  Dialog,
  Field,
  Icon,
  Portal,
  Select,
  Stack,
  Textarea,
  createListCollection,
} from "@chakra-ui/react";
import { PackageSearch, Send } from "lucide-react";

import { rpcError } from "../../api/clients";
import { toaster } from "../../components/feedback/Toaster";
import { CharCount } from "../../components/inputs/CharCount";
import { QuantityInput } from "../../components/inputs/QuantityInput";
import { RackSelect } from "../../components/pickers/RackSelect";
import { ProductListItem } from "../../components/products/ProductListItem";
import { useIsMobile } from "../../layouts/shell";
import { useReportFound } from "./foundRequests";

export const description =
  "Report Found from a LOST order (a-found-lost-parcel-is-a-found-stock-in): the parcel of an order gone lost turned up at the warehouse it shipped from. The order is prefilled — the product is one of its lines (fixed when it has one), the quantity starts at what the order took and cannot pass it, the rack is picked — and FoundRequestCreate names the order. It posts nothing and the order stays lost; the order's timeline names the request, and another Owner or Admin approves it, at the cost the order took the units at. The server's own refusals (not lost, not shipped from here, more than taken) show as said.";

// FoundRequestCreateRequest.note's max_len — the box stops where the server would refuse (a-limited-field-shows-its-count).
const NOTE_MAX = 200;

/** One line of the lost order, as the order's detail reads it. */
export interface LostOrderLine {
  productId: bigint;
  productCode: string;
  name: string;
  quantity: number;
}

// REPORT FOUND FROM A LOST ORDER — the order's page's door to a found request naming it. The rack page's Report Found
// knows the rack and asks the product; here the ORDER is known, so the product is one of its lines and the rack is
// asked. Same one door (FoundRequestCreate), same approval.
export function ReportFoundFromOrderDialog({
  warehouseId,
  orderId,
  lines,
  open,
  onOpenChange,
}: {
  warehouseId: bigint;
  orderId: bigint;
  lines: LostOrderLine[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  // FULL SCREEN ONLY ON A PHONE — by the JS breakpoint, never a responsive `size` (ReportFoundDialog says why).
  const isMobile = useIsMobile();
  const report = useReportFound();

  const single = lines.length === 1 ? lines[0]! : undefined;
  const [productId, setProductId] = useState<string>(single ? single.productId.toString() : "");
  const line = lines.find((l) => l.productId.toString() === productId);
  const [amount, setAmount] = useState(single ? String(single.quantity) : "1");
  const [rack, setRack] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");

  const collection = useMemo(
    () =>
      createListCollection({
        items: lines.map((l) => ({ label: `${l.productCode} · ${l.name}`, value: l.productId.toString() })),
      }),
    [lines],
  );

  const amountNum = Number(amount);
  const amountValid = Number.isInteger(amountNum) && amountNum >= 1 && (!line || amountNum <= line.quantity);
  const ready = line !== undefined && amountValid && rack !== "";

  function close(next: boolean) {
    if (!next) {
      setProductId(single ? single.productId.toString() : "");
      setAmount(single ? String(single.quantity) : "1");
      setRack("");
      setNote("");
      setError("");
    }
    onOpenChange(next);
  }

  function submit() {
    if (!line || !ready) return;
    setError("");
    report.mutate(
      { teamId: warehouseId, productId: line.productId, rackId: BigInt(rack), quantity: BigInt(amountNum), note, orderId },
      {
        onSuccess: () => {
          toaster.create({
            type: "success",
            title: t("inventory.adjustFoundSentToast", { productCode: line.productCode, count: amountNum }),
            description: t("inventory.adjustFoundSentToastDetail"),
          });
          close(false);
        },
        // Not lost, not shipped from here, another team's, more than the order took: the server names it.
        onError: (err) => setError(rpcError(err)),
      },
    );
  }

  return (
    <Dialog.Root open={open} onOpenChange={(e) => close(e.open)} size={isMobile ? "full" : "md"}>
      <Portal>
        <Dialog.Backdrop />
        <Dialog.Positioner>
          <Dialog.Content data-testid="report-found-order-dialog">
            <Dialog.Header>
              <Dialog.Title>{t("inventory.foundFromOrder.title", { id: orderId.toString() })}</Dialog.Title>
            </Dialog.Header>
            <Dialog.Body>
              <Stack gap="card">
                {/* ONE LINE, as the rack's Report Found (a-found-waits-in-one-line): the order stays lost, its timeline
                    names this report, and somebody else approves it. */}
                <Alert.Root status="info" data-testid="report-found-order-info">
                  <Alert.Indicator>
                    <Icon as={PackageSearch} boxSize="4" />
                  </Alert.Indicator>
                  <Alert.Content>
                    <Alert.Title fontWeight="normal">{t("inventory.foundFromOrder.staysLost")}</Alert.Title>
                  </Alert.Content>
                </Alert.Root>

                <Field.Root required>
                  <Field.Label>
                    {t("inventory.foundFromOrder.product")}
                    <Field.RequiredIndicator />
                  </Field.Label>
                  {single ? (
                    // The order's one line — nothing to choose.
                    <Box data-testid="report-found-order-product">
                      <ProductListItem
                        product={{ id: single.productId, name: single.name, productCode: single.productCode }}
                      />
                    </Box>
                  ) : (
                    <Select.Root
                      collection={collection}
                      value={productId === "" ? [] : [productId]}
                      onValueChange={(e) => {
                        const picked = e.value[0];
                        if (picked === undefined) return;
                        setProductId(picked);
                        const next = lines.find((l) => l.productId.toString() === picked);
                        if (next) setAmount(String(next.quantity));
                        setError("");
                      }}
                    >
                      <Select.HiddenSelect />
                      <Select.Control>
                        <Select.Trigger data-testid="report-found-order-line">
                          <Select.ValueText placeholder={t("inventory.foundFromOrder.productPlaceholder")} />
                        </Select.Trigger>
                        <Select.IndicatorGroup>
                          <Select.Indicator />
                        </Select.IndicatorGroup>
                      </Select.Control>
                      {/* Inline, not portalled — inside the modal, as RackSelect. */}
                      <Select.Positioner>
                        <Select.Content>
                          {collection.items.map((item) => (
                            <Select.Item
                              item={item}
                              key={item.value}
                              data-testid={`report-found-order-line-option-${item.value}`}
                            >
                              {item.label}
                              <Select.ItemIndicator />
                            </Select.Item>
                          ))}
                        </Select.Content>
                      </Select.Positioner>
                    </Select.Root>
                  )}
                </Field.Root>

                <Field.Root required>
                  <Field.Label>
                    {t("inventory.foundFromOrder.rack")}
                    <Field.RequiredIndicator />
                  </Field.Label>
                  {/* Every unit is on a rack (there-is-no-unplaced-pile). */}
                  <RackSelect
                    warehouseId={warehouseId}
                    value={rack}
                    onChange={(v) => {
                      setRack(v);
                      setError("");
                    }}
                    allowUnplaced={false}
                    placeholder={t("inventory.foundFromOrder.rackPlaceholder")}
                    testId="report-found-order-rack"
                  />
                </Field.Root>

                <Field.Root required invalid={amount !== "" && !amountValid}>
                  <Field.Label>{t("inventory.adjustQty_found")}</Field.Label>
                  <QuantityInput
                    min={1}
                    max={line?.quantity}
                    width={isMobile ? "full" : "40"}
                    size="sm"
                    value={amount}
                    testId="report-found-order-amount"
                    onChange={setAmount}
                  />
                  {line && (
                    <Field.HelperText data-testid="report-found-order-amount-help">
                      {t("inventory.foundFromOrder.amountHelper", { n: line.quantity })}
                    </Field.HelperText>
                  )}
                </Field.Root>

                <Field.Root>
                  <Field.Label>{t("inventory.adjustNote")}</Field.Label>
                  <Textarea
                    rows={2}
                    value={note}
                    maxLength={NOTE_MAX}
                    placeholder={t("inventory.adjustFoundNotePlaceholder")}
                    data-testid="report-found-order-note"
                    onChange={(e) => setNote(e.target.value)}
                  />
                  <CharCount value={note} max={NOTE_MAX} testId="report-found-order-note-count" />
                </Field.Root>

                {error && (
                  <Alert.Root status="warning" data-testid="report-found-order-error">
                    <Alert.Indicator />
                    <Alert.Content>
                      <Alert.Description>{error}</Alert.Description>
                    </Alert.Content>
                  </Alert.Root>
                )}
              </Stack>
            </Dialog.Body>
            <Dialog.Footer>
              <Dialog.ActionTrigger asChild>
                <Button variant="outline" data-testid="report-found-order-cancel">
                  {t("inventory.cancel")}
                </Button>
              </Dialog.ActionTrigger>
              <Button
                colorPalette="brand"
                disabled={!ready}
                loading={report.isPending}
                onClick={submit}
                data-testid="report-found-order-submit"
              >
                <Icon as={Send} boxSize="4" />
                {t("inventory.adjustFoundSend")}
              </Button>
            </Dialog.Footer>
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  );
}

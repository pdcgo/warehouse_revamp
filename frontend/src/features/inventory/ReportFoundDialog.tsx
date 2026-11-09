import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, Button, Dialog, Field, Icon, Portal, Stack, Textarea } from "@chakra-ui/react";
import { Hourglass, Send } from "lucide-react";

import { rpcError } from "../../api/clients";
import { toaster } from "../../components/feedback/Toaster";
import { CharCount } from "../../components/inputs/CharCount";
import { QuantityInput } from "../../components/inputs/QuantityInput";
import { ProductSelect } from "../../components/products/ProductSelect";
import { useReportFound } from "./foundRequests";
import { useIsMobile } from "../../layouts/shell";

export const description =
  "Reports units found on THIS rack outside a stock count (staff-may-report-a-found): the rack is set, the product is picked, and the units are sent through FoundRequestCreate to the warehouse Owner or Admin. Nothing changes until one of them — never the reporter — approves. A product its team never had here, or a rack a count holds, is refused with the server's own words.";

// FoundRequestCreateRequest.note's max_len — the box stops where the server would refuse (a-limited-field-shows-its-count).
const NOTE_MAX = 200;

// REPORT FOUND — the rack page's door to a found request (staff-may-report-a-found). It is the Adjust dialog's Found
// with the rack already chosen and the product picked here, because a person standing at a shelf holds the units, not a
// product page: staff have no Adjust screen. It posts nothing (an-adjust-found-waits-for-the-owner-or-admin).
export function ReportFoundDialog({
  warehouseId,
  rackId,
  rackCode,
  open,
  onOpenChange,
}: {
  warehouseId: bigint;
  rackId: bigint;
  rackCode: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  // FULL SCREEN ONLY ON A PHONE — by the JS breakpoint, never a responsive `size`: Chakra merges a responsive variant, so
  // `{ base: "full", md: ... }` kept full's min-height on desktop and stretched the dialog to the window's height.
  const isMobile = useIsMobile();
  const report = useReportFound();

  const [product, setProduct] = useState<{ id: bigint; name: string; code: string } | null>(null);
  const [amount, setAmount] = useState("1");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");

  const amountNum = Number(amount);
  const amountValid = Number.isInteger(amountNum) && amountNum >= 1;

  function close(next: boolean) {
    if (!next) {
      setProduct(null);
      setAmount("1");
      setNote("");
      setError("");
    }
    onOpenChange(next);
  }

  function submit() {
    if (!product || !amountValid) return;
    setError("");
    report.mutate(
      { teamId: warehouseId, productId: product.id, rackId, quantity: BigInt(amountNum), note },
      {
        onSuccess: () => {
          toaster.create({
            type: "success",
            title: t("inventory.adjustFoundSentToast", { productCode: product.code, count: amountNum }),
            description: t("inventory.adjustFoundSentToastDetail"),
          });
          close(false);
        },
        // A never-stocked product and a counted rack are refused by the server, which names the product or the count.
        onError: (err) => setError(rpcError(err)),
      },
    );
  }

  return (
    <Dialog.Root open={open} onOpenChange={(e) => close(e.open)} size={isMobile ? "full" : "md"}>
      <Portal>
        <Dialog.Backdrop />
        <Dialog.Positioner>
          <Dialog.Content data-testid="report-found-dialog">
            <Dialog.Header>
              <Dialog.Title>{t("racks.reportFound.title", { code: rackCode })}</Dialog.Title>
            </Dialog.Header>
            <Dialog.Body>
              <Stack gap="card">
                {/* ONE LINE (owner: *"alertnya kepanjangan, ada yang lebih ringkas?"*, a-found-waits-in-one-line) — that it
                    waits, who approves it, and that the reporter does not ("lain"). */}
                <Alert.Root status="info" data-testid="report-found-waits">
                  <Alert.Indicator>
                    <Icon as={Hourglass} boxSize="4" />
                  </Alert.Indicator>
                  <Alert.Content>
                    <Alert.Title fontWeight="normal">{t("inventory.foundWaits")}</Alert.Title>
                  </Alert.Content>
                </Alert.Root>

                <Field.Root required>
                  <Field.Label>
                    {t("racks.reportFound.product")}
                    <Field.RequiredIndicator />
                  </Field.Label>
                  {/* What THIS warehouse holds or has held — any team's, at 0 or not (a-warehouse-picks-only-what-it-has-held).
                      Staff may not discover every team's catalogue, and a product never stocked here is refused anyway. */}
                  <ProductSelect
                    teamId={warehouseId}
                    scope="warehouse"
                    portalled={false}
                    value={product?.id ?? 0n}
                    placeholder={t("racks.reportFound.productPlaceholder")}
                    onChange={(p) => {
                      setProduct(p ? { id: p.id, name: p.name, code: p.productCode } : null);
                      setError("");
                    }}
                  />
                  <Field.HelperText>{t("inventory.pickHeldHelp")}</Field.HelperText>
                </Field.Root>

                <Field.Root required>
                  <Field.Label>{t("inventory.adjustQty_found")}</Field.Label>
                  {/* A count of a few units — a box its size, not the dialog's width (owner: *"jumlahnya tolong sedikit
                      dipersempit"*); a phone keeps the full width for the thumb. */}
                  <QuantityInput
                    min={1}
                    width={isMobile ? "full" : "40"}
                    size="sm"
                    value={amount}
                    testId="report-found-amount"
                    onChange={setAmount}
                  />
                  <Field.HelperText>{t("inventory.adjustFoundHelper")}</Field.HelperText>
                </Field.Root>

                <Field.Root>
                  <Field.Label>{t("inventory.adjustNote")}</Field.Label>
                  {/* A two-row box, as the rack's other dialogs' notes (owner: *"catatan textarea"*) — where it was found
                      is often a sentence. */}
                  <Textarea
                    rows={2}
                    value={note}
                    maxLength={NOTE_MAX}
                    placeholder={t("inventory.adjustFoundNotePlaceholder")}
                    data-testid="report-found-note"
                    onChange={(e) => setNote(e.target.value)}
                  />
                  <CharCount value={note} max={NOTE_MAX} testId="report-found-note-count" />
                </Field.Root>

                {error && (
                  <Alert.Root status="warning" data-testid="report-found-error">
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
                <Button variant="outline" data-testid="report-found-cancel">
                  {t("inventory.cancel")}
                </Button>
              </Dialog.ActionTrigger>
              <Button
                colorPalette="brand"
                disabled={!product || !amountValid}
                loading={report.isPending}
                onClick={submit}
                data-testid="report-found-submit"
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

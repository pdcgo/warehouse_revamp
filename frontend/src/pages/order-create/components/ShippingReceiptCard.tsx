import { useEffect, useState } from "react";
import {
  Box,
  Button,
  Card,
  Field,
  Flex,
  Icon,
  Image,
  Input,
  SimpleGrid,
  Spinner,
  Stack,
  Text,
} from "@chakra-ui/react";
import { useTranslation } from "react-i18next";
import { ExternalLink, FileText, Paperclip } from "lucide-react";

import { documentClient, rpcError } from "../../../api/clients";
import { ReceiptUpload, hasReceipt, useReceiptUpload } from "../../../components/orders/ReceiptUpload";
import type { ReceiptValue } from "../../../components/orders/ReceiptUpload";
import { ShippingSelect } from "../../../components/pickers/ShippingSelect";
import type { Marketplace } from "../../../gen/warehouse/marketplace/v1/marketplace_pb";
import { checkRefAgainstMarketplace, checkTrackingAgainstCourier } from "../checks";
import { ImagePreview } from "./ImagePreview";
import type { PreviewTarget } from "./ImagePreview";
import { NotImplemented } from "./NotImplemented";

// THE RECEIPT FILE COMES FIRST, AND THE TWO NUMBERS IT CARRIES SIT BESIDE IT (owner).
//
// The receipt file — the slip the marketplace prints, or a photo of the courier's — is ONE document
// carrying BOTH the storefront's order id and the courier's tracking number. Until now this screen had
// them three cards apart — the id near the top, the courier and the resi at the bottom inside
// Customer Information — and the file itself was nowhere at all, because a receipt is a private
// document only the order's detail page ever reads back. So
// the person typing had the receipt file open in another window and copied one number into the top
// of the form and the other into the bottom.
//
// ⚠ LEFT IS THE SOURCE, RIGHT IS WHAT IS READ OFF IT. The reading order carries the relationship on
// its own; an arrow or a sentence explaining that these three belong together would be chrome doing
// what the layout already does.
//
// It composes `ReceiptUpload` and `ShippingSelect` rather than `ShippingReceipt`, whose one
// contribution is the vertical stack this card exists to replace.

interface ShippingReceiptCardProps {
  teamId: bigint;
  receipt: ReceiptValue;
  onReceiptChange: (value: ReceiptValue) => void;
  /** The storefront's own id for the order — printed on the same receipt file. */
  orderRefId: string;
  onOrderRefIdChange: (value: string) => void;
  /** The courier's tracking number, raw: what is typed is what is stored. */
  trackingCode: string;
  onTrackingCodeChange: (value: string) => void;
  /** A `Shipping.code` from the shared courier catalogue (`jne`, `sicepat`), never a typed name. */
  shippingCode: string;
  onShippingCodeChange: (value: string) => void;
  /** Which storefront the order came from — the reference's format is checked against it. */
  marketplace: Marketplace;
  /** True once the file has been read and something was filled in from it. */
  filledFromFile?: boolean;
}

export function ShippingReceiptCard({
  teamId,
  receipt,
  onReceiptChange,
  orderRefId,
  onOrderRefIdChange,
  trackingCode,
  onTrackingCodeChange,
  shippingCode,
  onShippingCodeChange,
  marketplace,
  filledFromFile,
}: ShippingReceiptCardProps) {
  const { t } = useTranslation();
  const [preview, setPreview] = useState<PreviewTarget | null>(null);
  const [dragging, setDragging] = useState(false);
  const { url, loading } = useReceiptUrl(teamId, receipt);
  // The SAME upload the button performs — one sequence, two ways to start it.
  const { upload, busy: uploading } = useReceiptUpload({ teamId, onChange: onReceiptChange });

  const attached = hasReceipt(receipt);
  const pdf = receipt.mimeType === "application/pdf";
  // THE PAIR, CHECKED GENTLY. A receipt file on screen with one of its two numbers still blank is
  // usually something forgotten — but never an error: a phone order has numbers and no file, and a
  // file often arrives before anybody has typed anything.
  const missingHalf = attached && (orderRefId.trim() === "" || trackingCode.trim() === "");

  // ⚠ CHECKED WHILE IT IS TYPED, not only at the end. A format that does not belong to the courier
  // or the storefront is worth saying HERE, beside the box, while the paper is still in the person's
  // hand — the gate at Create is the backstop, not the first mention.
  const courierFinding = checkTrackingAgainstCourier(trackingCode, shippingCode);
  const marketplaceFinding = checkRefAgainstMarketplace(orderRefId, marketplace);

  return (
    <Card.Root>
      <Card.Header>
        <Card.Title>{t("orderForm.resi.title")}</Card.Title>
        <Card.Description>{t("orderForm.resi.help")}</Card.Description>
      </Card.Header>

      <Card.Body>
        <SimpleGrid columns={{ base: 1, md: 2 }} gap="card" alignItems="start">
          {/* ── THE RECEIPT FILE ───────────────────────────────────────────────────────────────── */}
          <Stack gap="2">
            {/* ⚠ A FIXED FRAME, NOT ONE THE FILE DECIDES (owner). A portrait label and a wide slip
                are the same rectangle here — the card's height stops depending on what somebody
                attached, which is what was pushing the column about.

                IT ALSO TAKES A DROP. The file is usually already on screen (downloaded from the
                marketplace a second ago), and dragging it here is one gesture against three. The
                button underneath does the same thing through the same hook. */}
            <Box
              borderWidth="1px"
              borderStyle={attached ? "solid" : "dashed"}
              borderColor={dragging ? "brand.focusRing" : "border"}
              bg={dragging ? "brand.subtle" : "bg.subtle"}
              borderRadius="l2"
              h="52"
              p="2"
              display="flex"
              alignItems="center"
              justifyContent="center"
              overflow="hidden"
              transition="background 0.12s, border-color 0.12s"
              data-testid="order-create-receipt-preview"
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);

                const file = e.dataTransfer.files[0];
                if (file) void upload(file);
              }}
            >
              {!attached && !uploading && (
                <Stack gap="1" align="center" textAlign="center">
                  <Icon as={Paperclip} boxSize="5" color="fg.subtle" />
                  <Text fontSize="sm" color="fg.muted">
                    {t("orderForm.resi.noFile")}
                  </Text>
                  <Text fontSize="xs" color="fg.subtle">
                    {t("orderForm.resi.dropHere")}
                  </Text>
                </Stack>
              )}

              {(uploading || (attached && loading)) && <Spinner size="sm" colorPalette="brand" />}

              {/* ⚠ A PDF IS NAMED, NOT RENDERED (owner). An embedded page at this size is a grey
                  rectangle with unreadable type — it looks broken and tells you nothing. The file
                  says what it is; Open is how you read it. */}
              {attached && !loading && !uploading && pdf && (
                <Stack gap="1" align="center" textAlign="center" maxW="full">
                  <Icon as={FileText} boxSize="6" color="fg.muted" />
                  <Text fontSize="sm" lineClamp={1} maxW="full">
                    {receipt.filename}
                  </Text>
                  <Text fontSize="xs" color="fg.subtle">
                    {t("orderForm.resi.pdfNoPreview")}
                  </Text>
                </Stack>
              )}

              {attached && !loading && !uploading && !pdf && url && (
                <Image
                  src={url}
                  alt={receipt.filename}
                  maxH="full"
                  maxW="full"
                  objectFit="contain"
                  cursor="pointer"
                  data-testid="order-create-receipt-image"
                  onClick={() =>
                    setPreview({ src: url, title: receipt.filename, caption: receipt.mimeType })
                  }
                />
              )}
            </Box>

            <Flex align="center" gap="2" wrap="wrap">
              {/* The attach / replace / remove row, exactly as every other screen shows it. */}
              <Box flex="1" minW="0">
                <ReceiptUpload teamId={teamId} value={receipt} onChange={onReceiptChange} />
              </Box>

              {attached && url && (
                <Button
                  type="button"
                  size="xl"
                  variant="outline"
                  alignSelf="start"
                  data-testid="order-create-receipt-open"
                  onClick={() => window.open(url, "_blank", "noopener,noreferrer")}
                >
                  <Icon as={ExternalLink} boxSize="4" />
                  {t("orders.receiptOpen")}
                </Button>
              )}
            </Flex>
          </Stack>

          {/* ── WHAT IS PRINTED ON IT ──────────────────────────────────────────────────────────── */}
          <Stack gap="card">
            <Field.Root>
              <Field.Label>{t("orders.orderExternalRefId")}</Field.Label>
              <Input
                value={orderRefId}
                maxLength={128}
                placeholder={t("orders.orderExternalRefIdPlaceholder")}
                data-testid="order-external-ref-id"
                onChange={(e) => onOrderRefIdChange(e.target.value)}
              />
              {marketplaceFinding && (
                <Text fontSize="xs" color="warning.fg" data-testid="order-check-inline-refMarketplace">
                  {t(`orderForm.checks.${marketplaceFinding.id}`, marketplaceFinding.values ?? {})}
                </Text>
              )}
            </Field.Root>

            <Field.Root>
              <Field.Label>
                <Flex align="center" gap="2" wrap="wrap">
                  {t("orderForm.resi.trackingNumber")}
                  <NotImplemented id="receiptCode" />
                </Flex>
              </Field.Label>
              {/* RAW. What is typed is what is stored: it is pasted into the courier's tracking box,
                  and one we have "tidied" is one that comes back not found. */}
              <Input
                value={trackingCode}
                placeholder={t("orders.receiptCodePlaceholder")}
                data-testid="order-receipt-code"
                onChange={(e) => onTrackingCodeChange(e.target.value)}
              />
              {courierFinding && (
                <Text fontSize="xs" color="warning.fg" data-testid="order-check-inline-trackingCourier">
                  {t(`orderForm.checks.${courierFinding.id}`, courierFinding.values ?? {})}
                </Text>
              )}
            </Field.Root>

            <Field.Root>
              <Field.Label>{t("orders.shipping")}</Field.Label>
              <ShippingSelect value={shippingCode} onChange={onShippingCodeChange} />
            </Field.Root>

            <Text fontSize="xs" color={missingHalf ? "warning.fg" : "fg.muted"} data-testid="order-create-resi-hint">
              {missingHalf ? t("orderForm.resi.halfMissing") : t("orderForm.resi.bothPrinted")}
            </Text>

            {/* WHAT THE FILE FILLED IN — said out loud, because a box that filled itself looks
                exactly like a box somebody typed, and only one of the two should be trusted without
                a second look. */}
            {filledFromFile && (
              <Flex align="center" gap="2">
                <NotImplemented id="receiptScan" />
                <Text fontSize="xs" color="fg.muted" data-testid="order-create-scan-filled">
                  {t("orderForm.resi.filledFromFile")}
                </Text>
              </Flex>
            )}
          </Stack>
        </SimpleGrid>
      </Card.Body>

      <ImagePreview target={preview} onClose={() => setPreview(null)} />
    </Card.Root>
  );
}

// THE SIGNED URL FOR THE FILE ON SCREEN.
//
// Same call the order detail page makes (`ReceiptCard`), and the rule it follows is the same one: a
// URL is minted for a receipt somebody is ACTUALLY LOOKING AT — here the one they just attached — and
// never for every order in a list. It is re-fetched when the document changes and dropped when the
// receipt is removed.
function useReceiptUrl(teamId: bigint, receipt: ReceiptValue) {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const documentId = receipt.documentId;

  useEffect(() => {
    if (!documentId || teamId <= 0n) {
      setUrl("");
      return;
    }

    let cancelled = false;
    setLoading(true);

    documentClient
      .getDownloadUrl({ teamId, documentId })
      .then((res) => {
        if (!cancelled) setUrl(res.url);
      })
      .catch((err) => {
        // A preview that cannot load is not a failed attachment: the file is uploaded and the order
        // still carries it. The card falls back to the upload row's filename.
        if (!cancelled) {
          setUrl("");
          void rpcError(err);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [teamId, documentId]);

  return { url, loading };
}

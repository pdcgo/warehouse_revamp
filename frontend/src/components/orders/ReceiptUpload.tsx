import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, FileUpload, Flex, Icon, IconButton, Stack, Text } from "@chakra-ui/react";
import { FileText, ImageIcon, Paperclip, X } from "lucide-react";
import { documentClient, rpcError } from "../../api/clients";
import { DocumentResourceType } from "../../gen/warehouse/document/v1/document_pb";
import { toaster } from "../feedback/Toaster";

// What the order carries: a REFERENCE to the uploaded document, not the file. Matches
// warehouse.selling.v1.OrderReceipt exactly.
export interface ReceiptValue {
  documentId: string;
  filename: string;
  mimeType: string;
}

export const emptyReceipt: ReceiptValue = { documentId: "", filename: "", mimeType: "" };

export function hasReceipt(r: ReceiptValue): boolean {
  return r.documentId !== "";
}

// What a shipping receipt actually arrives as: a photo taken of the courier's slip, or the PDF the
// marketplace prints. Both, deliberately — narrowing this to images would make the person print and
// photograph a PDF they already have.
const ACCEPT = "image/*,application/pdf";

// The server's own ceiling (docstore.Config.MaxSizeBytes). Checked here too so an oversized file is
// refused before it is uploaded rather than after — the same file, the same answer, one round-trip
// earlier.
const MAX_BYTES = 10 * 1024 * 1024;

function isPdf(mimeType: string): boolean {
  return mimeType === "application/pdf";
}

// ReceiptUpload attaches ONE shipping receipt to the order being written (owner).
//
// The bytes go straight to storage through document_service's two-phase upload (RequestUpload → PUT
// → ConfirmUpload), exactly as a product image does; what comes back and is held here is the
// document's id plus its labels. The document is PRIVATE — an ORDER_RECEIPT names a buyer and where
// their parcel went — so there is no preview to render from a public URL. Reading it back is a
// signed-URL call on the order's detail page.
//
// ONE receipt, replaced rather than accumulated: an order ships once, and a list of receipts would
// leave "which of these is the real one?" for somebody to answer later.
export function ReceiptUpload({
  teamId,
  value,
  onChange,
  disabled,
}: {
  teamId: bigint;
  value: ReceiptValue;
  onChange: (receipt: ReceiptValue) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  // Remounting the picker after every commit resets its internal file list, which otherwise
  // accumulates across picks and would make the next pick's acceptedFiles a stale sum (the same
  // reason ProductImagesInput carries this key).
  const [pickerKey, setPickerKey] = useState(0);
  // A synchronous guard: FileUpload can fire onFileChange twice for one pick, and state lags.
  const uploadingRef = useRef(false);

  async function upload(file: File) {
    if (uploadingRef.current) {
      return;
    }

    if (file.size > MAX_BYTES) {
      toaster.create({
        type: "error",
        title: t("orders.receiptTooLarge", { max: MAX_BYTES / (1024 * 1024) }),
      });
      setPickerKey((k) => k + 1);

      return;
    }

    uploadingRef.current = true;
    setBusy(true);

    try {
      // 1. Ask where to put the bytes. A receipt is PRIVATE, so no public URL comes back — the id is
      //    what the order stores.
      const req = await documentClient.requestUpload({
        teamId,
        resourceType: DocumentResourceType.ORDER_RECEIPT,
        contentType: file.type,
        sizeBytes: BigInt(file.size),
        filename: file.name,
      });

      // 2. PUT the file straight to storage, echoing the signed headers verbatim.
      const res = await fetch(req.uploadUrl, {
        method: req.method,
        headers: req.headers,
        body: file,
      });

      if (!res.ok) {
        throw new Error(`Upload failed (${res.status} ${res.statusText})`);
      }

      // 3. Confirm — promotes the pending row into a real Document.
      const conf = await documentClient.confirmUpload({ uploadToken: req.uploadToken });
      const doc = conf.document;

      if (!doc) {
        throw new Error("Upload confirmed without a document");
      }

      onChange({
        documentId: doc.id,
        filename: doc.filename || file.name,
        mimeType: doc.mimeType || file.type,
      });
    } catch (err) {
      toaster.create({ type: "error", title: t("orders.receiptFailed"), description: rpcError(err) });
    } finally {
      setBusy(false);
      uploadingRef.current = false;
      setPickerKey((k) => k + 1);
    }
  }

  return (
    <Stack gap="card" data-testid="order-receipt-upload">
      {hasReceipt(value) && (
        <Flex
          align="center"
          gap="2"
          borderWidth="1px"
          borderRadius="md"
          px="3"
          py="2"
          data-testid="order-receipt-attached"
        >
          {/* The file's KIND, from its mime type — a PDF and a photo of a slip are the same
              attachment to this form, and the icon is the only thing that says which arrived. */}
          <Icon as={isPdf(value.mimeType) ? FileText : ImageIcon} boxSize="4" color="fg.muted" />
          <Text fontSize="sm" lineClamp={1} flex="1">
            {value.filename}
          </Text>
          <IconButton
            size="xs"
            variant="ghost"
            aria-label={t("orders.receiptRemove")}
            data-testid="order-receipt-remove"
            disabled={disabled || busy}
            // Detaches it from the ORDER only. The uploaded document is left where it is: nothing
            // here owns it yet, and deleting a file because a form changed its mind is how a receipt
            // disappears from an order that was already placed with it.
            onClick={() => onChange(emptyReceipt)}
          >
            <Icon as={X} boxSize="4" />
          </IconButton>
        </Flex>
      )}

      <FileUpload.Root
        key={pickerKey}
        accept={ACCEPT}
        maxFiles={1}
        disabled={disabled || busy}
        onFileChange={(details) => {
          const file = details.acceptedFiles[0];
          if (file) void upload(file);
        }}
      >
        <FileUpload.HiddenInput />
        <FileUpload.Trigger asChild>
          <Button
            variant="outline"
            colorPalette="brand"
            loading={busy}
            disabled={disabled}
            data-testid="order-receipt-pick"
          >
            <Icon as={Paperclip} boxSize="4" />
            {hasReceipt(value) ? t("orders.receiptReplace") : t("orders.receiptAttach")}
          </Button>
        </FileUpload.Trigger>
      </FileUpload.Root>

      <Text fontSize="xs" color="fg.muted">
        {t("orders.receiptHelp")}
      </Text>
    </Stack>
  );
}

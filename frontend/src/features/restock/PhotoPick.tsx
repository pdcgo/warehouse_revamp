import { useEffect, useMemo, useRef } from "react";
import type { ReactNode } from "react";
import { Box, Button, FileUpload, Flex, HStack, Icon, IconButton, Image, Text } from "@chakra-ui/react";
import { useTranslation } from "react-i18next";
import { Camera, X } from "lucide-react";

import { useReceiptUpload } from "../../components/orders/ReceiptUpload";
import type { DoorPhoto } from "./doorPhoto";

// ONE PHOTO TAKEN AT THE DOOR — the broken units' (a-broken-product-carries-a-photo) and the courier's slip
// (the-courier-slip-has-an-optional-photo). One per thing, replaced rather than added to, as the restock's Foto resi is.
// Optional wherever it sits: it never holds an act up — only an upload still running does, for the seconds it runs.
//
// On a phone the picker opens the CAMERA (`capture`): the person is standing over the box, and a gallery is one more step
// between them and the picture.
//
// KEPT, the way the restock's label photo is (`uploadTo` — the warehouse's team): the moment a photo is picked it goes up
// through document_service's two-phase upload, an order receipt as the label photo's ReceiptUpload stores it
// (useReceiptUpload: the same 15 MB ceiling, the same refusal), and the act — Terima, or Tandai Tiba for the slip
// (the-courier-charge-is-noted-at-tiba-and-final-at-terima) — sends its document id. A failed upload is said in a toast
// and the photo goes back to what it was. WITHOUT `uploadTo` the file is only shown, never uploaded: an upload nothing
// points at is a file nobody can find again.
//
// A photo the restock ALREADY keeps (no file here — the slip noted at Tiba, as Terima opens with it) is shown from its
// signed link, named as kept; it is replaced or removed like any other.
export function PhotoPick({
  value,
  onChange,
  uploadTo,
  alt,
  mark,
  testId,
}: {
  value: DoorPhoto | null;
  onChange: (photo: DoorPhoto | null) => void;
  /** The team the photo is kept under — given, a pick is uploaded at once; absent, it is only shown. */
  uploadTo?: bigint;
  /** What the picture shows — said to a screen reader. */
  alt: string;
  mark?: ReactNode;
  /**
   * `<testId>-pick`, `<testId>-input`, `<testId>-shown` (its `data-state`: `kept`, `uploading` or `shown`),
   * `<testId>-remove`.
   */
  testId: string;
}) {
  const { t } = useTranslation();
  const file = value?.file ?? null;
  // A local preview of the picked file, released when it is replaced or the control goes.
  const url = useMemo(() => (file ? URL.createObjectURL(file) : ""), [file]);
  useEffect(() => () => (url ? URL.revokeObjectURL(url) : undefined), [url]);
  // What is shown: the picked file, or — for a photo the restock already keeps — its signed link ("" until read).
  const shown = url || (value?.link ?? "");

  // What was there before the pick — put back if its upload fails — and the file being sent.
  const before = useRef<DoorPhoto | null>(null);
  const sending = useRef<File | null>(null);

  const { upload, busy, pickerKey } = useReceiptUpload({
    teamId: uploadTo ?? 0n,
    failedTitle: t("restock.photo.uploadFailed"),
    // The upload has started (past the size check): show the photo at once, still uploading.
    onFile: (started) => {
      if (started) {
        sending.current = started;
        onChange({ file: started, documentId: "" });
        return;
      }
      // It failed — said in the hook's toast — so the photo goes back to what it was.
      onChange(before.current);
    },
    onChange: (receipt) => {
      if (sending.current) onChange({ file: sending.current, documentId: receipt.documentId });
    },
  });

  function pick(picked: File) {
    if (uploadTo === undefined) {
      onChange({ file: picked, documentId: "" });
      return;
    }

    before.current = value;
    void upload(picked);
  }

  const state = !value ? "" : uploadTo === undefined ? "shown" : value.documentId ? "kept" : "uploading";

  return (
    <Flex gap="2" align="center" wrap="wrap" data-testid={testId}>
      {value && (
        <HStack gap="2" minW="0" flex="1" data-state={state} data-testid={`${testId}-shown`}>
          {shown ? (
            <Image src={shown} alt={alt} boxSize="12" objectFit="cover" borderRadius="md" opacity={busy ? 0.6 : 1} />
          ) : (
            <Box boxSize="12" borderRadius="md" bg="bg.muted" flexShrink={0} />
          )}
          <Text fontSize="xs" color="fg.muted" lineClamp={1} minW="0">
            {file ? file.name : t("restock.photo.kept")}
          </Text>
          <IconButton
            size="xs"
            variant="ghost"
            aria-label={t("restock.photo.remove")}
            data-testid={`${testId}-remove`}
            // Not while it uploads: the upload would land after and put the photo back.
            disabled={busy}
            onClick={() => onChange(null)}
          >
            <Icon as={X} boxSize="4" />
          </IconButton>
        </HStack>
      )}

      {/* Remounted per pick (and after every upload), so picking the same file twice is still a pick. */}
      <FileUpload.Root
        key={`${file ? `${file.name}:${file.lastModified}` : value ? `kept:${value.documentId}` : "none"}:${pickerKey}`}
        accept="image/*"
        capture="environment"
        maxFiles={1}
        disabled={busy}
        onFileChange={(details) => {
          const picked = details.acceptedFiles[0];
          if (picked) pick(picked);
        }}
        w="auto"
      >
        <FileUpload.HiddenInput data-testid={`${testId}-input`} />
        <FileUpload.Trigger asChild>
          <Button size="xs" variant="outline" loading={busy} data-testid={`${testId}-pick`}>
            <Icon as={Camera} boxSize="4" />
            {value ? t("restock.photo.replace") : t("restock.photo.add")}
          </Button>
        </FileUpload.Trigger>
      </FileUpload.Root>

      {mark}
    </Flex>
  );
}

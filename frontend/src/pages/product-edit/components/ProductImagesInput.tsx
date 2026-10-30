import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Badge, Box, Button, FileUpload, Icon, IconButton, Image, SimpleGrid, Spinner, Stack, Text } from "@chakra-ui/react";
import { ImagePlus, Plus, Star, X } from "lucide-react";
import { documentClient, rpcError } from "../../../api/clients";
import { DocumentResourceType } from "../../../gen/warehouse/document/v1/document_pb";
import { toaster } from "../../../components/feedback/Toaster";

// One product image, as the product RPCs carry it: the full public URL plus its (best-effort)
// thumbnail. Both come from the two-phase document_service upload.
export interface ProductImageValue {
  url: string;
  thumbnailUrl: string;
}

// ProductImagesInput manages a product's gallery — up to `max` images (default 5). Each picked file
// is uploaded via document_service (RequestUpload → PUT the bytes → ConfirmUpload, exactly like the
// team/profile picture) and the resulting public URL + thumbnail are appended. The FIRST image is
// the cover. Upload is scoped to `teamId` (document_service reads it via use_scope).
//
// ONE BIG BOX AND FOUR SMALL ONES (owner: *"untuk gambar aku ingin form drag drop juga, tampilkan 5 kotak, 1 kotak besar
// sebagai gambar utama"*, then *"oke coba dulu"* to the sketch, `the-gallery-is-a-cover-and-four`):
//
//   ┌──────────────────────┐
//   │ Sampul             ✕ │   the cover — the first image, always the big box
//   └──────────────────────┘
//   [ ★ ✕ ] [ ★ ✕ ] [ + ] [ + ]   the rest; ★ makes one the cover, + picks a file
//
// FILES ARE DROPPED ANYWHERE ON THE GALLERY, several at once, and fill the empty boxes in order; clicking an empty box
// picks them instead. The COVER CHANGES BY ★, not by dragging a box onto the big one: a reorder by drag does not work
// under a finger, and this form is used from a phone at the shelf too.
//
// `value` (the uploaded URLs) is our single source of truth for how many images exist. Chakra's
// FileUpload keeps its OWN cumulative list of picked File objects, which would drift from `value`
// (it accumulates across picks and is not touched by our Remove) — so we REMOUNT it after every
// commit (a bumped `pickerKey`) to reset that internal list, and cap `maxFiles` to the remaining
// room. That way each pick's `acceptedFiles` is exactly the newly-chosen files, never a stale sum.
export function ProductImagesInput({
  teamId,
  value,
  onChange,
  max = 5,
}: {
  teamId: bigint;
  value: ProductImageValue[];
  onChange: (images: ProductImageValue[]) => void;
  max?: number;
}) {
  const { t } = useTranslation();
  // How many files are uploading — the boxes they will fill spin in place meanwhile.
  const [pending, setPending] = useState(0);
  const [pickerKey, setPickerKey] = useState(0);
  // A synchronous guard: FileUpload can fire onFileChange more than once per pick (accept + reject
  // events), and React state updates lag — a ref prevents the second fire from re-uploading.
  const uploadingRef = useRef(false);

  const busy = pending > 0;
  const full = value.length >= max;

  // commit updates the images AND resets the picker so its internal file list can't accumulate.
  function commit(next: ProductImageValue[]) {
    onChange(next);
    setPickerKey((k) => k + 1);
  }

  async function uploadOne(file: File): Promise<ProductImageValue | null> {
    try {
      // 1. Ask where to put the bytes (a product image is public, so it gets a stable URL + thumb).
      const req = await documentClient.requestUpload({
        teamId,
        resourceType: DocumentResourceType.PRODUCT_IMAGE,
        contentType: file.type,
        sizeBytes: BigInt(file.size),
        filename: file.name,
      });

      // 2. PUT the raw file straight to object storage, echoing the signed headers verbatim.
      const res = await fetch(req.uploadUrl, { method: req.method, headers: req.headers, body: file });

      if (!res.ok) {
        throw new Error(`Upload failed (${res.status} ${res.statusText})`);
      }

      // 3. Confirm — promotes the pending upload into a real Document with its public URLs.
      const conf = await documentClient.confirmUpload({ uploadToken: req.uploadToken });

      return {
        url: conf.document?.publicUrl || conf.document?.thumbnailUrl || "",
        thumbnailUrl: conf.document?.thumbnailUrl || conf.document?.publicUrl || "",
      };
    } catch (err) {
      toaster.create({ type: "error", title: t("products.toast.uploadFailed"), description: rpcError(err) });

      return null;
    }
  }

  async function onFiles(files: File[]) {
    if (uploadingRef.current) {
      return;
    }

    // Only take as many as there is room for; ignore the rest with a nudge. (The picker's maxFiles
    // already caps a single pick to the remaining room; this is the belt-and-suspenders cap.)
    const room = max - value.length;
    const take = files.slice(0, room);

    if (take.length === 0) {
      return;
    }

    if (files.length > room) {
      toaster.create({
        type: "info",
        title: t("products.toast.tooManyImages", { max }),
        description: t("products.toast.keptFirst", { room }),
      });
    }

    uploadingRef.current = true;
    setPending(take.length);

    const added: ProductImageValue[] = [];
    for (const file of take) {
      const img = await uploadOne(file);

      if (img) {
        added.push(img);
      }
    }

    setPending(0);
    uploadingRef.current = false;

    // commit even when nothing uploaded successfully, to reset the picker for the next attempt.
    commit(added.length > 0 ? [...value, ...added] : value);
  }

  function removeAt(index: number) {
    commit(value.filter((_, i) => i !== index));
  }

  // ★ — the picked image to the front; the others keep their order, so the old cover becomes the first small box.
  function makeCover(index: number) {
    commit([value[index]!, ...value.filter((_, i) => i !== index)]);
  }

  // One box: a picture, a spinner for a file on its way into it, or an empty box that picks files.
  function slot(index: number) {
    const cover = index === 0;
    const image = value[index];

    if (image) {
      return (
        <Box
          key={`${image.url}-${index}`}
          position="relative"
          borderWidth="1px"
          borderRadius="l2"
          overflow="hidden"
          data-slot={cover ? "cover" : "small"}
        >
          <Image
            src={image.thumbnailUrl || image.url}
            alt={t("products.imageAlt", { n: index + 1 })}
            aspectRatio={1}
            objectFit="cover"
            w="full"
            data-testid={`product-image-${index}`}
          />

          {cover ? (
            <Badge position="absolute" top="2" left="2" size="sm" colorPalette="brand">
              {t("products.cover")}
            </Badge>
          ) : (
            <IconButton
              position="absolute"
              bottom="1"
              left="1"
              size="2xs"
              variant="solid"
              colorPalette="gray"
              aria-label={t("products.makeCover")}
              title={t("products.makeCover")}
              data-testid={`make-cover-product-image-${index}`}
              onClick={() => makeCover(index)}
            >
              <Icon as={Star} boxSize="3" />
            </IconButton>
          )}

          <IconButton
            position="absolute"
            top={cover ? "2" : "1"}
            right={cover ? "2" : "1"}
            size="2xs"
            variant="solid"
            colorPalette="error"
            aria-label={t("products.removeImage")}
            data-testid={`remove-product-image-${index}`}
            onClick={() => removeAt(index)}
          >
            <Icon as={X} boxSize="3" />
          </IconButton>
        </Box>
      );
    }

    if (index < value.length + pending) {
      return (
        <Box
          key={`uploading-${index}`}
          aspectRatio={1}
          borderWidth="1px"
          borderStyle="dashed"
          borderRadius="l2"
          display="flex"
          alignItems="center"
          justifyContent="center"
          data-slot={cover ? "cover" : "small"}
          data-testid={`product-image-uploading-${index}`}
        >
          <Spinner size={cover ? "md" : "sm"} colorPalette="brand" />
        </Box>
      );
    }

    // The FIRST empty box carries `add-product-image` — the one a person reaches for to add the next.
    const first = index === value.length + pending;

    return (
      <FileUpload.Trigger key={`empty-${index}`} asChild>
        <Button
          variant="outline"
          h="auto"
          w="full"
          aspectRatio={1}
          borderStyle="dashed"
          borderRadius="l2"
          color="fg.muted"
          flexDirection="column"
          gap="2"
          whiteSpace="normal"
          disabled={busy}
          aria-label={t("products.addImages")}
          data-slot={cover ? "cover" : "small"}
          data-testid={first ? "add-product-image" : `product-image-empty-${index}`}
        >
          {cover ? (
            <>
              <Icon as={ImagePlus} boxSize="8" />
              <Text textStyle="sm" maxW="15rem" textAlign="center">
                {t("products.imageDrop")}
              </Text>
            </>
          ) : (
            <Icon as={Plus} boxSize="5" />
          )}
        </Button>
      </FileUpload.Trigger>
    );
  }

  return (
    <Stack gap="card" data-testid="product-images-input">
      {/* FULL WIDTH, both the root and the dropzone — FileUpload's root lays its children out at their own width, so
          the gallery shrank to its content: one size empty, another while uploading, a third once filled, and all of
          it pushed to the card's left edge (owner: *"tengahkan, ukurannya tidak konsisten"*). */}
      <FileUpload.Root
        key={pickerKey}
        w="full"
        accept="image/*"
        maxFiles={Math.max(1, max - value.length)}
        disabled={busy || full}
        onFileChange={(details) => {
          if (details.acceptedFiles.length > 0) {
            void onFiles(details.acceptedFiles);
          }
        }}
      >
        <FileUpload.HiddenInput />
        {/* THE WHOLE GALLERY TAKES A DROP — the big box, the small ones, the gaps between. A click does not open the
            picker here (`disableClick`): the ★ and ✕ sit inside it, and only an EMPTY box picks files. While a file is
            dragged over it, the gallery says so in the main tone. */}
        <FileUpload.Dropzone
          disableClick
          display="block"
          w="full"
          // NEVER A POSTER (owner: *"gambar terlalu besar"*): the form's column holds the gallery to 22rem on a wide
          // screen; where the card is the whole width (a tablet), the boxes stop at 20rem.
          maxW="20rem"
          alignSelf="stretch"
          minH="auto"
          p="0"
          borderWidth="0"
          borderRadius="l2"
          bg="transparent"
          _hover={{ bg: "transparent" }}
          _dragging={{ bg: "brand.subtle", outline: "2px dashed", outlineColor: "brand.solid", outlineOffset: "4px" }}
          data-testid="product-images-dropzone"
        >
          <Stack gap="2">
            {slot(0)}
            <SimpleGrid columns={max - 1} gap="2">
              {Array.from({ length: max - 1 }, (_, i) => slot(i + 1))}
            </SimpleGrid>
          </Stack>
        </FileUpload.Dropzone>
      </FileUpload.Root>

      <Text color="fg.muted" fontSize="xs" data-testid="product-images-help">
        {t("products.imagesHelp", { used: value.length, max })}
      </Text>
    </Stack>
  );
}

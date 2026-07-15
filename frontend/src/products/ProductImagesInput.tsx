import { useRef, useState } from "react";
import { Badge, Box, Button, FileUpload, Icon, IconButton, Image, SimpleGrid, Stack, Text } from "@chakra-ui/react";
import { ImagePlus, X } from "lucide-react";
import { documentClient, rpcError } from "../api/clients";
import { DocumentResourceType } from "../gen/warehouse/document/v1/document_pb";
import { toaster } from "../components/Toaster";

// One product image, as the product RPCs carry it: the full public URL plus its (best-effort)
// thumbnail. Both come from the two-phase document_service upload.
export interface ProductImageValue {
  url: string;
  thumbnailUrl: string;
}

// ProductImagesInput manages a product's gallery — up to `max` images (default 5). Each picked file
// is uploaded via document_service (RequestUpload → PUT the bytes → ConfirmUpload, exactly like the
// team/profile picture) and the resulting public URL + thumbnail are appended. The FIRST image is
// the cover, badged as such. Upload is scoped to `teamId` (document_service reads it via use_scope).
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
  const [busy, setBusy] = useState(false);
  const [pickerKey, setPickerKey] = useState(0);
  // A synchronous guard: FileUpload can fire onFileChange more than once per pick (accept + reject
  // events), and React state updates lag — a ref prevents the second fire from re-uploading.
  const uploadingRef = useRef(false);

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
      toaster.create({ type: "error", title: "Upload failed", description: rpcError(err) });

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
      toaster.create({ type: "info", title: `Only ${max} images allowed`, description: `Kept the first ${room}.` });
    }

    uploadingRef.current = true;
    setBusy(true);

    const added: ProductImageValue[] = [];
    for (const file of take) {
      const img = await uploadOne(file);

      if (img) {
        added.push(img);
      }
    }

    setBusy(false);
    uploadingRef.current = false;

    // commit even when nothing uploaded successfully, to reset the picker for the next attempt.
    commit(added.length > 0 ? [...value, ...added] : value);
  }

  function removeAt(index: number) {
    commit(value.filter((_, i) => i !== index));
  }

  return (
    <Stack gap="card" data-testid="product-images-input">
      {value.length > 0 && (
        <SimpleGrid columns={{ base: 3, md: 5 }} gap="card">
          {value.map((img, i) => (
            <Box key={`${img.url}-${i}`} position="relative" borderWidth="1px" borderRadius="md" overflow="hidden">
              <Image
                src={img.thumbnailUrl || img.url}
                alt={`Image ${i + 1}`}
                aspectRatio={1}
                objectFit="cover"
                w="full"
                data-testid={`product-image-${i}`}
              />

              {i === 0 && (
                <Badge position="absolute" top="1" left="1" size="xs" colorPalette="brand">
                  Cover
                </Badge>
              )}

              <IconButton
                position="absolute"
                top="1"
                right="1"
                size="2xs"
                variant="solid"
                colorPalette="red"
                aria-label="Remove image"
                data-testid={`remove-product-image-${i}`}
                onClick={() => removeAt(i)}
              >
                <Icon as={X} boxSize="3" />
              </IconButton>
            </Box>
          ))}
        </SimpleGrid>
      )}

      <FileUpload.Root
        key={pickerKey}
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
        <FileUpload.Trigger asChild>
          <Button variant="outline" colorPalette="brand" loading={busy} disabled={full} data-testid="add-product-image">
            <Icon as={ImagePlus} />
            Add images
          </Button>
        </FileUpload.Trigger>
      </FileUpload.Root>

      <Text color="fg.muted" fontSize="xs">
        {value.length}/{max} images. The first is the cover. JPG or PNG.
      </Text>
    </Stack>
  );
}

import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ImagePlus, X } from "lucide-react";
import { documentClient, rpcError } from "../../../api/clients";
import { Badge } from "../../../components/ui/Badge";
import { Button, IconButton } from "../../../components/ui/Button";
import { DocumentResourceType } from "../../../gen/warehouse/document/v1/document_pb";
import { toaster } from "../../../components/Toaster";

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
// `value` (the uploaded URLs) is our single source of truth for how many images exist. The native
// file input keeps NO cumulative list of its own, so — unlike Chakra's FileUpload — there is nothing
// to drift from `value`; we still REMOUNT it after every commit (a bumped `pickerKey`) so its
// `.value` clears, which both resets the picked-file state and lets the same file be chosen again
// right after a Remove. Each pick's `files` is exactly the newly-chosen files, never a stale sum.
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
  const [busy, setBusy] = useState(false);
  const [pickerKey, setPickerKey] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  // A synchronous guard: the change handler can fire more than once per pick, and React state
  // updates lag — a ref prevents the second fire from re-uploading.
  const uploadingRef = useRef(false);

  const full = value.length >= max;

  // commit updates the images AND resets the picker so its file value can't linger.
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

    // Only take as many as there is room for; ignore the rest with a nudge.
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
    <div className="flex flex-col gap-card" data-testid="product-images-input">
      {value.length > 0 && (
        <div className="grid grid-cols-3 gap-card md:grid-cols-5">
          {value.map((img, i) => (
            <div
              key={`${img.url}-${i}`}
              className="relative overflow-hidden rounded-control border border-line"
            >
              <img
                src={img.thumbnailUrl || img.url}
                alt={`Image ${i + 1}`}
                className="aspect-square w-full object-cover"
                data-testid={`product-image-${i}`}
              />

              {i === 0 && (
                <Badge colorPalette="brand" className="absolute left-1 top-1">
                  {t("products.cover")}
                </Badge>
              )}

              <IconButton
                size="xs"
                variant="solid"
                colorPalette="red"
                aria-label="Remove image"
                data-testid={`remove-product-image-${i}`}
                className="absolute right-1 top-1"
                onClick={() => removeAt(i)}
              >
                <X className="size-3" />
              </IconButton>
            </div>
          ))}
        </div>
      )}

      {/* A hidden native input remounted on `pickerKey` so its value resets after every commit.
          The button below opens it; `onFiles` caps a pick to the remaining room. */}
      <input
        key={pickerKey}
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        disabled={busy || full}
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          if (files.length > 0) {
            void onFiles(files);
          }
        }}
      />

      <Button
        type="button"
        variant="outline"
        colorPalette="brand"
        loading={busy}
        disabled={full}
        data-testid="add-product-image"
        onClick={() => inputRef.current?.click()}
      >
        <ImagePlus className="size-4" />
        {t("products.addImages")}
      </Button>

      <p className="text-xs text-fg-muted">{t("products.imagesHelp", { used: value.length, max })}</p>
    </div>
  );
}

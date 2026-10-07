import { Box, Button, FileUpload, Float, Icon, Image, Text, useFileUploadContext } from "@chakra-ui/react";
import { Upload as UploadIcon, X } from "lucide-react";

// Upload is a file picker with a drop zone and a list of what has been chosen.
//
// Two rules it owns, both of which are about failing BEFORE the network rather than after:
//
//  1. `accept` AND `maxSize` ARE ENFORCED HERE, not only on the server. A 40MB photo from a phone
//     camera rejected after a two-minute upload on warehouse wifi is two minutes of someone's shift.
//     Rejecting it instantly, with the limit stated, is the difference between a rule and an ambush.
//  2. THE LIMITS ARE VISIBLE BEFORE THE PICK. The zone says what it takes and how big — a constraint
//     you only learn by violating it is a constraint nobody can plan around.
export const description =
  "A file picker with a drop zone that states its accepted types and size limit UP FRONT and enforces both before anything is uploaded.";

export interface UploadProps {
  // e.g. "image/*" or ".pdf,.csv". Also drives what the zone advertises.
  accept?: string;
  maxFiles?: number;
  // Bytes.
  maxSize?: number;
  onChange?(files: File[]): void;
  label?: string;
  disabled?: boolean;
}

function humanSize(bytes: number): string {
  if (bytes >= 1_048_576) return `${Math.round(bytes / 1_048_576)}MB`;
  return `${Math.round(bytes / 1024)}KB`;
}

export function Upload({
  accept,
  maxFiles = 1,
  maxSize = 5 * 1_048_576,
  onChange,
  label = "Drop a file here, or click to choose",
  disabled,
}: UploadProps) {
  return (
    <FileUpload.Root
      accept={accept}
      maxFiles={maxFiles}
      maxFileSize={maxSize}
      disabled={disabled}
      onFileChange={(e) => onChange?.(e.acceptedFiles)}
      data-testid="upload"
    >
      <FileUpload.HiddenInput />

      <FileUpload.Dropzone>
        <Icon as={UploadIcon} boxSize="5" color="fg.muted" />
        <FileUpload.DropzoneContent>
          <Text fontSize="sm">{label}</Text>
          {/* Rule 2: the limits are on screen BEFORE the pick, not in the error after it. */}
          <Text fontSize="xs" color="fg.muted" data-testid="upload-limits">
            {accept ? `${accept} · ` : ""}up to {humanSize(maxSize)}
            {maxFiles > 1 ? ` · ${maxFiles} files max` : ""}
          </Text>
        </FileUpload.DropzoneContent>
      </FileUpload.Dropzone>

      <FileUpload.ItemGroup>
        <FileUpload.Context>
          {({ acceptedFiles }) =>
            acceptedFiles.map((file) => (
              <FileUpload.Item key={file.name} file={file} data-testid="upload-item">
                <FileUpload.ItemPreview />
                <FileUpload.ItemName />
                <FileUpload.ItemSizeText />
                <FileUpload.ItemDeleteTrigger asChild>
                  <Button size="xs" variant="ghost" aria-label={`Remove ${file.name}`}>
                    <Icon as={X} boxSize="3.5" />
                  </Button>
                </FileUpload.ItemDeleteTrigger>
              </FileUpload.Item>
            ))
          }
        </FileUpload.Context>
      </FileUpload.ItemGroup>
    </FileUpload.Root>
  );
}

// The preview tile. Split out because it needs the upload context, which is only available beneath
// FileUpload.Root.
function ImagePreview({ placeholder }: { placeholder: string }) {
  const upload = useFileUploadContext();
  const file = upload.acceptedFiles[0];

  if (!file) {
    return (
      <FileUpload.Dropzone borderRadius="l3" minH="32">
        <Icon as={UploadIcon} boxSize="5" color="fg.muted" />
        <Text fontSize="sm">{placeholder}</Text>
      </FileUpload.Dropzone>
    );
  }

  return (
    <Box position="relative" data-testid="image-upload-preview">
      <Image
        src={URL.createObjectURL(file)}
        alt={file.name}
        borderRadius="l3"
        objectFit="cover"
        w="full"
        maxH="48"
      />
      <Float placement="top-end" offset="3">
        <FileUpload.ClearTrigger asChild>
          <Button size="xs" variant="solid" colorPalette="gray" aria-label="Remove image">
            <Icon as={X} boxSize="3.5" />
          </Button>
        </FileUpload.ClearTrigger>
      </Float>
    </Box>
  );
}

// ImageUpload is Upload for the case where the file IS a picture: it previews what was chosen
// instead of listing its filename.
//
// The preview is the entire point. Photos here are evidence — a damaged carton, a payment receipt,
// a rack that does not match its label — and they are taken on a phone, in a hurry, in a warehouse.
// "IMG_20260819_143301.jpg" tells the uploader nothing about whether they photographed the right
// thing, or whether it came out legible. The thumbnail tells them both before they submit.
export const imageDescription =
  "Upload for pictures: shows the chosen image rather than its filename, because a warehouse photo is evidence and 'IMG_20260819.jpg' cannot tell you whether it came out legible.";

export interface ImageUploadProps {
  maxSize?: number;
  onChange?(file: File | undefined): void;
  placeholder?: string;
  disabled?: boolean;
}

export function ImageUpload({
  maxSize = 5 * 1_048_576,
  onChange,
  placeholder = "Drop a photo here, or click to choose",
  disabled,
}: ImageUploadProps) {
  return (
    <FileUpload.Root
      accept="image/*"
      maxFiles={1}
      maxFileSize={maxSize}
      disabled={disabled}
      onFileChange={(e) => onChange?.(e.acceptedFiles[0])}
      data-testid="image-upload"
    >
      <FileUpload.HiddenInput />
      <ImagePreview placeholder={placeholder} />
    </FileUpload.Root>
  );
}

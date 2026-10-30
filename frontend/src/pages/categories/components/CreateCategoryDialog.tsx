import { useState } from "react";
import type { FormEvent } from "react";
import {
  Button,
  CloseButton,
  Dialog,
  Field,
  Icon,
  IconButton,
  Input,
  Portal,
  Stack,
  Text,
} from "@chakra-ui/react";
import { Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { rpcError } from "../../../api/clients";
import { toaster } from "../../../components/feedback/Toaster";
import { CategorySelect } from "../../../components/pickers/CategorySelect";
import { useSaveCategory } from "../queries";

// CreateCategoryDialog adds a category to the GLOBAL taxonomy. A parent of 0n makes it top-level; picking a parent in
// the CategorySelect nests it under that node.
//
// Two ways in (the-category-page-is-a-tree):
//  - the page's New Category — uncontrolled, its own trigger, top-level unless a parent is picked;
//  - a node's ＋ Tambah Sub-kategori — controlled (`open`), the parent already filled in with that node.
export function CreateCategoryDialog({
  parentId: presetParent = 0n,
  open: openProp,
  onOpenChange,
  compact = false,
}: {
  /** The node a sub-category is added under — the picker starts on it. */
  parentId?: bigint;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** A phone's header: the trigger is the ＋ alone, named by its label (a-phone-header-action-is-an-icon). */
  compact?: boolean;
}) {
  const { t } = useTranslation();
  const isControlled = openProp !== undefined;
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = isControlled ? openProp : uncontrolledOpen;
  const [error, setError] = useState("");

  const [name, setName] = useState("");
  const [parentId, setParentId] = useState<bigint>(presetParent);

  function setOpen(next: boolean) {
    if (isControlled) {
      onOpenChange?.(next);
    } else {
      setUncontrolledOpen(next);
    }
  }

  // The write invalidates the taxonomy itself (#177) — the page no longer passes a refetch callback.
  const save = useSaveCategory();
  const busy = save.isPending;

  function submit(event: FormEvent) {
    event.preventDefault();

    setError("");

    save.mutate(
      { name, parentId },
      {
        onSuccess: () => {
          toaster.create({ type: "success", title: t("catalog.categories.createdToast", { name }) });

          setName("");
          setParentId(presetParent);
          setOpen(false);
        },
        onError: (err) => setError(rpcError(err)),
      },
    );
  }

  return (
    <Dialog.Root open={open} onOpenChange={(e) => setOpen(e.open)}>
      {!isControlled && (
        <Dialog.Trigger asChild>
          {/* With its ＋ (an-action-button-carries-its-icon); on a phone the ＋ alone (a-phone-header-action-is-an-icon). */}
          {compact ? (
            <IconButton
              size="sm"
              colorPalette="brand"
              aria-label={t("catalog.categories.newCategory")}
              title={t("catalog.categories.newCategory")}
              flexShrink={0}
              data-testid="open-create-category"
            >
              <Icon as={Plus} boxSize="4" />
            </IconButton>
          ) : (
            <Button size="xs" colorPalette="brand" flexShrink={0} data-testid="open-create-category">
              <Icon as={Plus} boxSize="4" />
              {t("catalog.categories.newCategory")}
            </Button>
          )}
        </Dialog.Trigger>
      )}

      <Portal>
        <Dialog.Backdrop />
        <Dialog.Positioner>
          <Dialog.Content>
            <form onSubmit={submit}>
              <Dialog.Header>
                <Dialog.Title>
                  {presetParent > 0n ? t("catalog.categories.newSubTitle") : t("catalog.categories.newTitle")}
                </Dialog.Title>
              </Dialog.Header>

              <Dialog.Body>
                <Stack gap="card">
                  {error && (
                    <Text color="error.fg" data-testid="create-category-error">
                      {error}
                    </Text>
                  )}

                  <Field.Root required>
                    <Field.Label>{t("catalog.name")}</Field.Label>
                    <Input
                      value={name}
                      placeholder={t("catalog.categories.namePlaceholder")}
                      data-testid="new-category-name"
                      onChange={(e) => setName(e.target.value)}
                    />
                  </Field.Root>

                  <Field.Root>
                    <Field.Label>{t("catalog.categories.parent")}</Field.Label>
                    <CategorySelect value={parentId} onChange={setParentId} />
                    <Field.HelperText>{t("catalog.categories.parentHelpCreate")}</Field.HelperText>
                  </Field.Root>
                </Stack>
              </Dialog.Body>

              <Dialog.Footer>
                <Dialog.ActionTrigger asChild>
                  <Button variant="outline">{t("catalog.cancel")}</Button>
                </Dialog.ActionTrigger>

                <Button
                  type="submit"
                  colorPalette="brand"
                  loading={busy}
                  disabled={name.trim() === ""}
                  data-testid="submit-create-category"
                >
                  <Icon as={Plus} boxSize="4" />
                  {t("catalog.create")}
                </Button>
              </Dialog.Footer>

              <Dialog.CloseTrigger asChild>
                <CloseButton size="sm" />
              </Dialog.CloseTrigger>
            </form>
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  );
}

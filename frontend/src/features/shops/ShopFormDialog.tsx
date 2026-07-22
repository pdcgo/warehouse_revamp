import { useState } from "react";
import type { FormEvent } from "react";
import { useTranslation } from "react-i18next";
import {
  Button,
  CloseButton,
  Dialog,
  Field,
  Input,
  Portal,
  Stack,
  Text,
} from "@chakra-ui/react";
import { rpcError } from "../../api/clients";
import { Marketplace } from "../../gen/warehouse/marketplace/v1/marketplace_pb";
import type { Shop } from "../../gen/warehouse/selling/v1/selling_pb";
import { useTeam } from "../team/TeamContext";
import { MarketplaceSelect } from "../../components/MarketplaceSelect";
import { toaster } from "../../components/Toaster";
import { useSaveShop } from "./queries";

// ShopFormDialog creates OR edits a shop in the CURRENT (selling) team. The team is the scope: it
// travels in the message body (the backend's use_scope reads it there, never a header).
//
// Two modes, one form:
//  - create — `shop` undefined; the dialog renders its own "New shop" trigger.
//  - edit — `shop` set; the dialog is controlled (open/onOpenChange), pre-filled, calls ShopUpdate.
export function ShopFormDialog({
  shop,
  open: openProp,
  onOpenChange,
}: {
  shop?: Shop;
  open?: boolean;
  /**
   * The dialog's open state changed — including its closing itself after a successful save.
   *
   * Lifecycle only. It used to be joined by an `onDone` that existed purely so the caller could
   * refetch (#177); the write invalidates the cache itself now, so both callers are told the dialog
   * is gone and nothing more. That is what clears their `editing` state.
   */
  onOpenChange?: (open: boolean) => void;
}) {
  const { current } = useTeam();
  const { t } = useTranslation();

  const editing = shop !== undefined;
  const isControlled = openProp !== undefined;
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = isControlled ? openProp : uncontrolledOpen;

  function setOpen(next: boolean) {
    if (isControlled) {
      onOpenChange?.(next);
    } else {
      setUncontrolledOpen(next);
    }
  }

  const [error, setError] = useState("");

  // The write, and what it invalidates, declared together in queries.ts (#177). `busy` is the
  // mutation's own state: a second flag beside it is a second answer to the same question, free to
  // disagree with the first.
  const save = useSaveShop();
  const busy = save.isPending;

  const [name, setName] = useState(shop?.name ?? "");
  const [shopCode, setShopCode] = useState(shop?.shopCode ?? "");
  const [marketplace, setMarketplace] = useState<Marketplace>(shop?.marketplace ?? Marketplace.UNSPECIFIED);
  const [description, setDescription] = useState(shop?.description ?? "");

  const canSave = name.trim() !== "" && shopCode.trim() !== "" && marketplace !== Marketplace.UNSPECIFIED;

  function submit(event: FormEvent) {
    event.preventDefault();

    if (!current) {
      return;
    }

    setError("");

    save.mutate(
      {
        teamId: current.teamId,
        shopId: shop?.id,
        name,
        shopCode,
        marketplace,
        description,
      },
      {
        onSuccess: () => {
          if (editing) {
            toaster.create({ type: "success", title: t("shops.form.saved") });
          } else {
            toaster.create({ type: "success", title: t("shops.form.created", { name }) });

            // Only the create form empties itself: it is reopened from the same trigger to add a
            // SECOND shop, while the edit form is thrown away and rebuilt from the next row.
            setName("");
            setShopCode("");
            setMarketplace(Marketplace.UNSPECIFIED);
            setDescription("");
          }

          // The dialog is gone — in edit mode this reaches onOpenChange, which is what clears the
          // caller's `editing`. It is NOT a refetch signal: the hook already invalidated before this
          // ran.
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
          <Button size="xs" colorPalette="brand" data-testid="open-create-shop">
            {t("shops.form.newShop")}
          </Button>
        </Dialog.Trigger>
      )}

      <Portal>
        <Dialog.Backdrop />
        <Dialog.Positioner>
          <Dialog.Content>
            <form onSubmit={submit}>
              <Dialog.Header>
                <Dialog.Title>{editing ? t("shops.form.editTitle") : t("shops.form.createTitle")}</Dialog.Title>
              </Dialog.Header>

              <Dialog.Body>
                <Stack gap="card">
                  {error && (
                    <Text color="red.fg" data-testid="shop-form-error">
                      {error}
                    </Text>
                  )}

                  <Field.Root required>
                    <Field.Label>{t("shops.form.name")}</Field.Label>
                    <Input value={name} data-testid="shop-name" onChange={(e) => setName(e.target.value)} />
                  </Field.Root>

                  <Field.Root required>
                    <Field.Label>{t("shops.form.shopCode")}</Field.Label>
                    <Input value={shopCode} data-testid="shop-code" onChange={(e) => setShopCode(e.target.value)} />
                    <Field.HelperText>{t("shops.form.shopCodeHelp")}</Field.HelperText>
                  </Field.Root>

                  <Field.Root required>
                    <Field.Label>{t("shops.form.marketplace")}</Field.Label>
                    <MarketplaceSelect value={marketplace} onChange={setMarketplace} />
                  </Field.Root>

                  <Field.Root>
                    <Field.Label>{t("shops.form.description")}</Field.Label>
                    <Input
                      value={description}
                      data-testid="shop-description"
                      onChange={(e) => setDescription(e.target.value)}
                    />
                  </Field.Root>
                </Stack>
              </Dialog.Body>

              <Dialog.Footer>
                <Dialog.ActionTrigger asChild>
                  <Button variant="outline">{t("shops.form.cancel")}</Button>
                </Dialog.ActionTrigger>

                <Button type="submit" colorPalette="brand" loading={busy} disabled={!canSave} data-testid="submit-shop">
                  {editing ? t("shops.form.save") : t("shops.form.create")}
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

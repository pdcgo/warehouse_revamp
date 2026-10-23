import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Alert, Button, Card, Field, Heading, Input, InputGroup, SimpleGrid, Stack, Text } from "@chakra-ui/react";
import { useTranslation } from "react-i18next";

import { rpcError } from "../../../api/clients";
import { toaster } from "../../../components/feedback/Toaster";
import { CurrencyInput } from "../../../components/inputs/CurrencyInput";
import { useSetWarehouseFee, useWarehouseFee } from "../../../features/warehouse/queries";

export interface WarehouseFeeCardProps {
  /** The WAREHOUSE team whose fee this sets. */
  teamId: bigint;
  /** Whether the person may change it — the warehouse's managers. UX only; the request policy is the boundary. */
  canEdit: boolean;
}

/** The fields as typed: the percent as text ("2,5" or "2.5"), the money as raw digits ("" = nothing typed). */
interface Draft {
  percent: string;
  floor: string;
  cap: string;
}

const EMPTY: Draft = { percent: "", floor: "", cap: "" };

// WHAT THIS WAREHOUSE CHARGES PER ORDER (warehouse-prices-balance-records) — one rate, the same for every seller
// (one-rate-per-warehouse):
//   fee = clamp(goods_cost × percent / 100, floor, cap)          (the-fee-has-a-floor-and-a-cap)
// An empty cap is no cap, and a cap of 0 is refused (an-empty-cap-means-no-cap). A warehouse with no fee takes no orders
// (a-warehouse-with-no-rate-takes-no-orders), so "not set" is said, not left as empty fields.
//
// ⚠ STEP 1 OF FIVE (the-flat-rate-is-dropped-last): nothing charges from this yet. Orders are still charged the flat fee
// from Credit Terms until the order takes this fee over, and the card says so rather than let a saved rate read as live.
export function WarehouseFeeCard({ teamId, canEdit }: WarehouseFeeCardProps) {
  const { t } = useTranslation();
  const fee = useWarehouseFee({ teamId });
  const save = useSetWarehouseFee();

  const saved: Draft = fee.data
    ? {
        percent: String(fee.data.feePercent),
        floor: fee.data.minFee > 0 ? String(Math.round(fee.data.minFee)) : "",
        cap: fee.data.maxFee !== undefined ? String(Math.round(fee.data.maxFee)) : "",
      }
    : EMPTY;

  const [draft, setDraft] = useState<Draft>(EMPTY);

  // Seed from the server, and RE-seed when the team changes or a save lands — keyed on the saved values, so a refetch
  // answering the same rate never resets what somebody is typing.
  useEffect(() => {
    setDraft(saved);
  }, [saved.percent, saved.floor, saved.cap, teamId]);

  const percent = Number(draft.percent.replace(",", "."));
  const floor = Number(draft.floor || "0");
  const cap = draft.cap === "" ? undefined : Number(draft.cap);

  const percentError = draft.percent.trim() === "" || !Number.isFinite(percent) || percent < 0 || percent > 100;
  const capError = cap !== undefined && cap <= 0;
  const floorError = cap !== undefined && !capError && floor > cap;

  const notSet = fee.isSuccess && fee.data === null;
  const changed = draft.percent !== saved.percent || draft.floor !== saved.floor || draft.cap !== saved.cap;
  const invalid = percentError || capError || floorError;

  async function submit(event: FormEvent) {
    event.preventDefault();

    try {
      await save.mutateAsync({ teamId, feePercent: percent, minFee: floor, maxFee: cap });
      toaster.create({ type: "success", title: t("account.warehouseFee.saved") });
    } catch (err) {
      toaster.create({ type: "error", title: rpcError(err) });
    }
  }

  return (
    <Card.Root data-testid="settings-warehouse-fee">
      <Card.Body>
        <form onSubmit={submit}>
          <Stack gap="card">
            <Heading size="sm">{t("account.warehouseFee.title")}</Heading>

            <Text color="fg.muted" fontSize="xs">
              {t("account.warehouseFee.hint")}
            </Text>

            {notSet && (
              <Alert.Root status="warning" data-testid="warehouse-fee-not-set">
                <Alert.Indicator />
                <Alert.Title>{t("account.warehouseFee.notSet")}</Alert.Title>
              </Alert.Root>
            )}

            <SimpleGrid columns={{ base: 1, md: 3 }} gap="field">
              <Field.Root required invalid={percentError && draft.percent !== ""}>
                <Field.Label>
                  {t("account.warehouseFee.percent")}
                  <Field.RequiredIndicator />
                </Field.Label>
                <InputGroup endElement="%">
                  <Input
                    inputMode="decimal"
                    placeholder="2,5"
                    value={draft.percent}
                    disabled={!canEdit || save.isPending}
                    data-testid="warehouse-fee-percent"
                    onChange={(e) => setDraft((d) => ({ ...d, percent: e.target.value }))}
                  />
                </InputGroup>
                <Field.ErrorText>{t("account.warehouseFee.percentInvalid")}</Field.ErrorText>
              </Field.Root>

              <Field.Root invalid={floorError}>
                <Field.Label>{t("account.warehouseFee.floor")}</Field.Label>
                <CurrencyInput
                  value={draft.floor}
                  disabled={!canEdit || save.isPending}
                  data-testid="warehouse-fee-floor"
                  onChange={(floor) => setDraft((d) => ({ ...d, floor }))}
                />
                <Field.ErrorText>{t("account.warehouseFee.floorAboveCap")}</Field.ErrorText>
              </Field.Root>

              <Field.Root invalid={capError}>
                <Field.Label>{t("account.warehouseFee.cap")}</Field.Label>
                <CurrencyInput
                  value={draft.cap}
                  placeholder={t("account.warehouseFee.noCap")}
                  disabled={!canEdit || save.isPending}
                  data-testid="warehouse-fee-cap"
                  onChange={(cap) => setDraft((d) => ({ ...d, cap }))}
                />
                {capError ? (
                  <Field.ErrorText>{t("account.warehouseFee.capZero")}</Field.ErrorText>
                ) : (
                  <Field.HelperText>{t("account.warehouseFee.capHint")}</Field.HelperText>
                )}
              </Field.Root>
            </SimpleGrid>

            <Text color="fg.muted" fontSize="xs" data-testid="warehouse-fee-not-live">
              {t("account.warehouseFee.notLive")}
            </Text>

            <Button
              type="submit"
              colorPalette="brand"
              loading={save.isPending}
              disabled={!canEdit || invalid || !changed}
              data-testid="save-warehouse-fee"
            >
              {t("account.save")}
            </Button>
          </Stack>
        </form>
      </Card.Body>
    </Card.Root>
  );
}

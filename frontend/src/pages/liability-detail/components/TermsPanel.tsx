import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Badge,
  Button,
  Flex,
  Icon,
  SimpleGrid,
  Spinner,
  Stack,
  Stat,
  Text,
} from "@chakra-ui/react";
import { Pencil, Trash2 } from "lucide-react";

import { useDeleteTerms, useLiabilityTerms } from "../../../features/liability/queries";
import type { LiabilityTerms } from "../../../gen/warehouse/liability/v1/liability_pb";
import { Role } from "../../../gen/warehouse/role_base/v1/role_pb";
import { ConfirmDialog } from "../../../components/feedback/ConfirmDialog";
import { RefreshOverlay } from "../../../components/feedback/RefreshOverlay";
import { formatRupiah } from "../../../lib/money";
// ⚠ BOTH ARE DOMAIN COMPONENTS NOW (features/liability), not this page's. The default-terms dialog
// on `/liability` is their second importer — the-default-terms-row-is-a-dialog-on-the-list — and
// CLAUDE.md's placement rule is HOW MANY PAGES USE IT, so they moved the moment that landed.
import { CreditMeter } from "../../../features/liability/CreditMeter";
import { TermsEditDialog } from "../../../features/liability/TermsEditDialog";

// Big enough to hold every counterparty this creditor has terms for. There is no counterparty filter
// on `LiabilityTermsList` yet, so the pair's row and the DEFAULT row are both picked out of one read
// — a creditor's terms table is a handful of rows, and asking twice would be two round trips for
// something one page already contains.
const TERMS_PAGE = 200;

// The roles that write SOMEBODY ELSE'S terms — `balance_context.md` §Balance Policy 1.
//
// ⚠ It shapes the form only; the server decides for real. A UI that let one of these save with no
// reason would be offering a write the backend is going to refuse.
function isOverrideWriter(role: Role): boolean {
  return role === Role.ROOT || role === Role.ADMIN;
}

export interface TermsPanelProps {
  /** The CREDITOR — the team whose terms these are. */
  teamId: bigint;
  /** The DEBTOR this pair page is about. */
  counterpartyId: bigint;
  counterpartyName: string;
  /** The caller's role in `teamId`, for the override-reason rule. */
  role: Role;
  /**
   * What the counterparty owes RIGHT NOW, positive. The caller flips the sign: this page holds a
   * signed balance from the creditor's side, and a meter wants a magnitude.
   */
  debt: bigint;
}

// TermsPanel — where this pair's credit limit, order fee and markup are SET
// (terms-live-on-the-pair-detail).
//
// ⚠ IT WAS A SCREEN, AND IT IS NOW A SECTION. `/liability/terms` listed every counterparty's terms in
// one table; the owner's answer is that terms belong beside the pair they govern, so the list is gone
// and each pair carries its own.
//
// ⚠ THE LIMIT IS THE ONLY CONTROL THIS DESIGN HAS. There is no settlement cycle, no due date and no
// overdue state (no-overdue-only-the-threshold), so a limit is simultaneously the exposure cap, the
// only thing that ends a block, and — because lowering it stops a debtor trading — the only
// instrument a creditor has to chase with. That is why this shows utilisation beside the number
// rather than being a settings form.
export function TermsPanel({
  teamId,
  counterpartyId,
  counterpartyName,
  role,
  debt,
}: TermsPanelProps) {
  const { t } = useTranslation();

  const [editOpen, setEditOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const termsQuery = useLiabilityTerms({ teamId, page: 1, pageSize: TERMS_PAGE });
  const deleteTerms = useDeleteTerms();

  const { own, fallback } = useMemo(() => {
    const all = termsQuery.data?.terms ?? [];

    return {
      own: all.find((x) => x.counterpartyId === counterpartyId),
      // ⚠ 0n IS A REAL ROW, not an absence — it is the terms every counterparty without their own
      // inherits (terms-are-team-scoped-root-is-global).
      fallback: all.find((x) => x.counterpartyId === 0n),
    };
  }, [termsQuery.data, counterpartyId]);

  // What actually applies to this pair. An own row wins; otherwise the default; otherwise nothing is
  // set at all, which means unlimited (the-threshold-defaults-to-unlimited).
  const effective: LiabilityTerms | undefined = own ?? fallback;
  const inherited = own === undefined && fallback !== undefined;

  if (termsQuery.isPending) {
    return <Spinner colorPalette="brand" />;
  }

  return (
    <RefreshOverlay busy={termsQuery.isFetching && !termsQuery.isPending}>
      <Stack gap="card" data-testid="terms-panel">
        <Flex align="center" gap="field" wrap="wrap">
          {inherited && (
            <Badge colorPalette="gray" data-testid="terms-inherited">
              {t("terms.usingDefault")}
            </Badge>
          )}
          {!effective && (
            <Text color="fg.muted" data-testid="terms-none">
              {t("terms.noneSet")}
            </Text>
          )}

          <Button
            size="xs"
            variant="outline"
            data-testid="terms-edit"
            onClick={() => setEditOpen(true)}
          >
            <Icon as={Pencil} boxSize="4" />
            {own ? t("terms.edit") : t("terms.setTerms")}
          </Button>

          {/* ⚠ ONLY AN OWN ROW CAN BE REMOVED. Deleting the default from a pair page would change
              every other pair at once, which is not what "remove this pair's terms" means — and
              removing a limit is deleting the row, never zeroing it
              (the-threshold-defaults-to-unlimited). */}
          {own && (
            <Button
              size="xs"
              variant="ghost"
              colorPalette="red"
              data-testid="terms-delete"
              onClick={() => setConfirmDelete(true)}
            >
              <Icon as={Trash2} boxSize="4" />
              {t("terms.remove")}
            </Button>
          )}
        </Flex>

        <SimpleGrid columns={{ base: 1, md: 3 }} gap="card">
          <Stat.Root>
            <Stat.Label>{t("terms.creditLimit")}</Stat.Label>
            <CreditMeter
              limit={effective?.creditLimit}
              debt={debt}
              testId="terms-panel-meter"
            />
          </Stat.Root>

          <Stat.Root>
            <Stat.Label>{t("terms.handlingFee")}</Stat.Label>
            <Stat.ValueText data-testid="terms-panel-fee">
              {effective && effective.handlingFee > 0n ? (
                formatRupiah(effective.handlingFee)
              ) : (
                <Text as="span" color="fg.subtle">
                  {t("terms.chargesNothing")}
                </Text>
              )}
            </Stat.ValueText>
          </Stat.Root>

          <Stat.Root>
            <Stat.Label>{t("terms.markup")}</Stat.Label>
            <Stat.ValueText data-testid="terms-panel-markup">
              {effective && effective.productMarkupBp > 0n ? (
                `${(Number(effective.productMarkupBp) / 100).toFixed(2).replace(/\.?0+$/, "")}%`
              ) : (
                <Text as="span" color="fg.subtle">
                  {t("terms.chargesNothing")}
                </Text>
              )}
            </Stat.ValueText>
          </Stat.Root>
        </SimpleGrid>
      </Stack>

      <TermsEditDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        teamId={teamId}
        editing={own}
        // The counterparty is fixed by the page, so the picker has exactly this one to offer — it is
        // not a choice here the way it was on the list screen.
        options={[{ id: counterpartyId, name: counterpartyName }]}
        overrideWriter={isOverrideWriter(role)}
      />

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={t("terms.removeDialog.title")}
        message={t("terms.removeDialog.message", { name: counterpartyName })}
        confirmLabel={t("terms.removeDialog.confirm")}
        destructive
        onConfirm={async () => {
          // ⚠ REMOVING A ROW MEANS THIS PAIR FALLS BACK TO THE DEFAULT, which may be a different
          // limit — it is not "no limit" (the-threshold-defaults-to-unlimited: unlimited is what you
          // get when nothing is set at all, and a default row IS something).
          await deleteTerms.mutateAsync({ teamId, counterpartyId, reason: "" });
          setConfirmDelete(false);
        }}
      />
    </RefreshOverlay>
  );
}

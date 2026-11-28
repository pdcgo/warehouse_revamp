import { HStack, Icon, Stack, Text } from "@chakra-ui/react";
import { History, Lock, Printer, Tag } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { ConfirmDialog } from "../../components/feedback/ConfirmDialog";
import { REPRINT_TAG_NAME } from "../products/tags/productTags";
import type { TeamCodePreviewFigures } from "./teamCode";

// THE CONFIRM BEFORE A TEAM CODE CHANGES (backlog #150; the-team-code-and-product-tags-prototype-is-accepted, *the
// confirm*: the four lines, accepted as drawn) — what follows, said BEFORE it happens, since every printed sticker of the
// team stops matching:
//
//   ┌ Ganti kode tim menjadi ANGR? ─────────────────────────────────── × ┐
//   │ 🏷 46 produk ikut berganti kode — SL-03-ANG-001 menjadi ANGR-ANG-001.│
//   │ 🖨 Setiap gudang yang menyimpan stoknya mencetak ulang label: Gudang │
//   │    Cabang, Gudang Pusat. Sampai dicetak, produknya bertag …          │
//   │ 🕘 Pesanan, restock dan transfer yang sudah ada tetap memakai kode … │
//   │ 🔒 SL-03 tetap milik tim ini: stiker lama masih menemukan produknya…│
//   │                                         [Batal] [Ganti Kode]         │
//   └──────────────────────────────────────────────────────────────────────┘
//
// Each line is a decision (a-team-code-change-recomposes-its-product-codes): the products take the new code, tagged
// `need_reprint_code` until each warehouse holding their stock prints (products-have-their-own-tag-list, 🔄 what
// clears); past lines keep their code (🔄); the old code stays the team's and finds its product (🔄 Q1 "A"). The figures
// are TeamCodePreview's, read when Save opened this (features/teams/teamCode.ts). Used by Settings' *Kode tim* card and
// root's Edit Team alike — one change, one confirm.
export function TeamCodeConfirm({
  open,
  onOpenChange,
  oldTeamCode,
  newTeamCode,
  figures,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  oldTeamCode: string;
  newTeamCode: string;
  figures: TeamCodePreviewFigures;
  onConfirm: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const warehouses = figures.warehouses.join(", ");
  // A code is read and typed whole — never broken at its dashes across two lines.
  const codes = [newTeamCode, oldTeamCode, figures.exampleOld, figures.exampleNew];
  const whole = (text: string) => <KeepWhole text={text} codes={codes} />;

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("account.teamCode.confirm.title", { code: newTeamCode })}
      confirmLabel={t("account.teamCode.confirm.action")}
      destructive={false}
      onConfirm={onConfirm}
    >
      <Stack gap="3" data-testid="team-code-confirm">
        <Line icon={Tag} testId="team-code-confirm-products">
          {figures.products > 0
            ? whole(
                t("account.teamCode.confirm.products", {
                  count: figures.products,
                  old: figures.exampleOld,
                  new: figures.exampleNew,
                }),
              )
            : t("account.teamCode.confirm.productsNone")}
        </Line>
        <Line icon={Printer} testId="team-code-confirm-reprint">
          {figures.warehouses.length > 0
            ? t("account.teamCode.confirm.reprint", { warehouses, tag: REPRINT_TAG_NAME })
            : t("account.teamCode.confirm.reprintNone")}
        </Line>
        <Line icon={History} testId="team-code-confirm-past">
          {t("account.teamCode.confirm.past")}
        </Line>
        <Line icon={Lock} testId="team-code-confirm-former">
          {whole(t("account.teamCode.confirm.former", { code: oldTeamCode }))}
        </Line>
      </Stack>
    </ConfirmDialog>
  );
}

/** The sentence as written, each code in it kept on one line (a code breaks at its dashes otherwise). */
function KeepWhole({ text, codes }: { text: string; codes: string[] }) {
  const list = [...new Set(codes.filter((code) => code.includes("-")))].sort((a, b) => b.length - a.length);
  if (list.length === 0) return <>{text}</>;
  const pattern = new RegExp(`(${list.map((code) => code.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`);
  return (
    <>
      {text.split(pattern).map((part, i) =>
        list.includes(part) ? (
          <Text as="span" key={i} whiteSpace="nowrap">
            {part}
          </Text>
        ) : (
          part
        ),
      )}
    </>
  );
}

function Line({ icon, testId, children }: { icon: LucideIcon; testId: string; children: ReactNode }) {
  return (
    <HStack align="start" gap="2" data-testid={testId}>
      <Icon as={icon} boxSize="4" color="fg.muted" flexShrink={0} mt="0.5" />
      <Text fontSize="sm">{children}</Text>
    </HStack>
  );
}

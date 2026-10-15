import { Card, HStack, Icon, List, Text } from "@chakra-ui/react";
import { ClipboardList } from "lucide-react";
import { useTranslation } from "react-i18next";

import type { OrderDraftItem } from "../../../gen/warehouse/selling/v1/order_draft_pb";
import { formatRupiah } from "../../../lib/money";

// WHAT THE DRAFT SAYS MUST BE SENT — above the products, as a list of text (owner: *"untuk petunjuk produk yang harus
// dikirim kasih di atas produk berupa list teks saja"*, `the-draft-opens-in-the-order-form`):
//
//   ┌ 📋 Produk yang Harus Dikirim ───────────────── a faded sand card ┐
//   │ Dari shopee-ext — pilih produknya di bawah                        │
//   │ • 2 × Beras Premium 5 kg · Rp 75.000                              │
//   │ • Gula Pasir 1 kg · Rp 18.000                                     │
//   └───────────────────────────────────────────────────────────────────┘
//   Produk ↓ — the products are picked here, reading the list above
//
// IN A CARD OF ITS OWN COLOUR (owner: *"kasih card dan warna yang beda sendiri … agak pudar saja"*, then *"jangan ungu"*)
// — a faded sand, `draftHint.*` in theme.ts: a slip of paper no role's colour, so it reads as the outside's words, not a
// warning and not ours.
//
// A HINT, NOT A ROW TO MAP. The marketplace's own words, verbatim — the evidence of what the buyer bought — read while
// our products are picked below. Nothing in it is copied into the order: a title names no product of ours, and a guess
// would be indistinguishable from a person's pick once it was in the form. Inside the card: no columns, no badges — text.
//
// What the app could not read is said so — a missing title, an unread quantity or price is a fact about the line.
//
// `source` is the pushing app's name; "manual" is our own label for a draft saved from this form, and is said in words.
export function DraftProductHints({ items, source }: { items: OrderDraftItem[]; source: string }) {
  const { t } = useTranslation();

  return (
    <Card.Root variant="outline" bg="draftHint.bg" borderColor="draftHint.border" data-testid="draft-product-hints">
      <Card.Header pb="0">
        <HStack gap="2" color="draftHint.fg">
          <Icon as={ClipboardList} boxSize="4" />
          <Card.Title color="draftHint.fg">{t("orderForm.draftHints.title")}</Card.Title>
        </HStack>
        {source && (
          <Card.Description data-testid="draft-product-hints-source">
            {source === "manual" ? t("orderForm.draftHints.fromManual") : t("orderForm.draftHints.from", { source })}
          </Card.Description>
        )}
      </Card.Header>
      <Card.Body pt="3">
        <List.Root gap="1" ps="5" fontSize="sm">
          {items.map((item, i) => (
            <List.Item key={item.id > 0n ? item.id.toString() : `line-${i}`} data-testid={`draft-product-hint-${i}`}>
              {item.quantity > 0 ? t("orderForm.draftHints.quantity", { n: item.quantity }) : ""}
              {item.externalName || (
                <Text as="span" color="fg.muted">
                  {t("productListExternal.noName")}
                </Text>
              )}
              {item.quantity <= 0 && (
                <Text as="span" color="fg.warning">
                  {" · "}
                  {t("productListExternal.qtyUnknown")}
                </Text>
              )}
              {item.unitPrice > 0n && (
                <Text as="span" color="fg.muted">
                  {" · "}
                  {formatRupiah(item.unitPrice)}
                </Text>
              )}
            </List.Item>
          ))}
        </List.Root>
      </Card.Body>
    </Card.Root>
  );
}

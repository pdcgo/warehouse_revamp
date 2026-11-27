import { createElement, memo } from "react";
import type { ComponentProps } from "react";

import { CustomerInfoForm as PlainCustomerInfoForm } from "../../../components/customers/CustomerInfoForm";
import { ConfirmDialog as PlainConfirmDialog } from "../../../components/feedback/ConfirmDialog";
import { OrderItemCard as PlainOrderItemCard } from "../../../components/orders/OrderItemCard";
import { BundleCard as PlainBundleCard } from "../../../features/orders/form/BundleCard";
import { CreditLimitPanel as PlainCreditLimitPanel } from "../../../features/orders/form/CreditLimitPanel";
import { DuplicateRefDialog as PlainDuplicateRefDialog } from "../../../features/orders/form/DuplicateRefDialog";
import { ExtraInfoCard as PlainExtraInfoCard } from "../../../features/orders/form/ExtraInfoCard";
import { NoteAndSubmitCard as PlainNoteAndSubmitCard } from "../../../features/orders/form/NoteAndSubmitCard";
import { OrderChecksDialog as PlainOrderChecksDialog } from "../../../features/orders/form/OrderChecksDialog";
import { ProfitEstimatePanel as PlainProfitEstimatePanel } from "../../../features/orders/form/ProfitEstimatePanel";
import { ReturnMappingCard as PlainReturnMappingCard } from "../../../features/orders/form/ReturnMappingCard";
import { ShippingReceiptCard as PlainShippingReceiptCard } from "../../../features/orders/form/ShippingReceiptCard";
import { TotalsInvoicePanel as PlainTotalsInvoicePanel } from "../../../features/orders/form/TotalsInvoicePanel";
import { WarehouseBand as PlainWarehouseBand } from "../../../features/orders/form/WarehouseBand";
import { TakeRefusalAlert as PlainTakeRefusalAlert } from "../../../features/orders/TakeRefusalAlert";
import { NotImplementedSummary as PlainNotImplementedSummary } from "../../../features/pending/NotImplementedSummary";
import { DraftProductHints as PlainDraftProductHints } from "./DraftProductHints";
import { OrderContentsField as PlainOrderContentsField } from "./OrderContentsField";
import { OrderCreateHeader as PlainOrderCreateHeader } from "./OrderCreateHeader";
import { OrderInfoCard as PlainOrderInfoCard } from "./OrderInfoCard";
import { RailHeader as PlainRailHeader } from "./RailHeader";

// THE ORDER FORM'S CARDS, EACH RE-RENDERING ONLY WHEN WHAT IT SHOWS CHANGES (#135,
// the-speed-audits-old-findings-are-fixed-smallest-first) — every card, panel and dialog the page draws, as its
// `React.memo`, under the name the page always used, so the page reads exactly as it did.
//
// WHY: the form's state is ONE reducer in the page (formState.ts, no-global-store-every-read-is-a-query-hook), so every
// keystroke renders `OrderCreatePage` — and before this, everything under it: the audit counted ~3,800 components a key
// in the buyer's name (the two calendars, every picker, the closed dialogs). A memoised card is skipped when its props
// are the same as last time, and the page keeps them the same: the reducer's setters (`act`) are stable, a value
// derived for a card is a `useMemo`, and a handler is a `useCallback` or `useStableHandler` (../stableHandler.ts). So
// a key in the buyer's name renders the page and the customer card; what truly depends on the name — Create's held
// reason, the leave guard — is a prop derived once in the page, and changes only when it does. (A context reaches past
// a memoised card: the form lock's fieldset, whose context every field reads, renders only with the lock —
// LockFieldset.tsx.)
//
// ⚠ ONLY THIS PAGE'S USE IS MEMOISED — the components themselves are untouched, so every other screen drawing them
// renders them as before.

export const WarehouseBand = memo(PlainWarehouseBand);
export const ShippingReceiptCard = memo(PlainShippingReceiptCard);
export const OrderItemCard = memo(PlainOrderItemCard);
export const BundleCard = memo(PlainBundleCard);
export const ReturnMappingCard = memo(PlainReturnMappingCard);
export const CustomerInfoForm = memo(PlainCustomerInfoForm);
export const CreditLimitPanel = memo(PlainCreditLimitPanel);
export const ProfitEstimatePanel = memo(PlainProfitEstimatePanel);
export const TotalsInvoicePanel = memo(PlainTotalsInvoicePanel);
export const NoteAndSubmitCard = memo(PlainNoteAndSubmitCard);
export const DuplicateRefDialog = memo(PlainDuplicateRefDialog);
export const OrderChecksDialog = memo(PlainOrderChecksDialog);
export const ConfirmDialog = memo(PlainConfirmDialog);
export const TakeRefusalAlert = memo(PlainTakeRefusalAlert);
export const NotImplementedSummary = memo(PlainNotImplementedSummary);
export const DraftProductHints = memo(PlainDraftProductHints);
// …and the page's own parts, moved out of `OrderCreatePage` for this (#135): the header, the order information card,
// the items-or-bundles pill and the rail's header.
export const OrderCreateHeader = memo(PlainOrderCreateHeader);
export const OrderInfoCard = memo(PlainOrderInfoCard);
export const OrderContentsField = memo(PlainOrderContentsField);
export const RailHeader = memo(PlainRailHeader);

// ⚠ THE DEADLINE'S CALENDAR NEVER OFFERS A PAST DAY — ExtraInfoCard reads today (`min`) while it renders. Before #135
// it rendered on every keystroke, so a form left open over midnight moved its `min` on the next key; memoised, it would
// keep yesterday's until its own two fields changed. `today` is the page's, read on every render: equal all day (no
// re-render), different from the first render after midnight — exactly when the old card would have read the new day.
type ExtraInfoCardProps = ComponentProps<typeof PlainExtraInfoCard>;

function ExtraInfoCardOfToday({ today: _today, ...props }: ExtraInfoCardProps & { today: string }) {
  return createElement(PlainExtraInfoCard, props);
}

export const ExtraInfoCard = memo(ExtraInfoCardOfToday);

import { useTranslation } from "react-i18next";
import { formerUserId } from "../../lib/users";
import { useActors } from "../users/queries";

// WHO TYPED EACH ORDER IN — the name on a row, for a page of orders.
//
// `Order.created_by_user_id` is read from whoever placed it, never typed; the name is user_service's, read live with
// one UserByIDs for the page. 0 is "not recorded" (an order from before the creator was kept) and gets no name at
// all rather than an invented one. A former user reads as one; an id the lookup could not name, as its number.
export function useTypists(orders: { createdByUserId: bigint }[]): (userId: bigint) => string {
  const { t } = useTranslation();
  const people = useActors(orders.map((o) => o.createdByUserId));

  return (userId) => {
    if (userId === 0n) return "";

    const person = people.data?.get(userId.toString());
    if (!person) return t("orders.timeline.userRef", { id: userId.toString() });

    const formerId = formerUserId(person);

    return formerId ? t("users.formerUser", { id: formerId }) : person.name || person.username;
  };
}

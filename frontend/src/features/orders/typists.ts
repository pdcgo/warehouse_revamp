import { useTranslation } from "react-i18next";
import { personName } from "../../lib/users";
import { type ScreenPeople, useActors } from "../users/queries";

// WHO TYPED EACH ORDER IN — the name on a row, for a page of orders.
//
// `Order.created_by_user_id` is read from whoever placed it, never typed; the name is user_service's, read live with
// one UserByIDs for the page. 0 is "not recorded" (an order from before the creator was kept) and gets no name at
// all rather than an invented one. A former user reads as one; an id the lookup could not name, as its number.
//
// `screen`: a screen that names ALL its people with one read (useScreenPeople — the order list, beside its "created by"
// filter, #133) hands it in and this asks nothing; alone (the pick queue) it reads the page's typists itself.
export function useTypists(orders: { createdByUserId: bigint }[], screen?: ScreenPeople): (userId: bigint) => string {
  const { t } = useTranslation();
  const own = useActors(screen ? [] : orders.map((o) => o.createdByUserId));
  const people = screen ? screen.byId : own.data;

  return (userId) => {
    if (userId === 0n) return "";

    const person = people?.get(userId.toString());

    return personName(person, t("orders.timeline.userRef", { id: userId.toString() }));
  };
}

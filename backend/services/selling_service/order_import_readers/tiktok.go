package order_import_readers

import (
	"fmt"
	"strings"
)

// The TikTok order export's columns (Seller Center → Orders → Export). One row per PRODUCT, and — the trap — a row
// under the header DESCRIBING each column, whose Order ID reads "Platform unique order ID.".
const (
	tiktokRef       = "Order ID"
	tiktokStatus    = "Order Status"
	tiktokSubstatus = "Order Substatus"
	tiktokReturn    = "Cancelation/Return Type"
)

// ReadTiktok reads a TikTok order export into one Order per Order ID, in the file's order.
func ReadTiktok(content []byte) ([]Order, error) {
	all, err := sheets(content)
	if err != nil {
		return nil, err
	}

	rows, at, cols, ok := findTable(all, tiktokRef, tiktokStatus)
	if !ok {
		return nil, fmt.Errorf("%w: no %q and %q columns — is it a TikTok order export?",
			ErrNotThisExport, tiktokRef, tiktokStatus)
	}

	var out []Order

	seen := map[string]bool{}

	for i := at + 1; i < len(rows); i++ {
		ref := cols.cell(rows[i], tiktokRef)

		// An Order ID is digits. Anything else is the description row, or a blank one.
		if !digits(ref) || seen[ref] {
			continue
		}

		seen[ref] = true

		status := cols.cell(rows[i], tiktokStatus)
		sub := cols.cell(rows[i], tiktokSubstatus)
		ret := cols.cell(rows[i], tiktokReturn)

		out = append(out, Order{
			Ref:    ref,
			Status: tiktokMeaning(status, sub, ret),
			Words:  words(status, sub, ret),
			Row:    i + 1,
		})
	}

	return out, nil
}

// tiktokMeaning is what TikTok's words mean. ⚠ The words are the mocks' — see the package note.
func tiktokMeaning(status, sub, ret string) Status {
	s := strings.ToLower(status)

	if s == "canceled" || s == "cancelled" {
		return StatusCancelled
	}

	// "Return/Refund", "Refund only" — open or done, whatever the status says. "Cancel" is not a return.
	r := strings.ToLower(ret)
	if strings.Contains(r, "return") || strings.Contains(r, "refund") {
		return StatusReturn
	}

	switch s {
	case "unpaid", "on hold", "to ship", "awaiting shipment", "awaiting collection":
		return StatusBeforeHandover
	case "shipped", "in transit":
		// Shipped covers the whole trip; the substatus says when it has arrived.
		if strings.EqualFold(sub, "Delivered") {
			return StatusCompleted
		}

		return StatusInTransit
	case "delivered", "completed":
		return StatusCompleted
	}

	return StatusUnknown
}

func digits(s string) bool {
	if s == "" {
		return false
	}

	for _, r := range s {
		if r < '0' || r > '9' {
			return false
		}
	}

	return true
}

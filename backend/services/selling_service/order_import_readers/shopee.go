package order_import_readers

import (
	"fmt"
	"strings"
)

// The Shopee order export's columns (Seller Centre → Pesanan Saya → Export). One row per PRODUCT, so an order with
// three products repeats its No. Pesanan three times.
const (
	shopeeRef    = "No. Pesanan"
	shopeeStatus = "Status Pesanan"
	// Cancellations and returns are told apart here, not in the status: a returned order still reads Selesai.
	shopeeReturn = "Status Pembatalan/ Pengembalian"
)

// ReadShopee reads a Shopee order export into one Order per No. Pesanan, in the file's order.
func ReadShopee(content []byte) ([]Order, error) {
	all, err := sheets(content)
	if err != nil {
		return nil, err
	}

	rows, at, cols, ok := findTable(all, shopeeRef, shopeeStatus)
	if !ok {
		return nil, fmt.Errorf("%w: no %q and %q columns — is it a Shopee order export?",
			ErrNotThisExport, shopeeRef, shopeeStatus)
	}

	var out []Order

	seen := map[string]bool{}

	for i := at + 1; i < len(rows); i++ {
		ref := cols.cell(rows[i], shopeeRef)
		if ref == "" || seen[ref] {
			continue
		}

		seen[ref] = true

		status := cols.cell(rows[i], shopeeStatus)
		ret := cols.cell(rows[i], shopeeReturn)

		out = append(out, Order{
			Ref:    ref,
			Status: shopeeMeaning(status, ret),
			Words:  words(status, ret),
			Row:    i + 1,
		})
	}

	return out, nil
}

// shopeeMeaning is what Shopee's words mean. ⚠ The words are the mocks' — see the package note.
func shopeeMeaning(status, ret string) Status {
	if status == "Batal" {
		return StatusCancelled
	}

	// "Pengembalian Dana Disetujui", "Pengembalian Barang/Dana …" — a refund or a return, whatever the status says.
	if strings.Contains(ret, "Pengembalian") {
		return StatusReturn
	}

	switch status {
	case "Belum Bayar", "Perlu Dikirim":
		return StatusBeforeHandover
	case "Sedang Dikirim", "Dikirim":
		return StatusInTransit
	case "Selesai":
		return StatusCompleted
	}

	return StatusUnknown
}

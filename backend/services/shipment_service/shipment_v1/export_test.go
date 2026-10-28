package shipment_v1

import (
	"io"

	"github.com/pdcgo/san_receipt_readers"
)

// NewServiceWithExtract is NewService with the label reader swapped for `extract` — so a test can hold a check
// open, which no real label does for long enough to race against. Compiled into tests only.
func NewServiceWithExtract(extract func(io.Reader) (san_receipt_readers.ReceiptData, error)) *Service {
	s := NewService(nil)
	s.extract = extract

	return s
}

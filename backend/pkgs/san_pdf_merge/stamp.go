package san_pdf_merge

import (
	"errors"
	"fmt"
	"strings"

	"github.com/pdfcpu/pdfcpu/pkg/api"
	"github.com/pdfcpu/pdfcpu/pkg/pdfcpu/model"
	"github.com/pdfcpu/pdfcpu/pkg/pdfcpu/types"
)

// Option tunes a Merge.
type Option func(*options)

type options struct {
	// stamp is the one line printed on every page; "" prints nothing.
	stamp string
}

// StampEveryPage prints ONE line of text along the bottom margin of EVERY page of the merged PDF — a picture's page as
// much as a PDF's (the-unboxing-warning-is-one-sentence-on-each-label). Empty text stamps nothing.
//
// The line is drawn ON TOP of the page, centred, a few points above its bottom edge, in Helvetica Bold black, its width
// a share of the page's own width — so a 100 mm label, an A4 page and a 4000-pixel photo page all carry it at the same
// proportion and it never runs past a page's sides. The core font draws Latin-1 text only: the caller's sentence is
// plain Indonesian.
func StampEveryPage(text string) Option {
	return func(o *options) {
		o.stamp = strings.TrimSpace(text)
	}
}

// stampDescription is pdfcpu's stamp: on top, bottom centre, 4 pt up, its width 75 % of the page's, upright, solid black.
const stampDescription = "fontname:Helvetica-Bold, points:12, scalefactor:0.75 rel, position:bc, offset:0 4, " +
	"rotation:0, fillcolor:#000000, opacity:1"

// ErrStamp is why a stamped merge failed as a whole: the stamp could not be drawn.
var ErrStamp = errors.New("the stamp can't be drawn")

// stampPages draws text on every page of dest. A failure — a page the library cannot stamp, or a panic inside it — fails
// the merge as a whole: a print asked to carry the line must never come out without it on some pages.
func stampPages(dest *model.Context, text string) (err error) {
	defer recoverInto(&err)

	wm, err := api.TextWatermark(text, stampDescription, true, false, types.POINTS)
	if err != nil {
		return fmt.Errorf("%w: %w", ErrStamp, err)
	}

	// No page named = every page.
	err = api.WatermarkContext(dest, nil, wm)
	if err != nil {
		return fmt.Errorf("%w: %w", ErrStamp, err)
	}

	return nil
}

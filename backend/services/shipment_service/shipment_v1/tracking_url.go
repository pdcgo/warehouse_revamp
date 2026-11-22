package shipment_v1

import (
	"errors"
	"net/url"
	"strings"
	"unicode"

	"connectrpc.com/connect"
)

// THE COURIER'S TRACKING LINK — root's link to the courier's own tracking page, `{resi}` where the number goes
// (an-orders-resi-links-to-the-couriers-tracking-page, the-tracking-link-prototype-is-accepted). The screen fills every
// `{resi}` with the order's resi, URL-encoded; this side only keeps the link and refuses one that could not work.
//
// The rule is the channels screen's own (frontend/src/features/shipment/trackingLink.ts `trackingLinkProblem`), so the
// form and the server refuse the same links, each for its own reason:
//   - "" is fine — the link is OPTIONAL: a courier with none leaves its orders' resi copy-only;
//   - not `https://` — refused (the link opens from a signed-in page);
//   - no `{resi}` — refused (a-tracking-link-must-carry-the-resi): it would open the courier's page without the parcel;
//   - no address (a space, no host) — refused.
//
// The 500-character cap is the proto's (`max_len`), checked by the validator before a handler runs.

// trackingResi is where the resi goes in the link.
const trackingResi = "{resi}"

var (
	errTrackingNotHTTPS = errors.New("the tracking link must start with https://")
	errTrackingNoResi   = errors.New("the tracking link must hold {resi} where the resi goes")
	errTrackingNotAURL  = errors.New("the tracking link is not a web address")
)

// trackingURLProblem answers why a link is refused, or nil. `link` is already trimmed.
func trackingURLProblem(link string) error {
	if link == "" {
		return nil
	}

	if !strings.HasPrefix(strings.ToLower(link), "https://") {
		return errTrackingNotHTTPS
	}

	if !strings.Contains(link, trackingResi) {
		return errTrackingNoResi
	}

	if strings.IndexFunc(link, unicode.IsSpace) >= 0 {
		return errTrackingNotAURL
	}

	parsed, err := url.Parse(strings.ReplaceAll(link, trackingResi, "RESI"))
	if err != nil {
		return errTrackingNotAURL
	}

	if !strings.EqualFold(parsed.Scheme, "https") || parsed.Host == "" {
		return errTrackingNotAURL
	}

	return nil
}

// checkTrackingURL trims the link a write sends and answers what to store, or INVALID_ARGUMENT naming the reason.
func checkTrackingURL(raw string) (string, error) {
	link := strings.TrimSpace(raw)

	err := trackingURLProblem(link)
	if err != nil {
		return "", connect.NewError(connect.CodeInvalidArgument, err)
	}

	return link, nil
}

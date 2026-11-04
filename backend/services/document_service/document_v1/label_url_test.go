package document_v1_test

import (
	"context"
	"strings"
	"testing"

	"connectrpc.com/connect"

	documentv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/document/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/document_service/docstore"
	document_v1 "github.com/pdcgo/warehouse_revamp/backend/services/document_service/document_v1"
)

// uploadAs runs the real upload flow for one resource type and returns the finished document's id.
func uploadAs(
	t *testing.T,
	svc *document_v1.Service,
	cfg docstore.Config,
	teamID uint64,
	resource documentv1.DocumentResourceType,
	filename string,
) string {
	t.Helper()

	ctx := context.Background()

	up, err := svc.RequestUpload(ctx, connect.NewRequest(&documentv1.RequestUploadRequest{
		TeamId:       teamID,
		ResourceType: resource,
		ContentType:  "application/pdf",
		SizeBytes:    10,
		Filename:     filename,
	}))
	if err != nil {
		t.Fatalf("RequestUpload: %v", err)
	}

	putBytes(t, cfg, up.Msg.GetUploadUrl(), []byte("%PDF-label"))

	conf, err := svc.ConfirmUpload(ctx, connect.NewRequest(&documentv1.ConfirmUploadRequest{
		UploadToken: up.Msg.GetUploadToken(),
	}))
	if err != nil {
		t.Fatalf("ConfirmUpload: %v", err)
	}

	return conf.Msg.GetDocument().GetId()
}

// a-warehouse-prints-the-labels-of-orders-it-ships, the document side: an active order receipt of the owner the order
// service names is signed — with no share, and the link keeps the label's own name.
func TestLabelURL_SignsTheOwnersOrderReceipt(t *testing.T) {
	db := san_testdb.DB(t)
	svc, cfg := newService(t, db)

	label := uploadAs(t, svc, cfg, payerTeam, documentv1.DocumentResourceType_DOCUMENT_RESOURCE_TYPE_ORDER_RECEIPT, "resi-2509AAA.pdf")

	url, expiresAt, err := svc.LabelURL(context.Background(), payerTeam, label)
	if err != nil {
		t.Fatalf("LabelURL: %v", err)
	}

	if !strings.HasPrefix(url, testBaseURL) || !strings.Contains(url, "resi-2509AAA.pdf") || expiresAt.IsZero() {
		t.Fatalf("url = %q, expires %v", url, expiresAt)
	}

	// Still no door for the warehouse itself: GetDownloadUrl under another team stays NotFound.
	if err = download(svc, label, creditorTeam); connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("GetDownloadUrl as another team = %v, want NotFound — LabelURL must not have shared it", err)
	}
}

// The narrow door: the wrong owner, another resource type, or an id nothing holds is NotFound.
func TestLabelURL_AnythingButTheOwnersOrderReceiptIsNotFound(t *testing.T) {
	db := san_testdb.DB(t)
	svc, cfg := newService(t, db)

	label := uploadAs(t, svc, cfg, payerTeam, documentv1.DocumentResourceType_DOCUMENT_RESOURCE_TYPE_ORDER_RECEIPT, "resi.pdf")
	proof := uploadAs(t, svc, cfg, payerTeam, documentv1.DocumentResourceType_DOCUMENT_RESOURCE_TYPE_PAYMENT_PROOF, "slip.pdf")

	for name, c := range map[string]struct {
		owner uint64
		id    string
	}{
		"another owner":    {strangerTeam, label},
		"a payment proof":  {payerTeam, proof},
		"no such document": {payerTeam, "nope"},
	} {
		_, _, err := svc.LabelURL(context.Background(), c.owner, c.id)
		if connect.CodeOf(err) != connect.CodeNotFound {
			t.Fatalf("%s: %v, want NotFound", name, err)
		}
	}
}

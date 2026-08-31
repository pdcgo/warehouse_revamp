package document_v1_test

import (
	"context"
	"testing"

	"connectrpc.com/connect"

	documentv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/document/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	document_v1 "github.com/pdcgo/warehouse_revamp/backend/services/document_service/document_v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/document_service/docstore"
)

// The payer's team, and the creditor who has to look at the proof.
const (
	payerTeam    uint64 = 2
	creditorTeam uint64 = 3
	strangerTeam uint64 = 4
)

// uploadProof runs the real upload flow and returns the finished document's id.
func uploadProof(t *testing.T, svc *document_v1.Service, cfg docstore.Config, teamID uint64) string {
	t.Helper()

	ctx := context.Background()

	up, err := svc.RequestUpload(ctx, connect.NewRequest(&documentv1.RequestUploadRequest{
		TeamId:       teamID,
		ResourceType: documentv1.DocumentResourceType_DOCUMENT_RESOURCE_TYPE_PAYMENT_PROOF,
		ContentType:  "image/png",
		SizeBytes:    9,
		Filename:     "transfer.png",
	}))
	if err != nil {
		t.Fatalf("RequestUpload: %v", err)
	}

	putBytes(t, cfg, up.Msg.GetUploadUrl(), []byte("some-bytes"))

	conf, err := svc.ConfirmUpload(ctx, connect.NewRequest(&documentv1.ConfirmUploadRequest{
		UploadToken: up.Msg.GetUploadToken(),
	}))
	if err != nil {
		t.Fatalf("ConfirmUpload: %v", err)
	}

	return conf.Msg.GetDocument().GetId()
}

func share(svc *document_v1.Service, docID string, owner, with uint64) error {
	_, err := svc.ShareDocument(context.Background(), connect.NewRequest(&documentv1.ShareDocumentRequest{
		TeamId:     owner,
		DocumentId: docID,
		WithTeamId: with,
	}))

	return err
}

func download(svc *document_v1.Service, docID string, asTeam uint64) error {
	_, err := svc.GetDownloadUrl(context.Background(), connect.NewRequest(&documentv1.GetDownloadUrlRequest{
		TeamId: asTeam, DocumentId: docID,
	}))

	return err
}

// THE WHOLE POINT: the creditor cannot read the payer's proof until the payer shares it, and can
// immediately afterwards (a-payment-must-carry-proof).
//
// Without this, §Payment Flow's middle step — "Team B check manually" — has nothing to look at, and
// the two-phase design degrades into the creditor taking the payer's word.
func TestShareDocument_OpensOneDocumentToOneOtherTeam(t *testing.T) {
	db := san_testdb.DB(t)
	svc, cfg := newService(t, db)

	docID := uploadProof(t, svc, cfg, payerTeam)

	// Before the share, the creditor is exactly the person the ACL excludes.
	err := download(svc, docID, creditorTeam)
	if err == nil {
		t.Fatal("the creditor could read an unshared document")
	}
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("unshared read returned %v, want NotFound — a caller must not learn the id exists",
			connect.CodeOf(err))
	}

	if shareErr := share(svc, docID, payerTeam, creditorTeam); shareErr != nil {
		t.Fatalf("ShareDocument: %v", shareErr)
	}

	if readErr := download(svc, docID, creditorTeam); readErr != nil {
		t.Fatalf("the creditor still cannot read a document shared with them: %v", readErr)
	}
}

// A SHARE OPENS THE DOCUMENT TO ONE TEAM, not to everyone holding an id. Sharing with the creditor
// must not make the file readable by a third team — which is the failure mode of widening
// GetDownloadUrl instead of recording a row.
func TestShareDocument_DoesNotOpenTheDocumentToAnybodyElse(t *testing.T) {
	db := san_testdb.DB(t)
	svc, cfg := newService(t, db)

	docID := uploadProof(t, svc, cfg, payerTeam)

	if err := share(svc, docID, payerTeam, creditorTeam); err != nil {
		t.Fatalf("ShareDocument: %v", err)
	}

	err := download(svc, docID, strangerTeam)
	if err == nil {
		t.Fatal("a team the document was never shared with could read it")
	}
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("stranger read returned %v, want NotFound", connect.CodeOf(err))
	}
}

// ONLY THE OWNER MAY SHARE. A caller who could share somebody else's document could hand any private
// file to any team — the exact hole the team scope exists to close, reopened from the other side.
func TestShareDocument_RefusesSharingSomebodyElsesDocument(t *testing.T) {
	db := san_testdb.DB(t)
	svc, cfg := newService(t, db)

	docID := uploadProof(t, svc, cfg, payerTeam)

	// The creditor tries to share the payer's document with itself.
	err := share(svc, docID, creditorTeam, strangerTeam)
	if err == nil {
		t.Fatal("a team shared a document it does not own")
	}
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("returned %v, want NotFound — ownership is the WHERE clause, not a later check",
			connect.CodeOf(err))
	}
}

// GRANTING TWICE IS THE SAME FACT. A retried client, or a payer attaching the same file to a second
// payment for the same creditor, must not double-write and must not fail: the state it asked for is
// the state that already exists.
func TestShareDocument_IsIdempotent(t *testing.T) {
	db := san_testdb.DB(t)
	svc, cfg := newService(t, db)

	docID := uploadProof(t, svc, cfg, payerTeam)

	for i := 0; i < 2; i++ {
		if err := share(svc, docID, payerTeam, creditorTeam); err != nil {
			t.Fatalf("ShareDocument attempt %d: %v", i+1, err)
		}
	}

	var count int64

	err := db.Table("document_shares").
		Where("document_id = ? AND team_id = ?", docID, creditorTeam).
		Count(&count).
		Error
	if err != nil {
		t.Fatalf("count shares: %v", err)
	}

	if count != 1 {
		t.Fatalf("%d share rows, want 1 — a second grant is the same fact", count)
	}
}

// SHARING WITH YOURSELF IS NOT A SHARE. It would be a no-op row making "is this shared?" answer yes
// for a document that never left its team.
func TestShareDocument_RefusesSharingWithTheOwner(t *testing.T) {
	db := san_testdb.DB(t)
	svc, cfg := newService(t, db)

	docID := uploadProof(t, svc, cfg, payerTeam)

	err := share(svc, docID, payerTeam, payerTeam)
	if err == nil {
		t.Fatal("a team shared a document with itself")
	}
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("returned %v, want InvalidArgument", connect.CodeOf(err))
	}
}

// ⚠ A SHARED DOCUMENT CANNOT BE HARD-DELETED. The creditor accepted or rejected a payment by looking
// at this file, and evidence for a decision somebody may be asked about later cannot be withdrawn by
// the party who supplied it. The FK is ON DELETE RESTRICT, so the database refuses rather than the
// application remembering to.
func TestShareDocument_AShareStopsTheDocumentBeingDeleted(t *testing.T) {
	db := san_testdb.DB(t)
	svc, cfg := newService(t, db)

	docID := uploadProof(t, svc, cfg, payerTeam)

	if err := share(svc, docID, payerTeam, creditorTeam); err != nil {
		t.Fatalf("ShareDocument: %v", err)
	}

	err := db.Exec("DELETE FROM documents WHERE id = ?", docID).Error
	if err == nil {
		t.Fatal("a shared document was deleted, taking the creditor's evidence with it")
	}

	// It must still be readable by both sides afterwards.
	if readErr := download(svc, docID, creditorTeam); readErr != nil {
		t.Fatalf("the proof is gone after a refused delete: %v", readErr)
	}
}

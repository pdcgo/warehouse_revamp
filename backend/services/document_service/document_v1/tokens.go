package document_v1

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"path"
	"strconv"
	"strings"
	"time"
)

// The upload token is `base64url(payload).base64url(hmac(payload))` where payload is
// "documentID:expiryUnix". It lets ConfirmUpload recover the document id WITHOUT trusting a
// client-supplied one, and it can't be forged without the server's secret.

func (s *Service) signToken(documentID string, expiry time.Time) string {
	payload := documentID + ":" + strconv.FormatInt(expiry.Unix(), 10)

	return base64.RawURLEncoding.EncodeToString([]byte(payload)) + "." + hmacSig(payload, s.cfg.TokenSecret)
}

func (s *Service) verifyToken(token string, now time.Time) (string, error) {
	rawPayload, sig, found := strings.Cut(token, ".")
	if !found {
		return "", errors.New("malformed token")
	}

	payloadBytes, err := base64.RawURLEncoding.DecodeString(rawPayload)
	if err != nil {
		return "", errors.New("malformed token")
	}

	payload := string(payloadBytes)

	// Constant-time compare — never a plain ==.
	if !hmac.Equal([]byte(hmacSig(payload, s.cfg.TokenSecret)), []byte(sig)) {
		return "", errors.New("invalid token")
	}

	documentID, expiryText, found := strings.Cut(payload, ":")
	if !found || documentID == "" {
		return "", errors.New("malformed token")
	}

	expiryUnix, err := strconv.ParseInt(expiryText, 10, 64)
	if err != nil {
		return "", errors.New("malformed token")
	}

	if now.Unix() > expiryUnix {
		return "", errors.New("token expired")
	}

	return documentID, nil
}

func hmacSig(payload, secret string) string {
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(payload))

	return base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}

// newID is a random 128-bit hex id (no external uuid dependency needed).
func newID() (string, error) {
	b := make([]byte, 16)

	_, err := rand.Read(b)
	if err != nil {
		return "", err
	}

	return hex.EncodeToString(b), nil
}

// objectKey is the storage path for a document under a lifecycle prefix. The extension comes from
// the client filename; the id is a uuid, so keys never collide.
func objectKey(prefix string, teamID uint64, documentID, filename string) string {
	return fmt.Sprintf("%s/teams/%d/%s%s", prefix, teamID, documentID, path.Ext(filename))
}

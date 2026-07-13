package san_config

import (
	"context"
	"fmt"
	"hash/crc32"

	secretmanager "cloud.google.com/go/secretmanager/apiv1"
	"cloud.google.com/go/secretmanager/apiv1/secretmanagerpb"
	"gopkg.in/yaml.v3"
)

// GoogleSecretProvider reads a secret payload from Google Secret Manager and parses it as
// YAML. JSON is valid YAML, so a JSON payload works unchanged.
//
// The context is captured at construction because [ConfigProvider.Unmarshal] takes none.
type GoogleSecretProvider struct {
	// Name is a fully-qualified secret VERSION:
	//   projects/<project>/secrets/<secret>/versions/<version|latest>
	Name string

	ctx context.Context
}

// NewGoogleSecretProvider reads the LATEST version of a secret.
func NewGoogleSecretProvider(ctx context.Context, project, secret string) *GoogleSecretProvider {
	name := fmt.Sprintf("projects/%s/secrets/%s/versions/latest", project, secret)

	return &GoogleSecretProvider{Name: name, ctx: ctx}
}

// NewGoogleSecretVersionProvider pins an exact secret version. Prefer this in production:
// "latest" means a deploy can silently pick up a secret someone changed an hour ago.
func NewGoogleSecretVersionProvider(ctx context.Context, name string) *GoogleSecretProvider {
	return &GoogleSecretProvider{Name: name, ctx: ctx}
}

// Unmarshal implements [ConfigProvider].
func (p *GoogleSecretProvider) Unmarshal(dst any) error {
	ctx := p.ctx
	if ctx == nil {
		ctx = context.Background()
	}

	if p.Name == "" {
		return fmt.Errorf("google secret: Name is empty")
	}

	client, err := secretmanager.NewClient(ctx)
	if err != nil {
		return fmt.Errorf("secret manager client: %w", err)
	}
	defer client.Close()

	res, err := client.AccessSecretVersion(ctx, &secretmanagerpb.AccessSecretVersionRequest{
		Name: p.Name,
	})
	if err != nil {
		return fmt.Errorf("accessing %s: %w", p.Name, err)
	}

	payload := res.GetPayload()
	if payload == nil {
		return fmt.Errorf("secret %s returned no payload", p.Name)
	}

	data := payload.GetData()

	// Secret Manager ships a CRC32C of the payload. Verifying it turns a silent corruption
	// into a loud failure — worth the four lines, because a half-read secret would surface
	// later as an inscrutable config bug.
	err = verifyChecksum(data, payload.DataCrc32C)
	if err != nil {
		return fmt.Errorf("secret %s: %w", p.Name, err)
	}

	err = yaml.Unmarshal(data, dst)
	if err != nil {
		return fmt.Errorf("parsing secret %s: %w", p.Name, err)
	}

	return nil
}

func verifyChecksum(data []byte, want *int64) error {
	if want == nil {
		return nil // the API did not supply one
	}

	table := crc32.MakeTable(crc32.Castagnoli)

	got := int64(crc32.Checksum(data, table))
	if got != *want {
		return fmt.Errorf("payload checksum mismatch (got %d, want %d)", got, *want)
	}

	return nil
}

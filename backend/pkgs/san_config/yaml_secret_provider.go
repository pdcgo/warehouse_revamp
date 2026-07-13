package san_config

import (
	"errors"
	"fmt"
	"io/fs"
	"os"

	"gopkg.in/yaml.v3"
)

// YamlSecretProvider reads configuration from a YAML file.
//
// Keys absent from the document leave their fields untouched, which is exactly the layering
// contract in [ConfigProvider].
type YamlSecretProvider struct {
	Path string

	// Optional makes a MISSING file a no-op rather than an error. Use it for a local
	// override file that exists only on a developer's machine. A file that exists but is
	// malformed is always an error — that is a mistake, not an absence.
	Optional bool
}

func NewYamlSecretProvider(path string) *YamlSecretProvider {
	return &YamlSecretProvider{Path: path}
}

// NewOptionalYamlSecretProvider tolerates the file not existing.
func NewOptionalYamlSecretProvider(path string) *YamlSecretProvider {
	return &YamlSecretProvider{Path: path, Optional: true}
}

// Unmarshal implements [ConfigProvider].
func (p *YamlSecretProvider) Unmarshal(dst any) error {
	raw, err := os.ReadFile(p.Path)
	if err != nil {
		if p.Optional && errors.Is(err, fs.ErrNotExist) {
			return nil
		}

		return fmt.Errorf("reading %s: %w", p.Path, err)
	}

	err = yaml.Unmarshal(raw, dst)
	if err != nil {
		return fmt.Errorf("parsing %s: %w", p.Path, err)
	}

	return nil
}

// Package san_config assembles one configuration struct from layered sources.
package san_config

import (
	"errors"
	"fmt"
	"reflect"
)

// ConfigProvider fills the fields it knows about on dst and leaves every other field
// untouched.
//
// "Leaves every other field untouched" IS the contract — it is the whole reason layering
// works. A provider that zeroed the fields it has no opinion about would wipe out the layer
// beneath it.
type ConfigProvider interface {
	Unmarshal(dst any) error
}

// ConfigProvider has 3 implementations:
//  1. GoogleSecretProvider in ./google_secret_provider.go
//  2. YamlSecretProvider   in ./yaml_secret_provider.go
//  3. EnvSecretProvider    in ./env_secret_provider.go

// NewConfiguration applies every provider to dst IN ORDER. A later provider overrides only
// the fields it actually defines, so the natural arrangement is base first, overrides last:
//
//	var cfg Config
//	err := san_config.NewConfiguration(&cfg,
//	    san_config.NewYamlSecretProvider("config.yaml"), // base
//	    san_config.NewEnvSecretProvider(""),             // overrides
//	)
//
// dst must be a non-nil pointer to a struct.
//
// On error, dst is left PARTIALLY populated — earlier providers have already written to it.
// Treat a non-nil error as "cfg is unusable", never as "cfg is half-good".
func NewConfiguration(dst any, providers ...ConfigProvider) error {
	err := validateTarget(dst)
	if err != nil {
		return err
	}

	for i, provider := range providers {
		if provider == nil {
			return fmt.Errorf("san_config: provider %d is nil", i)
		}

		err = provider.Unmarshal(dst)
		if err != nil {
			return fmt.Errorf("san_config: provider %d (%T): %w", i, provider, err)
		}
	}

	return nil
}

func validateTarget(dst any) error {
	if dst == nil {
		return errors.New("san_config: dst is nil")
	}

	value := reflect.ValueOf(dst)

	if value.Kind() != reflect.Pointer || value.IsNil() {
		return fmt.Errorf("san_config: dst must be a non-nil pointer, got %T", dst)
	}

	if value.Elem().Kind() != reflect.Struct {
		return fmt.Errorf("san_config: dst must point to a struct, got %T", dst)
	}

	return nil
}

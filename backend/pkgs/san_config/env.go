package san_config

import "os"

// osLookupEnv is the real environment. Indirected so EnvSecretProvider can be tested
// without mutating the process env.
func osLookupEnv(key string) (string, bool) {
	return os.LookupEnv(key)
}

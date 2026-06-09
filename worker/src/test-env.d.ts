// Type the `cloudflare:test` module's `env` with this worker's bindings.
declare module "cloudflare:test" {
  interface ProvidedEnv extends Env {}
}

# belote-worker

A Cloudflare worker for the belote web page.

## Commands

| Command | Purpose |
|---------|---------|
| `pnpm dev` | Local development |
| `pnpm deploy` | Deploy to Cloudflare |
| `pnpm test` | Run engine and WebSocket tests |
| `pnpm typecheck` | Check TypeScript |
| `pnpm cf-typegen` | Generate TypeScript types |

Run `pnpm cf-typegen` after changing bindings in wrangler.jsonc.

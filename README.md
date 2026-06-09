# Belote

An online [Belote](https://en.wikipedia.org/wiki/Belote) game for four players,
built with TypeScript and [Vite](https://vitejs.dev/) on the front end and a
[Cloudflare Worker](https://developers.cloudflare.com/workers/) + Durable Object
on the back end. The interface is in French.

A single global game lives in the Worker, which is the source of truth: it deals
the cards, runs the bidding and play, and scores each hand. Every device polls it
for the current state, so the four players stay in sync. There is no login —
play is trust-based; you pick which player you are on each device.

The four players are Sébastian, Maya, Liam and Dadmor, seated around a
full-screen table. Partners sit diagonally opposite, so the teams are
**Sébastian + Liam** and **Maya + Dadmor**, and play runs clockwise.

## How a hand goes

- **Pick your seat.** Each device chooses *“Qui êtes-vous ?”*; from then on only
  that player's hand is shown face-up and the others stay covered. *Changez le
  joueur* in the title bar switches seats.
- **Deal.** Each new deal is random. Everyone gets five cards (dealt in 3-then-2
  packets) and one card is turned up — the *retourne* — proposing trump. The
  opener (marked *commence*) rotates one seat clockwise every deal; the first
  deal opens with Sébastian. *Nouvelle donne* deals the next hand.
- **Bidding** runs in two rounds, in turn from the opener:
  - **Round 1:** each player either takes the retourne's suit as trump
    (**Prend**) or passes (**Non**).
  - **Round 2** (if all four passed): a player may take, naming any *other*
    suit, or pass.
  - If everyone passes twice, the hand is thrown in and the next one is dealt.
  - On a take, the taker keeps the turned card and draws two more while the
    others draw three, leaving everyone with eight cards.
- **Play.** On your turn, your legal cards are highlighted (green) and the rest
  dimmed; tap one to play it. Played cards appear full-size in each player's
  corner, sliding in from their hand, and a completed trick stays on the table
  until its winner leads the next card. Trump cards are ringed in gold; cards use
  French faces (V/D/R for Valet/Dame/Roi).

## Scoring

Full Belote scoring, computed by the Worker:

- **Card order & points** — trump J-9-A-10-K-Q-8-7 (20-14-11-10-4-3-0-0), plain
  A-10-K-Q-J-9-8-7 (11-10-4-3-2-0-0-0).
- **Dix de der** — +10 to the team winning the last trick (162 points per hand).
- **Belote-rebelote** — +20 to the team holding the King and Queen of trump,
  awarded automatically; it always counts.
- **Contract** — the taker's team must score *strictly more* than the defenders;
  a tie (81–81) or less is *dedans*, and the defenders take all 162.
- **Capot** — sweeping all eight tricks scores 252.

Scores accumulate across deals and are shown in the title bar. **Effacer les
scores** resets them.

## Live site

The front end deploys to GitHub Pages on every push to `main`:
https://keegan.ch/belote/

## Layout

- `frontend/` — the Vite TypeScript app, published to GitHub Pages.
- `worker/` — the Cloudflare Worker holding the game (the `BeloteGame` Durable
  Object) and the pure game engine in `worker/src/game/` (deck, rules, scoring,
  state machine).

## API

The Worker exposes one global game; every response is the full game state plus
the current player's legal cards.

| Method | Path     | Body                  | Effect                                      |
| ------ | -------- | --------------------- | ------------------------------------------- |
| `GET`  | `/state` | –                     | the current game state                      |
| `POST` | `/new`   | –                     | deal the next hand (rotating the opener)    |
| `POST` | `/bid`   | `{ seat, suit }`      | bid: `suit: null` passes, else takes at it  |
| `POST` | `/play`  | `{ seat, card }`      | play a card (validated against the rules)   |
| `POST` | `/clear` | –                     | reset the cumulative scores                 |

Illegal actions return `400 { error }` and leave the state untouched.

## Development

Both packages use [pnpm](https://pnpm.io/). Run the Worker and the front end
together for local play.

```bash
# Terminal 1 — the Worker
cd worker
pnpm install
cp .dev.vars.example .dev.vars   # first time only
pnpm dev                         # serves the worker at http://localhost:8787
pnpm test                        # run the engine + HTTP tests (Vitest)

# Terminal 2 — the front end
cd frontend
pnpm install
pnpm dev      # start the dev server (defaults to the local worker)
pnpm build    # type-check and build to dist/
pnpm preview  # preview the production build
pnpm test     # run the unit tests (Vitest)
```

The front end defaults to `http://localhost:8787`; set `VITE_WORKER_URL` at
build time (CI sets it to the deployed worker) to point the deployed site at it.

The Worker restricts CORS to known front-end origins. `keegan.ch` is always
allowed; the local Vite origins are allowed only in development, signalled by
`ENVIRONMENT=development` from `.dev.vars` (which `wrangler dev` loads
automatically — the deployed worker uses the `production` value from
`wrangler.jsonc`). Re-run `pnpm cf-typegen` after changing `vars`/bindings.

## Testing

- `worker/` holds the bulk of the tests: the pure game engine (dealing, card
  order, legal moves, trick resolution, every scoring case, the bidding state
  machine) plus the HTTP/Durable Object layer. They run in CI on every push and
  pull request via `.github/workflows/worker-tests.yml`.
- `frontend/` tests cover the card vocabulary and run before each Pages deploy.

## Deployment

- **Front end** — pushing to `main` runs `.github/workflows/deploy.yml`, which
  builds `frontend/` and publishes `frontend/dist/` to GitHub Pages (Settings →
  Pages → Build and deployment → GitHub Actions).
- **Worker** — deployed automatically by
  [Cloudflare Workers Builds](https://developers.cloudflare.com/workers/ci-cd/builds/)
  on push to `main`.

## License

[MIT](LICENSE) © Liam Keegan

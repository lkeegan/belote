# Belote

An online [Belote](https://en.wikipedia.org/wiki/Belote) game for four players,
built with TypeScript and [Vite](https://vitejs.dev/) on the front end and a
[Cloudflare Worker](https://developers.cloudflare.com/workers/) + Durable Object
on the back end. The interface is in French.

A single global game lives in the Worker, which is the source of truth: it deals
the cards, runs the bidding and play, and scores each hand. Every device keeps
a WebSocket open for state broadcasts, so the four players stay in sync. There is no login —
play is trust-based; you pick which player you are on each device.

The four players are Sébastian, Maya, Liam and Dadmor, seated around a
full-screen table. Partners sit diagonally opposite, so the teams are
**Sébastian + Liam** and **Maya + Dadmor**, and play runs clockwise.

## How a hand goes

- **Pick your seat.** Each device chooses *“Qui êtes-vous ?”*; from then on only
  that player's hand is shown face-up and the others stay covered. *Changez le
  joueur* in the title bar switches seats.
- **Deal.** A new match shuffles a fresh pack; later deals gather and cut it.
  Everyone gets five cards (dealt in 3-then-2 packets) and one card is turned up — the *retourne* — proposing trump. The
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
- **Voice bidding.** Choose a seat and press **🎙 Activer l’audio** once to
  enable grammar-constrained French Vosk recognition on this device. It listens
  on your bidding turns and pauses between them. Say “Je prends à cœurs”, “non”,
  or “deux” (second round). Press **Désactiver l’audio** to release the microphone.
  Detected text and command status are shown for debugging; only final, legal
  commands can bid. Changing seats or hiding the tab switches audio off.
  The first activation loads the cached/static French model (~42 MB); audio
  stays on-device and no ASR server is needed. Microphone permission and HTTPS
  (or localhost) are required. See [the comparison](voice-rec.md), or open
  `voice.html` for the separate experiment lab.

## Scoring

Full Belote scoring, computed by the Worker:

- **Card order & points** — trump J-9-A-10-K-Q-8-7 (20-14-11-10-4-3-0-0), plain
  A-10-K-Q-J-9-8-7 (11-10-4-3-2-0-0-0).
- **Dix de der** — +10 to the team winning the last trick (162 points per hand).
- **Belote-rebelote** — +20 to the team holding the King and Queen of trump,
  awarded automatically; it always counts.
- **Contract** — the taker's team must score *strictly more* than the defenders,
  including bonuses. A tie or less is *dedans*, and the defenders take all 162
  card points.
- **Capot** — sweeping all eight tricks scores 252.

Scores accumulate across deals and are shown in the title bar. **Nouvelle
partie** reshuffles and resets them. A team wins by reaching 1000 while ahead;
a tie at the target keeps the match going.

Annonces (sequences and carrés) are detected automatically from the original
eight-card hands. The team with the strongest declaration scores all of its
annonces; equal top declarations cancel, with trump breaking sequence ties.
Longer sequences beat shorter ones before comparing their top cards. Annonces
and belote count toward the contract and remain with their holders on a dedans
or capot. Players can reveal their original annonces during the second trick.

## Live site

The front end deploys to GitHub Pages on every push to `main`:
https://keegan.ch/belote/

## Layout

- `shared/` — card vocabulary and types used by the frontend and Worker.
- `frontend/` — the Vite TypeScript app, published to GitHub Pages.
- `worker/` — the Cloudflare Worker holding the game (the `BeloteGame` Durable
  Object) and the pure game engine in `worker/src/game/` (deck, rules, scoring,
  state machine).

## API

The Worker exposes one global game over a WebSocket connection to its base URL
(`ws://localhost:8787` locally, `wss://…` in production). It validates the Origin
before upgrading. REST endpoints are not provided.

On connection, the Worker sends the current game, dealing the first hand if
needed. Send JSON messages of the form `{ "path": "/bid", "body": { … } }`.
Successful actions broadcast the new state to every connection; invalid actions
send `{ "error": "…" }` only to the sender and leave state untouched.

| Path | Body | Effect |
| ---- | ---- | ------ |
| `/new` | `{ dealId }` | Gather, cut and deal the next hand; rotate the opener |
| `/new-match` | `{ dealId }` | Shuffle a fresh pack and reset scores |
| `/bid` | `{ seat, suit }` | Pass with `suit: null`, otherwise take |
| `/play` | `{ seat, card }` | Play a legal card |
| `/undo` | `{ seat }` | Take back the last card before another card covers it |
| `/replace` | `{ seat, card }` | Replace that last card with a legal alternative |
| `/show-annonces` | `{ seat }` | Broadcast `{ reveal: { seat, annonces } }` on the second trick |

`dealId` comes from the displayed state and increases with each deal, including
new matches and hands passed twice. The server rejects stale deal-changing
requests, so simultaneous next-deal clicks cannot skip a hand. Cards have
`{ suit, rank }`; seats are numbered 0–3. State includes all four hands (the game
is trust-based), legal plays/replacements, and annonce-reveal eligibility; the
undealt talon stays on the server. Shared definitions live in `shared/`.

## Development

Both packages use [pnpm](https://pnpm.io/). Run the Worker and the front end
together for local play. Frontend dev/build also use Python 3 (standard library
only) to prepare the pinned French Vosk model as a static asset. The first run
downloads roughly 40 MB; subsequent runs reuse the generated file.

```bash
# Terminal 1 — the Worker
cd worker
pnpm install
cp .dev.vars.example .dev.vars   # first time only
pnpm dev                         # serves the worker at http://localhost:8787
pnpm test                        # run the engine + WebSocket tests (Vitest)
pnpm typecheck                   # check Worker TypeScript

# Terminal 2 — the front end
cd frontend
pnpm install
pnpm dev      # start the dev server (defaults to the local worker)
pnpm build    # prepare static voice model, type-check and build to dist/
pnpm preview  # preview the production build
pnpm test     # run the unit tests (Vitest)
```

The front end defaults to `http://localhost:8787`; set `VITE_WORKER_URL` at
build time (CI sets it to the deployed worker) to point the deployed site at it.

The Worker restricts WebSocket connections to known front-end origins.
`keegan.ch` is always allowed; the local Vite origins are allowed only in development, signalled by
`ENVIRONMENT=development` from `.dev.vars` (which `wrangler dev` loads
automatically — the deployed worker uses the `production` value from
`wrangler.jsonc`). Re-run `pnpm cf-typegen` after changing `vars`/bindings.

## Testing

- `worker/` holds the bulk of the tests: the pure game engine (dealing, card
  order, legal moves, trick resolution, every scoring case, the bidding state
  machine) plus the WebSocket/Durable Object layer. They run in CI on every push
  and pull request via `.github/workflows/worker-tests.yml`.
- `frontend/` tests cover result helpers, connection/animation lifecycles, keyboard
  controls, focus preservation, and effect cleanup. Tests and the production
  build run on pull requests and before each Pages deploy. The Worker also
  runs type-checking in CI.

## Deployment

- **Front end** — pushing to `main` runs `.github/workflows/deploy.yml`, which
  builds `frontend/` and publishes `frontend/dist/` to GitHub Pages (Settings →
  Pages → Build and deployment → GitHub Actions).
- **Worker** — deployed automatically by
  [Cloudflare Workers Builds](https://developers.cloudflare.com/workers/ci-cd/builds/)
  on push to `main`.

## License

[MIT](LICENSE) © Liam Keegan

# Belote

A simple online Belote game, built with TypeScript and [Vite](https://vitejs.dev/).
The interface is in French.

It works as a shared, backend-free deal aid. The four players (Sébastian, Maya,
Dadmor and Liam — partners sit diagonally) sit in the four corners of a
full-screen table. They agree on a game number, and the deterministic shuffle
gives everyone the same deal with no server or network. The number defaults to
today's date, so a fresh game is shared by everyone playing that day, and
**Partie suivante** steps to the next one.

- **Opening deal:** 3-then-2 packets to each player (five cards), one card
  turned up (the *retourne*) to propose trump, the rest left as the talon. Tap a
  player to reveal or hide their hand in their corner.
- **Bidding:** the opener (game number mod 4, marked *commence*, rotating each
  game) starts; bidding is done out loud in person. Afterwards, tap **Prend** on
  the seat that took the turned card.
- **Completing the deal:** the taker keeps the turned card and draws two more,
  the others draw three, leaving everyone with eight cards. Trump-suit cards are
  ringed in gold. Cards use French faces (V/D/R for Valet/Dame/Roi).

Recording the same game number and taker on every device produces identical,
duplicate-free hands.

## Live site

Deployed on every push to `main`: https://keegan.ch/belote/

## Layout

- `frontend/` — the Vite TypeScript app published to GitHub Pages.
- `worker/` — a Cloudflare Worker.

## Development

The frontend uses [pnpm](https://pnpm.io/).

```bash
cd frontend
pnpm install
pnpm dev      # start the dev server
pnpm build    # type-check and build to dist/
pnpm preview  # preview the production build
pnpm test     # run the unit tests (Vitest)
```

The unit tests (`frontend/src/*.test.ts`) cover the dealing logic and also run
in CI before each deploy.

### Worker

The frontend fetches a greeting from the Cloudflare Worker in `worker/` and
shows it in the top bar. Run the worker locally with:

```bash
cd worker
pnpm install
cp .dev.vars.example .dev.vars   # first time only
pnpm dev                         # serves the worker at http://localhost:8787
```

The frontend defaults to `http://localhost:8787`; set `VITE_WORKER_URL` at build
time (e.g. in CI) to point the deployed site at the deployed worker.

The worker restricts CORS to known frontend origins. `keegan.ch` is always
allowed; the local Vite origins are allowed only in development. Development is
signalled by `ENVIRONMENT=development` from `.dev.vars`, which `wrangler dev`
loads automatically — the deployed worker uses the `production` value from
`wrangler.jsonc`. Re-run `pnpm cf-typegen` after changing `vars`/bindings.

## Deployment

Pushing to `main` runs `.github/workflows/deploy.yml`, which installs with pnpm,
builds the site from `frontend/`, and publishes `frontend/dist/` to GitHub
Pages. Pages is configured to deploy from **GitHub Actions** (Settings → Pages →
Build and deployment).

## License

[MIT](LICENSE) © Liam Keegan

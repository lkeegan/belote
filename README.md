# Belote

A simple online Belote game, built with TypeScript and [Vite](https://vitejs.dev/).

It works as a shared, backend-free deal aid: the four players (Sebastian, Maya,
Dadmor and Liam — partners sit diagonally) agree on a game number, each enters
it on their own device and picks their seat, and the deterministic shuffle gives
everyone a consistent deal.

- **Opening deal:** 3-then-2 packets to each player (five cards), one card
  turned up to propose trump, the rest left as the talon. You see only your own
  hand plus the public turned-up card.
- **Bidding:** done out loud in person; afterwards everyone records the outcome
  — who took the turned card, or that all four passed.
- **Completing the deal:** the taker keeps the turned card and draws two more,
  the others draw three, leaving everyone with eight cards. Trump-suit cards are
  ringed in gold. Cards use French faces (V/D/R for Valet/Dame/Roi).

Recording the same game number and taker on every device produces identical,
duplicate-free hands with no server or network.

## Live site

Deployed to GitHub Pages on every push to `main`:
https://lkeegan.github.io/belote/

## Development

This project uses [pnpm](https://pnpm.io/).

```bash
pnpm install
pnpm dev      # start the dev server
pnpm build    # type-check and build to dist/
pnpm preview  # preview the production build
```

## Deployment

Pushing to `main` runs `.github/workflows/deploy.yml`, which installs with pnpm,
builds the site, and publishes `dist/` to GitHub Pages. Pages is configured to
deploy from **GitHub Actions** (Settings → Pages → Build and deployment).

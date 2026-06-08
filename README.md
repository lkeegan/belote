# Belote

A simple online Belote game, built with TypeScript and [Vite](https://vitejs.dev/).

The current version performs a Belote opening deal from a French 32-card deck:
3-then-2 packets of cards to each of the four players, one card turned face up
to propose the trump suit, and the remaining 11 cards left as the talon. Click
**Deal** to shuffle and deal again.

## Live site

Deployed to GitHub Pages on every push to `main`:
https://lkeegan.github.io/belote/

## Development

```bash
npm install
npm run dev      # start the dev server
npm run build    # type-check and build to dist/
npm run preview  # preview the production build
```

## Deployment

Pushing to `main` runs `.github/workflows/deploy.yml`, which builds the site and
publishes `dist/` to GitHub Pages.

**One-time setup:** in the repository settings, under **Settings → Pages → Build
and deployment**, set the **Source** to **GitHub Actions**.

# CLAUDE.md

A static, phone-first page that turns a month's balances and quotes into the orders that bring a small ETF portfolio back to its target allocation. Hosted on GitHub Pages from `main`.

## This repo is public

Nothing that identifies the owner or the person using the app goes in any file, commit message, branch name, issue or PR: no names, no brokerage or bank names, no fund tickers tied to a real account, no balances, share counts, prices from a real account, account numbers, or emails. Tickers and targets are entered at runtime in Settings and kept in localStorage, never hard-coded. Test and example figures are invented.

`scripts/privacy-check.sh` enforces this against a gitignored `.private-terms` list, via the hooks in `.githooks/`. After a fresh clone:

```sh
git config core.hooksPath .githooks
git config user.email "<id>+<user>@users.noreply.github.com"
```

and recreate `.private-terms` (one term per line). Never commit it, never paste its contents anywhere in the repo, and never bypass the hooks with `--no-verify`.

## Layout

- `rebalance.js` — pure planning math, integer cents throughout. No DOM. All rules live here.
- `app.js` — UI: rendering, input parsing, localStorage.
- `manifest.webmanifest`, `icons/` — home-screen install. New site files must also be added to the copy step in the Pages workflow.
- `index.html`, `styles.css` — single page, one column, 16px inputs (iOS zoom), light and dark.
- `test/rebalance.test.js` — `node --test`.

## The rules the math implements

1. **Buffer.** Money market value `T` vs target `B`. Under target: top up from cash first (all cash if it can't cover it, and nothing is invested). Over `B + deadband`: sell the excess and invest it. Otherwise leave it.
2. **Allocate** the deployable cash `D`. Holdings are valued at the bid. `P = holdings + D`; raw gap = `target × P − holding`. If any gap is negative, zero it and split `D` pro rata over the positive gaps.
3. **Shares** = `floor(allocation ÷ ask)`; the buy limit is the ask. No greedy top-up of leftovers: the remainder goes to the money market after fills and is recaptured next month by rule 1.
4. **Drift band** = `min(bandPoints, bandRelative × target)`. If any fund's post-buy weight is outside it, offer an optional full rebalance: sell whole shares of overweight funds at the bid, then rule 2 and 3 on the proceeds plus `D`.

Changing any rule is a product decision; confirm with the repo owner first.

## Storage

Saved in localStorage: settings and the last share counts (with an as-of date, shown as a prefill the user must confirm). Never saved: cash, money market value, bids, asks. The app is meant to be added to an iPhone home screen (`manifest.webmanifest`, `apple-mobile-web-app-capable`); a home-screen web app has its own storage container separate from Safari, so settings are entered inside the installed app. Don't reintroduce URL-based settings for that reason.

## Commands

- `npm test` — unit tests
- `npm run serve` — local server on :8000 (ES modules don't load from `file://`)

CI (`.github/workflows/pages.yml`) runs the tests and deploys to Pages on every push to `main`.

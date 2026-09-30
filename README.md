# ETF Rebalancer

A small phone-friendly page for a monthly contribution routine: enter your uninvested cash, your money market buffer, your share counts, and each fund's bid and ask, and it lists the orders to place, in order, to bring the portfolio back toward its target allocation.

- Tops up or trims a money market buffer to a target, with a deadband.
- Buys toward target with new money only, never selling by default.
- Sizes whole-share limit orders at the ask so no order can cost more than its allocation.
- Flags drift outside a band (the tighter of ±N points or ±M% of target) and offers an optional full rebalance with sells.

Everything runs in the browser. Settings and share counts are stored in `localStorage` on your device; balances and quotes are never stored or sent anywhere.

Not financial advice. Check every order before you place it.

## Development

```sh
npm test
npm run serve   # http://localhost:8000
```

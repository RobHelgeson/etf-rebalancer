// Pure planning math. All money is in integer cents so that share counts and
// remainders never drift by a fraction of a cent from floating-point error.

export const toCents = (dollars) => Math.round(Number(dollars) * 100);
export const toDollars = (cents) => cents / 100;

const sum = (xs) => xs.reduce((a, b) => a + b, 0);

export function reconcileBuffer(cash, mmValue, target, deadband) {
  if (mmValue < target) {
    const shortfall = target - mmValue;
    if (cash <= shortfall) {
      return { action: 'buy', amount: cash, deployable: 0, unmet: shortfall - cash };
    }
    return { action: 'buy', amount: shortfall, deployable: cash - shortfall, unmet: 0 };
  }
  if (mmValue > target + deadband) {
    const excess = mmValue - target;
    return { action: 'sell', amount: excess, deployable: cash + excess, unmet: 0 };
  }
  return { action: 'none', amount: 0, deployable: cash, unmet: 0 };
}

// Raw targets always sum to the deposit, because P includes it. When a sleeve is
// already over target its raw value is negative; spending the positive raws as-is
// would overshoot the deposit by that amount, so the deposit is split in
// proportion to the positive raws instead.
export function allocate(values, weights, deposit) {
  const total = sum(values) + deposit;
  const raw = weights.map((w, i) => w * total - values[i]);
  if (raw.every((r) => r >= 0)) return raw;
  const positive = sum(raw.filter((r) => r > 0));
  if (positive <= 0) return raw.map(() => 0);
  return raw.map((r) => (r > 0 ? (deposit * r) / positive : 0));
}

// Sized at the limit price, so a worst-case fill can never cost more than the
// allocation. The epsilon keeps an exact multiple from flooring one share short.
export const wholeShares = (amount, price) =>
  amount <= 0 || price <= 0 ? 0 : Math.floor(amount / price + 1e-9);

export function driftBand(weight, points, relative) {
  return Math.min(points / 100, relative * weight);
}

function weightsOf(values) {
  const total = sum(values);
  return values.map((v) => (total > 0 ? v / total : 0));
}

function buyOrders(funds, values, cash) {
  const allocations = allocate(values, funds.map((f) => f.weight), cash);
  return funds.map((f, i) => {
    const shares = wholeShares(allocations[i], f.ask);
    return { ticker: f.ticker, allocation: allocations[i], shares, limit: f.ask, cost: shares * f.ask };
  });
}

// funds: [{ ticker, weight (0-1), shares, bid, ask }] with prices in cents.
// Holdings are valued at the bid: that is what they would actually sell for.
export function planMonth({ cash, mmValue, funds }, settings) {
  const buffer = reconcileBuffer(cash, mmValue, settings.buffer, settings.deadband);
  const deposit = buffer.deployable;
  const values = funds.map((f) => f.shares * f.bid);
  const total = sum(values) + deposit;

  const buys = buyOrders(funds, values, deposit);
  const spent = sum(buys.map((b) => b.cost));
  const afterValues = values.map((v, i) => v + buys[i].shares * funds[i].bid);

  const before = weightsOf(values);
  const after = weightsOf(afterValues);
  const drift = funds.map((f, i) => {
    const band = driftBand(f.weight, settings.bandPoints, settings.bandRelative);
    return {
      ticker: f.ticker,
      target: f.weight,
      before: before[i],
      after: after[i],
      band,
      flagged: Math.abs(after[i] - f.weight) > band,
    };
  });

  const plan = {
    buffer,
    deposit,
    values,
    total,
    buys,
    remainder: deposit - spent,
    drift,
    rebalance: null,
  };
  if (drift.some((d) => d.flagged)) plan.rebalance = fullRebalance(funds, values, deposit, total);
  return plan;
}

function fullRebalance(funds, values, deposit, total) {
  const sells = funds.map((f, i) => {
    const over = values[i] - f.weight * total;
    const shares = over > 0 ? wholeShares(over, f.bid) : 0;
    return { ticker: f.ticker, shares, limit: f.bid, proceeds: shares * f.bid };
  });
  const cash = deposit + sum(sells.map((s) => s.proceeds));
  const heldValues = values.map((v, i) => v - sells[i].proceeds);
  const buys = buyOrders(funds, heldValues, cash);
  const afterValues = heldValues.map((v, i) => v + buys[i].shares * funds[i].bid);
  return {
    sells,
    buys,
    cash,
    remainder: cash - sum(buys.map((b) => b.cost)),
    after: weightsOf(afterValues),
  };
}

export function validateSettings(settings) {
  const errors = [];
  if (!settings.funds.length) errors.push('Add at least one fund.');
  const tickers = settings.funds.map((f) => f.ticker.trim().toUpperCase());
  if (tickers.some((t) => !t)) errors.push('Every fund needs a ticker.');
  if (new Set(tickers).size !== tickers.length) errors.push('Tickers must be unique.');
  const pct = sum(settings.funds.map((f) => Number(f.target)));
  if (Math.abs(pct - 100) > 0.001) errors.push(`Targets add up to ${pct}%, they need to add up to 100%.`);
  if (!(settings.buffer >= 0)) errors.push('Buffer target must be zero or more.');
  if (!(settings.deadband >= 0)) errors.push('Deadband must be zero or more.');
  return errors;
}

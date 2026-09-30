import { planMonth, toCents, validateSettings } from './rebalance.js';

const SETTINGS_KEY = 'rebalancer.settings.v1';
const HOLDINGS_KEY = 'rebalancer.holdings.v1';
const MAX_FUNDS = 5;
const WIDE_SPREAD = 0.005;

const DEFAULT_SETTINGS = {
  mmName: 'Money market',
  buffer: 0,
  deadband: 100,
  cutoff: '',
  bandPoints: 5,
  bandRelative: 25,
  funds: [],
};

const $ = (id) => document.getElementById(id);
const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const money = (cents) => usd.format(cents / 100);
const pct = (x) => `${(x * 100).toFixed(1)}%`;
const parseNumber = (s) => {
  const cleaned = String(s ?? '').replace(/[$,\s]/g, '');
  return cleaned === '' ? NaN : Number(cleaned);
};
const cleanTicker = (t) => String(t ?? '').toUpperCase().replace(/[^A-Z0-9.]/g, '').slice(0, 10);

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k === 'style') node.style.cssText = v;
    else node.setAttribute(k, v);
  }
  for (const c of children.flat()) if (c != null) node.append(c);
  return node;
}

function load(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}
const save = (key, value) => localStorage.setItem(key, JSON.stringify(value));

function normalizeSettings(s) {
  const n = { ...DEFAULT_SETTINGS, ...s };
  n.mmName = String(n.mmName || DEFAULT_SETTINGS.mmName).slice(0, 40);
  n.funds = (Array.isArray(n.funds) ? n.funds : [])
    .slice(0, MAX_FUNDS)
    .map((f) => ({ ticker: cleanTicker(f.ticker), target: Number(f.target) }));
  for (const k of ['buffer', 'deadband', 'bandPoints', 'bandRelative']) n[k] = Number(n[k]);
  n.cutoff = /^\d{2}:\d{2}$/.test(n.cutoff) ? n.cutoff : '';
  return n;
}

let settings = normalizeSettings(load(SETTINGS_KEY, DEFAULT_SETTINGS));
let lastRun = null;

function toast(message) {
  const t = $('toast');
  t.textContent = message;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (t.hidden = true), 2500);
}

function easternNow() {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
      .formatToParts(new Date())
      .map((p) => [p.type, p.value]),
  );
  return {
    weekday: parts.weekday,
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
    clock: `${parts.hour}:${parts.minute}`,
    date: `${parts.year}-${parts.month}-${parts.day}`,
  };
}
const toMinutes = (hhmm) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};
const clock12 = (hhmm) => {
  const [h, m] = hhmm.split(':').map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')}${h < 12 ? 'am' : 'pm'}`;
};

// ---------- inputs ----------

function renderInputs() {
  const configured = settings.funds.length > 0 && validateSettings(settings).length === 0;
  $('needs-setup').hidden = configured;
  $('inputs').hidden = !configured;
  $('mm-label').textContent = `${settings.mmName} value`;
  $('settings').open = !configured;

  const holdings = load(HOLDINGS_KEY, null);
  const prefilled = holdings && settings.funds.some((f) => holdings.shares?.[f.ticker] != null);
  const box = $('funds');
  box.replaceChildren(
    ...settings.funds.map((f) =>
      el(
        'fieldset',
        { class: 'fund' },
        el('legend', {}, el('strong', {}, f.ticker), el('span', { class: 'muted' }, ` target ${f.target}%`)),
        el(
          'label',
          {},
          'Shares held',
          el('input', {
            id: `shares-${f.ticker}`,
            inputmode: 'numeric',
            autocomplete: 'off',
            placeholder: '0',
            value: prefilled ? String(holdings.shares[f.ticker] ?? '') : '',
          }),
        ),
        el(
          'div',
          { class: 'row two' },
          el('label', {}, 'Bid', el('input', { id: `bid-${f.ticker}`, inputmode: 'decimal', autocomplete: 'off', placeholder: '$0.00' })),
          el('label', {}, 'Ask', el('input', { id: `ask-${f.ticker}`, inputmode: 'decimal', autocomplete: 'off', placeholder: '$0.00' })),
        ),
      ),
    ),
  );
  $('asof').hidden = !prefilled;
  $('confirm-wrap').hidden = !prefilled;
  $('confirm-shares').checked = false;
  if (prefilled) $('asof').textContent = `Share counts filled in from ${holdings.asOf}. They change whenever you trade or dividends reinvest.`;
}

function readInputs() {
  const errors = [];
  const cash = parseNumber($('cash').value);
  const mm = parseNumber($('mm').value);
  if (!(cash >= 0)) errors.push('Enter the cash available (0 if none).');
  if (!(mm >= 0)) errors.push(`Enter the ${settings.mmName} value (0 if none).`);
  const funds = settings.funds.map((f) => {
    const shares = parseNumber($(`shares-${f.ticker}`).value);
    const bid = parseNumber($(`bid-${f.ticker}`).value);
    const ask = parseNumber($(`ask-${f.ticker}`).value);
    if (!(Number.isInteger(shares) && shares >= 0)) errors.push(`${f.ticker}: shares must be a whole number.`);
    if (!(bid > 0) || !(ask > 0)) errors.push(`${f.ticker}: enter both bid and ask.`);
    else if (ask < bid) errors.push(`${f.ticker}: the ask is lower than the bid. Check the quote.`);
    return { ticker: f.ticker, weight: f.target / 100, shares, bid: toCents(bid), ask: toCents(ask) };
  });
  if (!$('confirm-wrap').hidden && !$('confirm-shares').checked) errors.push('Tick the box once you have checked the share counts.');
  return { errors, input: { cash: toCents(cash), mmValue: toCents(mm), funds } };
}

// ---------- plan rendering ----------

function stepItem(main, detail) {
  return el(
    'li',
    {},
    el('label', { class: 'check' }, el('input', { type: 'checkbox' }), el('span', {}, el('strong', {}, main), detail ? el('span', { class: 'hint' }, detail) : null)),
  );
}

function bufferStep(buffer) {
  if (buffer.action === 'buy') {
    return stepItem(
      `Buy ${money(buffer.amount)} of ${settings.mmName}`,
      buffer.unmet > 0
        ? `That is all the cash, and the buffer is still ${money(buffer.unmet)} under target, so there is nothing to invest this month.`
        : `Tops the buffer back up to ${money(toCents(settings.buffer))}.`,
    );
  }
  if (buffer.action === 'sell') {
    const cutoff = settings.cutoff ? ` Enter it before ${clock12(settings.cutoff)} ET so the cash is available today.` : '';
    return stepItem(`Sell ${money(buffer.amount)} of ${settings.mmName}`, `Brings the buffer down to ${money(toCents(settings.buffer))}; the excess gets invested.${cutoff}`);
  }
  return null;
}

function buySteps(buys) {
  const steps = [];
  for (const b of buys) {
    if (b.shares > 0) {
      steps.push(stepItem(`Buy ${b.shares} ${b.ticker} at limit ${money(b.limit)}`, `Day limit order, set at the ask. About ${money(b.cost)}.`));
    }
  }
  const skipped = buys.filter((b) => b.shares === 0 && b.allocation > 0);
  return { steps, skipped };
}

function remainderStep(remainder) {
  if (remainder <= 0) return null;
  return stepItem(
    `After every order shows filled, buy the leftover cash in ${settings.mmName}`,
    `About ${money(remainder)}. Use the actual cash balance, since fills can come in a little better than the limit.`,
  );
}

function skippedNote(skipped) {
  if (!skipped.length) return null;
  return el(
    'li',
    { class: 'note' },
    skipped.map((b) => `No ${b.ticker} this month: its ${money(Math.round(b.allocation))} share is less than one share. `).join(''),
    'That cash goes to the buffer and comes back next month.',
  );
}

function renderSteps(list, plan) {
  const items = [bufferStep(plan.buffer)];
  const { steps, skipped } = buySteps(plan.buys);
  items.push(...steps, skippedNote(skipped), remainderStep(plan.remainder));
  const real = items.filter(Boolean);
  const empty = plan.rebalance ? 'No cash to invest this month, so there is nothing to buy.' : 'Nothing to do this month. Everything is on target and there is no cash to invest.';
  list.replaceChildren(...(real.length ? real : [el('li', { class: 'note' }, empty)]));
}

function renderRebalanceSteps(list, plan) {
  const r = plan.rebalance;
  const items = [bufferStep(plan.buffer)];
  for (const s of r.sells) {
    if (s.shares > 0) items.push(stepItem(`Sell ${s.shares} ${s.ticker} at limit ${money(s.limit)}`, `Day limit order, set at the bid. About ${money(s.proceeds)}.`));
  }
  const { steps, skipped } = buySteps(r.buys);
  items.push(...steps, skippedNote(skipped), remainderStep(r.remainder));
  list.replaceChildren(...items.filter(Boolean));
}

function chart(rows) {
  const tickers = settings.funds.map((f) => f.ticker);
  const bars = rows.map(([label, weights]) =>
    el(
      'div',
      { class: 'bar-row' },
      el('span', { class: 'bar-label' }, label),
      el(
        'div',
        { class: 'bar', role: 'img', 'aria-label': `${label}: ${tickers.map((t, i) => `${t} ${pct(weights[i])}`).join(', ')}` },
        weights.map((w, i) =>
          w > 0 ? el('span', { class: `seg s${i + 1}`, style: `flex-grow:${w}`, title: `${tickers[i]} ${pct(w)}` }) : null,
        ),
      ),
    ),
  );
  const legend = el(
    'div',
    { class: 'legend' },
    tickers.map((t, i) => el('span', {}, el('span', { class: `swatch s${i + 1}` }), t)),
  );
  const table = el(
    'table',
    {},
    el('thead', {}, el('tr', {}, el('th', {}, 'Fund'), rows.map(([label]) => el('th', {}, label)))),
    el(
      'tbody',
      {},
      tickers.map((t, i) => el('tr', {}, el('th', {}, t), rows.map(([, w]) => el('td', {}, pct(w[i]))))),
    ),
  );
  return [legend, ...bars, table];
}

function renderMath(plan) {
  const lines = [];
  const b = plan.buffer;
  const cashLine = `Buffer target ${money(toCents(settings.buffer))}, deadband ${money(toCents(settings.deadband))}.`;
  if (b.action === 'buy') lines.push(`${cashLine} The buffer is under target, so ${money(b.amount)} of cash goes to it first.`);
  else if (b.action === 'sell') lines.push(`${cashLine} The buffer is more than the deadband over target, so the ${money(b.amount)} excess is added to the cash.`);
  else lines.push(`${cashLine} The buffer is within the deadband, so it is left alone.`);
  lines.push(`Amount to invest D = ${money(plan.deposit)}.`);
  lines.push(`Holdings at the bid: ${plan.buys.map((x, i) => `${x.ticker} ${money(plan.values[i])}`).join(', ')}.`);
  lines.push(`Portfolio after investing P = holdings + D = ${money(plan.total)}.`);
  lines.push(
    `Each fund's gap = target % × P − its holding. Any fund already over target gets 0, and D is split across the rest in proportion to their gaps: ${plan.buys
      .map((x) => `${x.ticker} ${money(Math.round(x.allocation))}`)
      .join(', ')}.`,
  );
  lines.push(`Shares = allocation ÷ limit price, rounded down, so an order can never cost more than its allocation.`);
  lines.push(`Leftover = D − the cost of the buys = ${money(plan.remainder)}, which goes to the buffer.`);
  $('math').replaceChildren(...lines.map((l) => el('p', {}, l)));
}

function renderWarnings(input, plan) {
  const now = easternNow();
  const warnings = [];
  if (now.weekday === 'Sat' || now.weekday === 'Sun') warnings.push('The market is closed today. Quotes are from the last close; get fresh ones on a weekday before placing orders.');
  else if (now.minutes < toMinutes('10:00') || now.minutes > toMinutes('15:30'))
    warnings.push(`It is ${clock12(now.clock)} ET. Spreads are tightest between 10:00am and 3:30pm ET; outside that window, check the quotes again before you trade.`);
  if (plan.buffer.action === 'sell' && settings.cutoff && now.minutes > toMinutes(settings.cutoff))
    warnings.push(`It is past the ${clock12(settings.cutoff)} ET cutoff, so the ${settings.mmName} sale will not settle until the next business day. Sell it today and place the fund buys tomorrow.`);
  for (const f of input.funds) {
    if ((f.ask - f.bid) / f.ask > WIDE_SPREAD) warnings.push(`${f.ticker}'s spread is wide (${money(f.ask - f.bid)}). Refresh the quote or wait a few minutes.`);
  }
  $('warnings').replaceChildren(...warnings.map((w) => el('p', { class: 'card warning' }, w)));
}

function logText(input, plan, rebalance) {
  const now = easternNow();
  const out = [`Rebalance ${now.date} ${now.clock} ET${rebalance ? ' (full rebalance)' : ''}`];
  out.push(`Cash ${money(input.cash)}; ${settings.mmName} ${money(input.mmValue)}`);
  if (plan.buffer.action !== 'none') out.push(`${settings.mmName}: ${plan.buffer.action} ${money(plan.buffer.amount)}`);
  if (rebalance) for (const s of plan.rebalance.sells) if (s.shares) out.push(`Sell ${s.shares} ${s.ticker} @ ${money(s.limit)} ≈ ${money(s.proceeds)}`);
  const buys = rebalance ? plan.rebalance.buys : plan.buys;
  for (const b of buys) if (b.shares) out.push(`Buy ${b.shares} ${b.ticker} @ ${money(b.limit)} ≈ ${money(b.cost)}`);
  out.push(`Leftover to ${settings.mmName} ≈ ${money(rebalance ? plan.rebalance.remainder : plan.remainder)}`);
  const after = rebalance ? plan.rebalance.after : plan.drift.map((d) => d.after);
  out.push(`After: ${settings.funds.map((f, i) => `${f.ticker} ${pct(after[i])}`).join(' / ')}`);
  return out.join('\n');
}

async function copy(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast('Copied');
  } catch {
    window.prompt('Copy this:', text);
  }
}

function saveShares(input, sells, buys) {
  const shares = {};
  input.funds.forEach((f, i) => {
    shares[f.ticker] = f.shares - (sells?.[i]?.shares ?? 0) + buys[i].shares;
  });
  save(HOLDINGS_KEY, { asOf: easternNow().date, shares });
  toast('Share counts saved for next month');
}

function onBuild(event) {
  event.preventDefault();
  const { errors, input } = readInputs();
  $('form-errors').textContent = errors.join(' ');
  if (errors.length) {
    $('result').hidden = true;
    return;
  }
  const plan = planMonth(input, {
    buffer: toCents(settings.buffer),
    deadband: toCents(settings.deadband),
    bandPoints: settings.bandPoints,
    bandRelative: settings.bandRelative / 100,
  });
  lastRun = { input, plan };

  renderWarnings(input, plan);
  renderSteps($('steps'), plan);
  $('chart-main').replaceChildren(
    ...chart([
      ['Target', settings.funds.map((f) => f.target / 100)],
      ['Now', plan.drift.map((d) => d.before)],
      ['After', plan.drift.map((d) => d.after)],
    ]),
  );

  $('rebalance').hidden = !plan.rebalance;
  if (plan.rebalance) {
    const flagged = plan.drift.filter((d) => d.flagged);
    $('drift-summary').textContent = `After this month's buys, ${flagged
      .map((d) => `${d.ticker} is at ${pct(d.after)} against a ${pct(d.target)} target (band ±${(d.band * 100).toFixed(1)} points)`)
      .join('; ')}. Buying alone can't close that gap. The plan above is still fine to place; a full rebalance is optional.`;
    renderRebalanceSteps($('steps-rebalance'), plan);
    $('chart-rebalance').replaceChildren(
      ...chart([
        ['Target', settings.funds.map((f) => f.target / 100)],
        ['After', plan.rebalance.after],
      ]),
    );
  }
  renderMath(plan);
  $('result').hidden = false;
  $('result').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ---------- settings ----------

function fundRow(f = { ticker: '', target: '' }) {
  const row = el(
    'div',
    { class: 'row fund-row' },
    el('label', {}, 'Ticker', el('input', { class: 's-ticker', autocomplete: 'off', autocapitalize: 'characters', value: f.ticker })),
    el('label', {}, 'Target %', el('input', { class: 's-target', inputmode: 'decimal', autocomplete: 'off', value: String(f.target) })),
    el('button', { type: 'button', class: 'remove', 'aria-label': 'Remove fund' }, '✕'),
  );
  row.querySelector('.remove').addEventListener('click', () => row.remove());
  return row;
}

function renderSettings() {
  $('s-mm-name').value = settings.mmName;
  $('s-buffer').value = settings.buffer;
  $('s-deadband').value = settings.deadband;
  $('s-cutoff').value = settings.cutoff;
  $('s-band-points').value = settings.bandPoints;
  $('s-band-relative').value = settings.bandRelative;
  $('s-funds').replaceChildren(...settings.funds.map(fundRow));
}

function readSettings() {
  return normalizeSettings({
    mmName: $('s-mm-name').value.trim(),
    buffer: parseNumber($('s-buffer').value),
    deadband: parseNumber($('s-deadband').value),
    cutoff: $('s-cutoff').value,
    bandPoints: parseNumber($('s-band-points').value),
    bandRelative: parseNumber($('s-band-relative').value),
    funds: [...document.querySelectorAll('.fund-row')].map((r) => ({
      ticker: r.querySelector('.s-ticker').value,
      target: parseNumber(r.querySelector('.s-target').value),
    })),
  });
}

function applySettings(next) {
  settings = next;
  save(SETTINGS_KEY, settings);
  renderSettings();
  renderInputs();
  $('result').hidden = true;
}

function settingsErrors(s) {
  const errors = validateSettings(s);
  if (!(s.bandPoints > 0) || !(s.bandRelative > 0)) errors.push('Drift band values must be above zero.');
  return errors;
}

function onSaveSettings(event) {
  event.preventDefault();
  const next = readSettings();
  const errors = settingsErrors(next);
  $('settings-errors').textContent = errors.join(' ');
  if (errors.length) return;
  applySettings(next);
  toast('Settings saved');
}

const encode = (obj) => btoa(unescape(encodeURIComponent(JSON.stringify(obj)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const decode = (s) => JSON.parse(decodeURIComponent(escape(atob(s.replace(/-/g, '+').replace(/_/g, '/')))));

function checkSetupLink() {
  const match = location.hash.match(/^#setup=([A-Za-z0-9_-]+)$/);
  if (!match) return;
  history.replaceState(null, '', location.pathname + location.search);
  let incoming;
  try {
    incoming = normalizeSettings(decode(match[1]));
  } catch {
    toast('That setup link is damaged.');
    return;
  }
  if (settingsErrors(incoming).length) {
    toast('That setup link has invalid settings.');
    return;
  }
  $('setup-link-summary').textContent = `${incoming.funds.map((f) => `${f.ticker} ${f.target}%`).join(', ')}; ${incoming.mmName} buffer ${usd.format(incoming.buffer)}. This replaces your current settings. Share counts are kept.`;
  $('setup-link').hidden = false;
  $('setup-apply').onclick = () => {
    applySettings(incoming);
    $('setup-link').hidden = true;
    toast('Settings applied');
  };
  $('setup-ignore').onclick = () => ($('setup-link').hidden = true);
}

function init() {
  renderSettings();
  renderInputs();
  checkSetupLink();

  $('inputs').addEventListener('submit', onBuild);
  $('settings-form').addEventListener('submit', onSaveSettings);
  $('s-add-fund').addEventListener('click', () => {
    if (document.querySelectorAll('.fund-row').length >= MAX_FUNDS) return toast(`Up to ${MAX_FUNDS} funds.`);
    $('s-funds').append(fundRow());
  });
  $('s-share').addEventListener('click', () => {
    const current = readSettings();
    const errors = settingsErrors(current);
    if (errors.length) return ($('settings-errors').textContent = errors.join(' '));
    copy(`${location.origin}${location.pathname}#setup=${encode(current)}`);
  });
  $('s-clear').addEventListener('click', () => {
    if (!confirm('Erase saved settings and share counts from this device?')) return;
    localStorage.removeItem(SETTINGS_KEY);
    localStorage.removeItem(HOLDINGS_KEY);
    applySettings(normalizeSettings(DEFAULT_SETTINGS));
  });
  $('copy-main').addEventListener('click', () => lastRun && copy(logText(lastRun.input, lastRun.plan, false)));
  $('copy-rebalance').addEventListener('click', () => lastRun && copy(logText(lastRun.input, lastRun.plan, true)));
  $('save-main').addEventListener('click', () => lastRun && saveShares(lastRun.input, null, lastRun.plan.buys));
  $('save-rebalance').addEventListener(
    'click',
    () => lastRun && saveShares(lastRun.input, lastRun.plan.rebalance.sells, lastRun.plan.rebalance.buys),
  );
}

init();

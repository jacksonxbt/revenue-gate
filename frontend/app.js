import {getLaunchState, requestReport, simulatePayment} from './adapter.js';
import {liveConfig, isConfigured, createLiveAdapter, testnetAmount, safeSource, validHash} from './live.js';

const view = document.querySelector('#view');
const notice = document.querySelector('#notice');
const api = createLiveAdapter();
const ROUTES = ['discover', 'research', 'launch'];
const SCAN = 'https://testnet.bscscan.com';
const VERDICT = {
  eligible: ['Counted', 'Counts toward the gate'],
  flagged: ['Not counted', 'Does not count toward the gate'],
  uncertain: ['Uncertain', 'Uncertain'],
  pending: ['Checking', 'Still being checked'],
};

const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const short = v => (v.length > 18 ? v.slice(0, 8) + '…' + v.slice(-6) : v);
const num = n => n.toLocaleString('en-US');
const tbnb = n => n.toFixed(2) + ' tBNB';
const isAddress = v => /^0x[0-9a-f]{40}$/i.test(v || '');
const txLink = h => `<a class="mono" href="${SCAN}/tx/${h}" target="_blank" rel="noopener noreferrer" title="${h}">${short(h)}</a>`;
const tag = (verdict, long) => `<span class="tag ${VERDICT[verdict] ? verdict : 'pending'}">${(VERDICT[verdict] || VERDICT.pending)[long ? 1 : 0]}</span>`;
const blankResearch = () => ({manual: false, note: '', asset: '', hash: '', quote: null, payment: null, report: null, busy: '', error: ''});

const state = {mode: isConfigured(liveConfig) ? 'live' : 'demo', gate: null, gateBusy: false, gateError: '', r: blankResearch()};
let demoReport = null;

function friendly(err) {
  if (err?.code === 4001) return 'You cancelled the payment in MetaMask. Nothing was sent.';
  if (err?.name === 'TimeoutError' || err?.name === 'AbortError') return 'The server took too long to answer. Try again.';
  if (err instanceof TypeError) return "Couldn't reach the Revenue Gate server. Check your connection and try again.";
  return err?.message || 'Something went wrong. Try again.';
}

/* Data sources: both modes return the same shapes. */
const demo = {
  async gate() {
    const s = getLaunchState();
    return {
      pct: Math.min(100, (s.revenue / s.target) * 100), open: s.eligible,
      now: tbnb(s.revenue) + ' counted', goal: 'Opens at ' + tbnb(s.target),
      counted: s.eligibleCount, flagged: s.payments.length - s.eligibleCount, revenue: tbnb(s.revenue),
      source: 'Illustrative records. Demo mode reads no contract and sends nothing.',
      payments: s.payments.map(p => ({
        ref: `<span class="mono">${esc(p.id)}</span>`, amount: tbnb(p.amount),
        verdict: p.assessment.includes('flagged') ? 'flagged' : 'eligible',
        reason: `Illustrative payment for a ${p.asset} report`,
      })),
    };
  },
  async quote(asset) {
    const raw = requestReport(asset);
    return {asset: raw.asset, amount: tbnb(raw.amount), raw};
  },
  async pay(quote) {
    const out = simulatePayment(quote.raw);
    demoReport = out.report;
    return {status: 'confirmed', verdict: 'eligible', ref: `<span class="mono">${esc(out.payment.id)}</span>`, reason: 'Simulated payment. No wallet was checked and nothing was sent.'};
  },
  async report() { return demoReport; },
};

const live = {
  async gate() {
    const l = await api.launch();
    const p = l.onChainProgress;
    const onChain = Boolean(p) && ['totalWeightedScore', 'graduationThreshold', 'eligiblePayments', 'flaggedPayments'].every(k => Number.isFinite(p[k]));
    const pct = onChain
      ? (p.graduationThreshold > 0 ? (p.totalWeightedScore / p.graduationThreshold) * 100 : 0)
      : Number((BigInt(l.revenueWei) * 10000n) / BigInt(l.targetWei)) / 100;
    const contract = isAddress(l.contractAddress) ? l.contractAddress : null;
    const contractLink = contract ? `<a class="mono" href="${SCAN}/address/${contract}" target="_blank" rel="noopener noreferrer" title="${contract}">${short(contract)}</a>` : '';
    return {
      pct: Math.min(100, pct), open: l.eligible,
      now: onChain ? `Score ${num(p.totalWeightedScore)}` : testnetAmount(l.revenueWei) + ' counted',
      goal: onChain ? `Opens at ${num(p.graduationThreshold)}` : 'Opens at ' + testnetAmount(l.targetWei),
      counted: onChain ? p.eligiblePayments : l.payments.filter(x => x.assessment === 'eligible').length,
      flagged: onChain ? p.flaggedPayments : l.payments.filter(x => x.assessment === 'flagged').length,
      revenue: testnetAmount(l.revenueWei), onChain, openfour: openFourView(l.openfour),
      source: onChain && contract
        ? `Read from gate contract ${contractLink} on BNB testnet. Each counted payment adds its wallet score, from 60 to 100.${l.openfour ? ' OpenFour checks this contract before it graduates the token below.' : ''}`
        : 'Calculated by the Revenue Gate server. The gate contract could not be read.',
      payments: l.payments.map(x => ({ref: txLink(x.txHash), amount: testnetAmount(x.amountWei), verdict: x.assessment, reason: x.reason || '', score: Number.isFinite(x.confidence) ? x.confidence : null})),
    };
  },
  async quote(asset) {
    const q = await api.quote(asset);
    return {asset: q.asset, amount: testnetAmount(q.amountWei), amountWei: q.amountWei, recipient: q.recipient, expiresAt: q.expiresAt, requestId: q.requestId};
  },
  async pay(quote, hash) {
    const p = await api.payment(quote.requestId, hash);
    return {status: p.status, verdict: p.assessment, ref: txLink(p.txHash), reason: p.reason || '', score: Number.isFinite(p.confidence) ? p.confidence : null, gateTx: validHash(p.onChainTx) ? p.onChainTx : null};
  },
  async report(quote) {
    const r = await api.report(quote.requestId);
    if (r.status === 'pending') throw new Error('The report is still being written. Try again in a few seconds.');
    if (r.status !== 'ready') throw new Error("The report couldn't be written. Try again.");
    return r;
  },
};
// Validates the OpenFour block from the API before it is shown.
function openFourView(o) {
  if (!o || !isAddress(o.token) || !isAddress(o.core) || !isAddress(o.migrateModule)) return null;
  if (typeof o.canGraduate !== 'boolean' || typeof o.saleConditionMet !== 'boolean' || typeof o.gateOpen !== 'boolean') return null;
  const addr = a => `<a class="mono" href="${SCAN}/address/${a}" target="_blank" rel="noopener noreferrer" title="${a}">${short(a)}</a>`;
  return {
    name: String(o.name || ''), symbol: String(o.symbol || ''), preset: String(o.presetName || ''), network: String(o.network || ''),
    phase: String(o.phase || ''), reason: String(o.reason || ''), tag: String(o.migrateTag || ''),
    raised: testnetAmount(o.raisedWei), softCap: testnetAmount(o.softCapWei),
    saleMet: o.saleConditionMet, gateOpen: o.gateOpen, canGraduate: o.canGraduate,
    tokenLink: addr(o.token), coreLink: addr(o.core), moduleLink: addr(o.migrateModule),
    buyLink: validHash(o.buyTx) ? txLink(o.buyTx) : '',
  };
}

function openFourPanel(o) {
  const mark = ok => `<span class="tag ${ok ? 'eligible' : 'flagged'}">${ok ? 'Met' : 'Not met'}</span>`;
  return `<section class="of"><div class="wrap">
    <div class="of-head"><div><h2>${esc(o.name)} (${esc(o.symbol)}) on OpenFour</h2>
      <p class="ledger-note">A real token launched through OpenFour with the ${esc(o.preset)} preset. OpenFour asks our module before it graduates the token.</p></div>
      <span class="tag ${o.canGraduate ? 'eligible' : 'flagged'} of-state">${o.canGraduate ? 'Can graduate' : 'Graduation blocked'}</span></div>
    <ol class="of-checks">
      <li><div><h3>Sale condition</h3><p>${esc(o.raised)} raised. The soft cap is ${esc(o.softCap)}.</p></div>${mark(o.saleMet)}</li>
      <li><div><h3>Revenue Gate</h3><p>Counted product payments must reach the gate threshold.</p></div>${mark(o.gateOpen)}</li>
      <li><div><h3>OpenFour's answer</h3><p>${o.canGraduate ? 'The module tells OpenFour Core the token can graduate.' : `The module tells OpenFour Core: “${esc(o.reason)}”.`} Token phase: ${esc(o.phase)}.</p></div></li>
    </ol>
    <dl class="of-facts">
      <div><dt>Token</dt><dd>${o.tokenLink}</dd></div>
      <div><dt>OpenFour Core</dt><dd>${o.coreLink}</dd></div>
      <div><dt>Migrate module (${esc(o.tag)})</dt><dd>${o.moduleLink}</dd></div>
      ${o.buyLink ? `<div><dt>Buy that passed the soft cap</dt><dd>${o.buyLink}</dd></div>` : ''}
    </dl>
    <p class="ledger-note">${esc(o.network)}. Not listed on the official OpenFour registry.</p>
  </div></section>`;
}

const src = () => (state.mode === 'live' ? live : demo);

/* Views */
function gateBand() {
  const g = state.gate;
  if (!g) {
    return `<section class="gate" aria-labelledby="gate-h"><div class="wrap">
      <div class="gate-head"><h2 id="gate-h">The gate</h2></div>
      ${state.gateError
        ? `<div class="gate-empty"><p role="alert">${esc(state.gateError)}</p><button class="btn" data-action="refresh">Try again</button></div>`
        : '<div class="gate-empty"><p role="status">Reading the gate…</p></div>'}
    </div></section>`;
  }
  const fill = g.pct > 0 ? Math.max(g.pct, 0.8) : 0;
  return `<section class="gate" aria-labelledby="gate-h"><div class="wrap">
    <div class="gate-head"><h2 id="gate-h">The gate</h2><span class="gate-state">${g.open ? 'Open' : 'Closed'}</span></div>
    <div class="track" role="progressbar" aria-label="Progress toward opening the gate" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(g.pct)}">
      <div class="track-fill" style="--pct:${fill}%"></div><div class="track-post"></div>
    </div>
    <div class="track-ends"><strong>${esc(g.now)}</strong><span>${esc(g.goal)}</span></div>
    <dl class="gate-facts">
      <div><dt>Payments counted</dt><dd>${num(g.counted)}</dd></div>
      <div><dt>Payments not counted</dt><dd>${num(g.flagged)}</dd></div>
      <div><dt>Counted revenue</dt><dd>${esc(g.revenue)}</dd></div>
    </dl>
    <p class="gate-foot">${g.source}</p>
  </div></section>`;
}

function overview() {
  return `<section class="hero"><div class="wrap">
    <h1>A token graduates when people pay for the product.</h1>
    <p class="lead">Revenue Gate holds a launch back until its product has earned real payments. Trading volume can't open the gate, and payments from wallets that look like wash trading don't count.</p>
    <div class="actions"><a class="btn" href="#research">Request a report</a><a class="btn quiet" href="#launch">See every payment</a></div>
  </div></section>
  ${gateBand()}
  <section class="path"><div class="wrap">
    <h2>How a payment reaches the gate</h2>
    <ol>
      <li><h3>Someone pays for the product</h3><p>Here the product is an AI research report, priced at 0.01 tBNB.</p></li>
      <li><h3>The paying wallet is scored</h3><p>The wallet earns points for its transaction history and balance, up to 100. An AI model explains the score and can adjust it slightly.</p></li>
      <li><h3>The score goes on-chain</h3><p>The gate contract stores every payment. Only scores of 60 or more are counted.</p></li>
      <li><h3>The gate opens</h3><p>Once counted scores add up to 5,000, the token is eligible to graduate.</p></li>
    </ol>
  </div></section>`;
}

function stepOne(r) {
  if (r.quote) return `<li class="done"><h2>Choose an asset</h2><div class="body"><p>${esc(r.quote.asset)} report, ${esc(r.quote.amount)}</p><div><button class="btn quiet small" data-action="reset">Start over</button></div></div></li>`;
  return `<li><h2>Choose an asset</h2><form class="body" data-form="quote" novalidate>
    <label class="field">Asset name or symbol<input data-field="asset" maxlength="40" autocomplete="off" placeholder="BNB" value="${esc(r.asset)}"></label>
    ${r.error ? `<p class="alert" role="alert">${esc(r.error)}</p>` : ''}
    <div><button class="btn" ${r.busy ? 'disabled' : ''}>${r.busy === 'quote' ? 'Getting a quote…' : 'Get a quote'}</button></div>
  </form></li>`;
}

function stepTwo(r) {
  const title = state.mode === 'live' ? 'Pay with test BNB' : 'Simulate the payment';
  if (!r.quote) return `<li class="locked"><h2>${title}</h2></li>`;
  if (r.payment) return `<li class="done"><h2>${title}</h2><div class="body"><p>Payment verified: ${r.payment.ref}</p></div></li>`;
  const alert = r.error ? `<p class="alert" role="alert">${esc(r.error)}</p>` : '';
  if (state.mode === 'demo') {
    return `<li><h2>${title}</h2><div class="body">
      <div class="pay-box"><div class="pay-line"><span class="amount">${esc(r.quote.amount)}</span></div><p class="small">Demo mode needs no wallet. Nothing is sent.</p></div>
      ${alert}<div><button class="btn" data-action="pay" ${r.busy ? 'disabled' : ''}>Simulate payment</button></div>
    </div></li>`;
  }
  const until = new Date(r.quote.expiresAt).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'});
  const hasWallet = Boolean(window.ethereum);
  const box = `<div class="pay-box">
      <div class="pay-line"><span class="amount">${esc(r.quote.amount)}</span><span class="small">Quote holds until ${esc(until)}</span></div>
      <p class="small">Paid on BNB testnet, from a test wallet, to:</p>
      <div class="pay-line"><span class="mono">${esc(r.quote.recipient)}</span><button type="button" class="btn quiet small" data-copy="${esc(r.quote.recipient)}">Copy</button></div>
    </div>`;
  if (r.busy === 'wallet') return `<li><h2>${title}</h2><div class="body">${box}<p class="writing" role="status">${esc(r.note)}</p></div></li>`;
  const form = `<form class="body" data-form="pay" novalidate>
      <label class="field">Transaction hash<input class="mono" data-field="hash" autocomplete="off" spellcheck="false" placeholder="0x…" value="${esc(r.hash)}"><small>Send the amount above from any wallet, then paste the hash once it confirms.</small></label>
      ${alert}
      <div><button class="btn ${hasWallet ? 'quiet' : ''}" ${r.busy ? 'disabled' : ''}>${r.busy === 'pay' ? 'Verifying…' : 'Verify payment'}</button></div>
    </form>`;
  return `<li><h2>${title}</h2><div class="body">${box}
    ${hasWallet ? `<div><button class="btn" data-action="wallet" ${r.busy ? 'disabled' : ''}>Pay with MetaMask</button></div>` : '<p class="muted">No browser wallet found on this device.</p>'}
    ${r.manual || !hasWallet ? form : `${alert}<div><button type="button" class="linkbtn" data-action="manual">Paid another way? Paste a transaction hash</button></div>`}
  </div></li>`;
}

function stepThree(r) {
  if (!r.payment) return '<li class="locked"><h2>Read the report</h2></li>';
  if (r.report) return '<li class="done"><h2>Read the report</h2><div class="body"><p>Your report is ready. <a href="#launch">See this payment at the gate</a></p></div></li>';
  return `<li><h2>Read the report</h2><div class="body">
    ${r.busy === 'report' ? '<p class="writing" role="status">Writing your report…</p>' : ''}
    ${r.error ? `<p class="alert" role="alert">${esc(r.error)}</p><div><button class="btn" data-action="report">Get the report</button></div>` : ''}
  </div></li>`;
}

function reportDoc(r) {
  if (!r.payment) return '<div class="doc"><div class="doc-empty"><h2>No report yet</h2><p>Finish the three steps and your report opens here, along with the verdict on your payment.</p></div></div>';
  const verdict = `<div class="verdict">${tag(r.payment.verdict, true)}${r.payment.score != null ? `<p><strong>Wallet score ${r.payment.score} of 100.</strong> A score of 60 or more counts.</p>` : ''}<p>${esc(r.payment.reason)}</p>
    ${r.payment.gateTx ? `<p class="muted">Written to the gate contract in ${txLink(r.payment.gateTx)}</p>` : ''}</div>`;
  if (!r.report) return `<div class="doc">${verdict}${r.busy === 'report' ? '<p class="writing">Writing your report…</p>' : ''}</div>`;
  const sources = r.report.sources.map(s => ({label: s.label, url: safeSource(s.url)})).filter(s => s.url);
  return `<article class="doc">${verdict}
    <h2>${esc(r.report.title)}</h2>
    <p class="summary">${esc(r.report.summary)}</p>
    ${r.report.observations.length ? `<h3>What to look at</h3><ul class="points">${r.report.observations.map(o => `<li>${esc(o)}</li>`).join('')}</ul>` : ''}
    ${sources.length ? `<h3>Sources</h3><ul>${sources.map(s => `<li><a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${esc(s.label)}</a></li>`).join('')}</ul>` : ''}
  </article>`;
}

function research() {
  const r = state.r;
  return `<div class="wrap">
    <section class="page-head"><h1>Research an asset before you touch it.</h1><p>Pay 0.01 tBNB for an AI-written report. Your payment is checked, and if your wallet looks genuine it counts toward the gate.</p></section>
    <div class="bench"><ol class="steps">${stepOne(r)}${stepTwo(r)}${stepThree(r)}</ol>${reportDoc(r)}</div>
  </div>`;
}

/* Mirrors SCORE_RULES in backend/services/verification.js */
const SCORE_GUIDE = [
  {name: 'Activity', max: 50, note: 'Transactions the wallet has sent on BNB testnet and BNB mainnet, added together.',
    tiers: [['50 or more', 50], ['10 to 49', 40], ['3 to 9', 30], ['1 or 2', 10]]},
  {name: 'Balance', max: 25, note: 'tBNB plus BNB the wallet holds after paying.',
    tiers: [['0.1 or more', 25], ['0.02 or more', 18], ['0.005 or more', 10], ['Less than 0.005', 3]]},
  {name: 'Wallet type', max: 15, note: 'A contract paying is capped at 40 in total, so it never counts.',
    tiers: [['Personal wallet', 15], ['Contract', 0]]},
];

function scoreGuide() {
  const group = g => `<div class="sg-group"><h3>${esc(g.name)} <span>up to ${g.max} points</span></h3><p>${esc(g.note)}</p>
    <ul>${g.tiers.map(([label, pts]) => `<li><span class="sg-label">${esc(label)}</span><span class="sg-bar"><i style="--w:${pts * 2}%"></i></span><span class="sg-pts">${pts}</span></li>`).join('')}</ul></div>`;
  return `<section class="sg" aria-labelledby="sg-h"><div class="wrap">
    <h2 id="sg-h">How a wallet is scored</h2>
    <p class="ledger-note">A payment counts toward the gate when the paying wallet scores 60 or more out of 100. The points come from fixed rules; the AI model explains the result and can move it by up to 5 points either way.</p>
    <div class="sg-grid">${SCORE_GUIDE.map(group).join('')}</div>
    <div class="sg-scale" role="img" aria-label="Scores from 0 to 59 are not counted. Scores from 60 to 100 are counted.">
      <span class="sg-no">0 to 59: not counted</span><span class="sg-yes">60 to 100: counted</span>
    </div>
    <p class="ledger-note">Example: a wallet with 3 transactions and 0.1 tBNB scores 30 + 25 + 15 = 70, so its payment counts. A wallet with 2 transactions scores at most 50.</p>
  </div></section>`;
}

function gatePage() {
  const g = state.gate;
  const extra = g?.onChain ? g.counted + g.flagged - g.payments.length : 0;
  const rows = g?.payments.length
    ? `<table><thead><tr><th>Payment</th><th>Amount</th><th>Verdict</th><th>Why</th></tr></thead><tbody>${g.payments.map(p => `<tr class="${p.verdict === 'flagged' ? 'flagged' : ''}"><td>${p.ref}</td><td class="amt">${esc(p.amount)}</td><td>${tag(p.verdict)}</td><td class="why">${p.score != null ? `<strong>Score ${p.score}.</strong> ` : ''}${esc(p.reason)}</td></tr>`).join('')}</tbody></table>`
    : g ? '<div class="empty-row"><p>No payments have come through this server yet.</p><a class="btn" href="#research">Request a report</a></div>' : '';
  return `<div class="wrap"><section class="page-head"><h1>Every payment, counted or not.</h1><p>Product payments are tracked apart from token-sale proceeds. A payment that doesn't count is still recorded, with the reason.</p></section></div>
  ${gateBand()}
  ${g?.openfour ? openFourPanel(g.openfour) : ''}
  ${scoreGuide()}
  <section class="ledger"><div class="wrap">
    <div class="ledger-head"><div><h2>Payments</h2><p class="ledger-note">A counted payment shows a genuine-looking wallet. It doesn't prove independent demand.</p></div>
    <button class="btn quiet" data-action="refresh" ${state.gateBusy ? 'disabled' : ''}>${state.gateBusy ? 'Refreshing…' : 'Refresh'}</button></div>
    ${rows}
    ${extra > 0 ? `<p class="ledger-note">The contract also holds ${num(extra)} earlier ${extra === 1 ? 'record' : 'records'} not listed here.</p>` : ''}
  </div></section>`;
}

/* Rendering */
const route = () => (ROUTES.includes(location.hash.slice(1)) ? location.hash.slice(1) : 'discover');

function render() {
  const current = route();
  document.querySelectorAll('.top nav a').forEach(a => {
    if (a.hash === '#' + current) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
  document.querySelectorAll('.mode button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.mode === state.mode)));
  notice.hidden = state.mode !== 'demo';
  notice.innerHTML = '<p>Demo data. Payments, reports and gate records on this page are illustrative, and nothing is sent to a wallet or a contract.</p>';
  view.innerHTML = {discover: overview, research, launch: gatePage}[current]();
  if (current !== 'research' && !state.gate && !state.gateBusy && !state.gateError) loadGate();
}

async function loadGate() {
  if (state.gateBusy) return;
  const mode = state.mode;
  state.gateBusy = true; state.gateError = '';
  render();
  try { const g = await src().gate(); if (state.mode === mode) state.gate = g; }
  catch (err) { if (state.mode === mode) state.gateError = friendly(err); }
  finally { state.gateBusy = false; render(); }
}

async function run(kind, fn) {
  const r = state.r;
  if (r.busy) return;
  r.busy = kind; r.error = '';
  render();
  try { await fn(r); } catch (err) { r.error = friendly(err); }
  finally { r.busy = ''; if (state.r === r) render(); }
}

function getQuote() {
  const asset = state.r.asset.trim();
  if (!asset) { state.r.error = 'Enter an asset name or symbol, like BNB.'; return render(); }
  run('quote', async r => { r.quote = await src().quote(asset); });
}

async function pay() {
  const hash = state.r.hash.trim();
  if (state.mode === 'live' && !validHash(hash)) {
    state.r.error = "That isn't a transaction hash. It starts with 0x followed by 64 letters and numbers.";
    return render();
  }
  await run('pay', async r => {
    const p = await src().pay(r.quote, hash);
    if (p.status === 'pending') throw new Error(p.reason || 'The transfer is still confirming. Wait a moment, then verify again.');
    if (p.status !== 'confirmed') throw new Error(p.reason || 'The transfer failed on-chain. Send a new one and paste its hash.');
    r.payment = p;
    state.gate = null; state.gateError = '';
  });
  if (state.r.payment && !state.r.report) getReport();
}

const BNB_TESTNET = {chainId: '0x61', chainName: 'BNB Smart Chain Testnet', nativeCurrency: {name: 'tBNB', symbol: 'tBNB', decimals: 18}, rpcUrls: ['https://data-seed-prebsc-1-s1.bnbchain.org:8545'], blockExplorerUrls: [SCAN]};

async function payWithWallet() {
  const eth = window.ethereum;
  const step = (r, note) => { r.note = note; if (state.r === r) render(); };
  await run('wallet', async r => {
    r.note = 'Connect your wallet in MetaMask…';
    const [from] = await eth.request({method: 'eth_requestAccounts'});
    try { await eth.request({method: 'wallet_switchEthereumChain', params: [{chainId: BNB_TESTNET.chainId}]}); }
    catch (err) { if (err?.code !== 4902) throw err; await eth.request({method: 'wallet_addEthereumChain', params: [BNB_TESTNET]}); }
    step(r, 'Confirm the 0.01 tBNB payment in MetaMask…');
    const hash = await eth.request({method: 'eth_sendTransaction', params: [{from, to: r.quote.recipient, value: '0x' + BigInt(r.quote.amountWei).toString(16)}]});
    r.hash = hash; r.manual = true;
    step(r, 'Payment sent. Waiting for BNB testnet to confirm it…');
    for (let attempt = 0; attempt < 25; attempt++) {
      await new Promise(done => setTimeout(done, 3000));
      const p = await src().pay(r.quote, hash);
      if (p.status === 'failed') throw new Error(p.reason || 'The transfer failed on-chain.');
      if (p.status === 'confirmed') { r.payment = p; state.gate = null; state.gateError = ''; return; }
    }
    throw new Error('The transfer is taking longer than usual. Wait a moment, then press Verify payment.');
  });
  if (state.r.payment && !state.r.report) getReport();
}

function getReport() {
  run('report', async r => { r.report = await src().report(r.quote); });
}

view.addEventListener('submit', event => {
  event.preventDefault();
  if (event.target.dataset.form === 'quote') getQuote();
  if (event.target.dataset.form === 'pay') pay();
});
view.addEventListener('input', event => {
  const field = event.target.dataset.field;
  if (field) state.r[field] = event.target.value;
});
// Explorer links open in a new tab. Where the browser refuses a new tab (in-app wallet browsers, strict popup settings), open in this one.
document.addEventListener('click', event => {
  const link = event.target.closest('a[target="_blank"]');
  if (!link || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey) return;
  event.preventDefault();
  const tab = window.open(link.href, '_blank');
  if (tab) tab.opener = null;
  else location.href = link.href;
});

view.addEventListener('click', event => {
  const el = event.target.closest('[data-action],[data-copy]');
  if (!el) return;
  if (el.dataset.copy) {
    navigator.clipboard?.writeText(el.dataset.copy).then(() => { el.textContent = 'Copied'; }, () => { el.textContent = 'Copy failed'; });
    return;
  }
  const action = el.dataset.action;
  if (action === 'refresh') { state.gate = null; state.gateError = ''; loadGate(); }
  if (action === 'reset') { state.r = blankResearch(); render(); }
  if (action === 'pay') pay();
  if (action === 'wallet') payWithWallet();
  if (action === 'manual') { state.r.manual = true; render(); }
  if (action === 'report') getReport();
});
document.querySelector('.mode').addEventListener('click', event => {
  const next = event.target.dataset?.mode;
  if (!next || next === state.mode) return;
  state.mode = next; state.gate = null; state.gateError = ''; state.r = blankResearch();
  render();
});
window.addEventListener('hashchange', () => { render(); window.scrollTo(0, 0); view.focus({preventScroll: true}); });
render();

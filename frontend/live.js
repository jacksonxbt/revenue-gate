// Same origin when the backend serves this page; the hosted API when previewed with serve.js.
const HOSTED_API = 'http://47.129.46.77:3001';
const here = globalThis.location;
export const liveConfig = Object.freeze({
  baseUrl: here && here.port !== '4173' && here.protocol.startsWith('http') ? here.origin : HOSTED_API,
  routes: Object.freeze({
    quote: '/api/quote',
    payment: '/api/payment',
    report: '/api/report',
    launch: '/api/launch',
  }),
});
export const isConfigured = c => Boolean(c?.baseUrl && ['quote','payment','report','launch'].every(k=>c.routes?.[k]));
export const validHash = v => /^0x[0-9a-f]{64}$/i.test(v);
export const safeSource = v => {try {const u=new URL(v);return ['https:','http:'].includes(u.protocol)?u.href:null}catch{return null}};
export const escapeHtml = value => String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function testnetAmount(value){
  if(typeof value!=='string'||!/^\d{1,30}$/.test(value))throw new Error('Invalid testnet amount.');
  const n=BigInt(value),whole=n/10n**18n,frac=(n%10n**18n).toString().padStart(18,'0').replace(/0+$/,'');
  return whole.toString()+(frac?'.'+frac:'')+' tBNB';
}
function requireObject(o){if(!o||typeof o!=='object'||Array.isArray(o))throw new Error('Unexpected API response.');return o}
function requireChain(o){if(o.chainId!==97)throw new Error('Unexpected network; only BNB testnet (97) is supported.');return o}
export function validateQuote(o){
  requireChain(requireObject(o));testnetAmount(o.amountWei);
  if(typeof o.requestId!=='string'||!o.requestId||typeof o.asset!=='string'||!/^0x[0-9a-f]{40}$/i.test(o.recipient)||!Number.isFinite(Date.parse(o.expiresAt))||Date.parse(o.expiresAt)<=Date.now())throw new Error('Invalid or expired quote.');
  return o;
}
export function validatePayment(o){
  requireChain(requireObject(o));if(!validHash(o.txHash)||!['pending','confirmed','failed'].includes(o.status)||!['pending','eligible','flagged','uncertain'].includes(o.assessment)||!Number.isInteger(o.confirmations)||o.confirmations<0)throw new Error('Invalid payment status.');
  testnetAmount(o.amountWei);return o;
}
export function validateReport(o){
  requireObject(o);if(!['pending','ready','failed'].includes(o.status))throw new Error('Invalid report status.');
  if(o.status==='ready'&&(typeof o.title!=='string'||typeof o.summary!=='string'||!Array.isArray(o.observations)||!o.observations.every(v=>typeof v==='string')||!Array.isArray(o.sources)||!o.sources.length||!o.sources.every(v=>typeof v?.label==='string'&&safeSource(v.url))))throw new Error('Invalid sourced report.');
  return o;
}
export function validateLaunch(o){
  requireChain(requireObject(o));testnetAmount(o.revenueWei);testnetAmount(o.targetWei);
  if(BigInt(o.targetWei)<=0n||typeof o.eligible!=='boolean'||!Array.isArray(o.payments)||!['informational','enforced','on-chain','unverified'].includes(o.enforcement)||typeof o.state!=='string')throw new Error('Invalid launch state.');
  o.payments.forEach(validatePayment);
  if(o.enforcement==='enforced'&&(!/^0x[0-9a-f]{40}$/i.test(o.contractAddress)||!validHash(o.evidenceTxHash)))throw new Error('Missing on-chain enforcement evidence.');
  return o;
}
export function createLiveAdapter(config=liveConfig, fetcher=fetch){
  async function call(key,payload,validate){
    if(!isConfigured(config))throw new Error('Live API configuration pending. See GitHub issue #2.');
    const base=new URL(config.baseUrl);
    const endpoint=new URL(config.routes[key],base);
    if(endpoint.origin!==base.origin)throw new Error('Unexpected API route origin.');
    const response=await fetcher(endpoint.href,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload),credentials:'omit',redirect:'error',signal:AbortSignal.timeout(30000)});
    if(!response.ok)throw new Error('API request failed ('+response.status+'). Retry when available.');
    return validate(await response.json());
  }
  return {quote:asset=>call('quote',{asset,chainId:97},validateQuote),payment:(requestId,txHash)=>{if(!validHash(txHash))throw new Error('Enter a valid testnet transaction hash.');return call('payment',{requestId,txHash,chainId:97},validatePayment)},report:requestId=>call('report',{requestId},validateReport),launch:()=>call('launch',{chainId:97},validateLaunch)};
}

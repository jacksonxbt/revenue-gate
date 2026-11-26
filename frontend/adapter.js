// Isolated demonstration adapter. Never returns genuine transaction hashes or live reports.
const initial = [
  {id:'DEMO-001',asset:'BNB',amount:0.01,assessment:'Illustrative eligible'},
  {id:'DEMO-002',asset:'BTC',amount:0.01,assessment:'Illustrative eligible'},
  {id:'DEMO-003',asset:'ETH',amount:0.01,assessment:'Illustrative flagged'}
];
let payments = initial.map(p=>({...p}));
export const DEMO_PRICE = 0.01;
export const TARGET = 0.05;
export function getLaunchState(){
  const eligible = payments.filter(p=>p.assessment==='Illustrative eligible');
  const revenue = Math.round(eligible.reduce((sum,p)=>sum+p.amount,0)*100)/100;
  return {payments:payments.map(p=>({...p})),revenue,target:TARGET,eligibleCount:eligible.length,eligible:revenue>=TARGET,chainId:97, enforcement:'Unverified — informational only'};
}
export function requestReport(asset){
  const normalized=asset.trim().toUpperCase();
  if(!/^[A-Z0-9][A-Z0-9 ._-]{0,39}$/.test(normalized))throw new Error('Enter a valid asset symbol or name (1–40 characters).');
  return {asset:normalized,amount:DEMO_PRICE,status:'awaiting-demo-payment'};
}
export function simulatePayment(request){
  if(request.status!=='awaiting-demo-payment')throw new Error('Request already processed.');
  request.status='demo-complete';
  const payment={id:'DEMO-'+String(payments.length+1).padStart(3,'0'),asset:request.asset,amount:request.amount,assessment:'Illustrative eligible'};
  payments.push(payment);
  return {payment,report:{title:request.asset+' research framework',summary:'Illustrative educational report. No live market data or AI model was queried.',observations:['Review liquidity and recent trading activity before drawing conclusions.','Compare holder concentration and token supply using current primary data.','Check project disclosures and independent market evidence; no buy or sell recommendation.'],sources:[{label:'BNB Chain documentation (reference, not queried)',url:'https://docs.bnbchain.org/'},{label:'OpenFour documentation (reference, not queried)',url:'https://github.com/four-meme-community/openfour-docs'}]}};
}

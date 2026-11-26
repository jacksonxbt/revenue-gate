import {test} from 'node:test';
import assert from 'node:assert/strict';
import {getLaunchState,requestReport,simulatePayment} from './adapter.js';
test('demo journey excludes flagged records and reaches informational target',()=>{assert.equal(getLaunchState().revenue,.02);assert.throws(()=>requestReport('<script>'));for(let i=0;i<3;i++){const request=requestReport('bnb');const result=simulatePayment(request);assert.match(result.payment.id,/^DEMO-/);assert.match(result.report.summary,/No live/);assert.throws(()=>simulatePayment(request));}assert.equal(getLaunchState().revenue,.05);assert.equal(getLaunchState().eligible,true);assert.match(getLaunchState().enforcement,/Unverified/);});

import test from "node:test";
import assert from "node:assert/strict";
import { assessWalletActivity, findPreviousPayment, isProjectPayer, withPaymentHash } from "../services/payment-policy.js";
import { getLiquidity, parseResearchToken } from "../services/research.js";

const payer = "0x" + "a".repeat(40);
const project = "0x" + "b".repeat(40);
const recipient = "0x" + "c".repeat(40);
const profile = { transactionCount: 12, balanceBNB: 0.02, isContract: false };
const hash = "0x" + "a".repeat(64);

test("wallet activity qualifies at 60 and explains the observed inputs", () => {
  const result = assessWalletActivity(profile, 60);
  assert.equal(result.assessment, "eligible");
  assert.match(result.reasoning, /12 outgoing transactions/);
  assert.equal(assessWalletActivity(profile, 59).assessment, "flagged");
  assert.equal(assessWalletActivity(profile, "90").assessment, "flagged");
  assert.equal(assessWalletActivity({ ...profile, isContract: true }, 90).assessment, "flagged");
});

test("recipient and configured project payers cannot count, even at a score of 95", () => {
  for (const from of [recipient, project]) {
    const excluded = isProjectPayer(from, recipient, [project.toUpperCase()]);
    assert.equal(excluded, true);
    assert.equal(assessWalletActivity(profile, 95, excluded).confidence, 0);
  }
  assert.equal(isProjectPayer(payer, recipient, [project]), false);
});

test("concurrent duplicate submissions serialize on a case-insensitive hash", async () => {
  const payments = [];
  const submit = (txHash) => withPaymentHash(txHash, async (canonicalHash) => {
    if (findPreviousPayment(payments, canonicalHash)) return "duplicate";
    await new Promise(resolve => setImmediate(resolve));
    payments.push({ txHash: canonicalHash, verification: assessWalletActivity(profile, 70) });
    return "counted";
  });
  assert.deepEqual(await Promise.all([submit(hash), submit(hash.toUpperCase())]), ["counted", "duplicate"]);
  assert.equal(payments.length, 1);
});

const token = parseResearchToken(`bsc:${payer}`);
const timestamp = Date.parse("2026-11-26T12:00:00Z");
const now = () => timestamp;
const pair = { chainId: "bsc", pairAddress: project, baseToken: {address: payer}, quoteToken: {address: recipient}, liquidity: {usd: 124.5} };
const reply = (pairs, date = new Date(timestamp).toUTCString()) => async () =>
  new Response(JSON.stringify(pairs), { headers: { date } });

test("renders numeric liquidity only for the identified chain and token", async () => {
  assert.equal(parseResearchToken("BNB"), null);
  const result = await getLiquidity(token, { request: reply([pair]), now });
  assert.equal(result.usd, 124.5);
  assert.equal(result.retrievedAt, new Date(timestamp).toISOString());
  assert.equal(result.source, "DEX Screener");
});

test("missing, stale, mismatched and unavailable provider data yield Unavailable", async () => {
  for (const request of [
    reply([]),
    reply([{ ...pair, chainId: "ethereum" }]),
    reply([{ ...pair, baseToken: {address: project} }]),
    reply([{ ...pair, liquidity: {usd: "124.5"} }]),
    reply([pair], new Date(timestamp - 600000).toUTCString()),
    async () => { throw new Error("source offline"); },
  ]) {
    const result = await getLiquidity(token, { request, now });
    assert.equal(result.status, "unavailable");
    assert.equal(result.usd, undefined);
  }
});

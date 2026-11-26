const { expect } = require("chai");
const { ethers } = require("hardhat");

const ONE = 10n ** 18n;
const coder = ethers.AbiCoder.defaultAbiCoder();
const PARAMS = "tuple(address revenueGate,uint256 softCap,uint256 duration,uint256 tokenLiquidityAmount,uint256 maxQuoteToUse)";

describe("RevenueGateMigrateModule (OpenFour migrate slot)", function () {
  let core, oracle, stranger, gate, module, token;
  const GATE_THRESHOLD = 150; // two counted payments in these tests
  const SOFT_CAP = 1n * ONE;

  const migrateCtx = (extras = {}) => ({ token, totalRaised: 0n, remainingForSale: 800_000n * ONE, soldOut: false, timestamp: 1n, ...extras });
  const hookCtx = (extras = {}) => ({ vault: ethers.ZeroAddress, token, quoteAsset: ethers.ZeroAddress, creator: ethers.ZeroAddress, totalRaised: SOFT_CAP, remainingForSale: 700_000n * ONE, timestamp: 1n, ...extras });
  const pay = (id, confidence) => gate.connect(oracle).recordPayment(ethers.id(id), stranger.address, confidence, ONE / 100n);

  async function cloneModule(gateAddress) {
    const impl = await ethers.deployContract("RevenueGateMigrateModule");
    const factory = await ethers.deployContract("CloneFactory");
    const address = await factory.clone.staticCall(impl);
    await factory.clone(impl);
    const instance = await ethers.getContractAt("RevenueGateMigrateModule", address);
    const raw = coder.encode([PARAMS], [[gateAddress, SOFT_CAP, 7n * 24n * 3600n, 0n, 0n]]);
    return { instance, raw };
  }

  beforeEach(async function () {
    [core, oracle, stranger] = await ethers.getSigners();
    token = ethers.Wallet.createRandom().address;
    gate = await ethers.deployContract("RevenueGate", [oracle.address, GATE_THRESHOLD]);
    const { instance, raw } = await cloneModule(await gate.getAddress());
    module = instance;
    await module.init(token, core.address, ethers.ZeroAddress, raw, "1.0.0");
  });

  it("identifies itself as an OpenFour migrate module", async function () {
    const [, tag, version] = await module.descriptor();
    expect(tag).to.equal("module.migrate.revenue_gate");
    expect(version).to.equal("1.0.0");
    const schema = await module.moduleEncodeSchema();
    expect(schema.kind).to.equal("migrate");
    expect(schema.params.map((p) => p.name)).to.deep.equal(["revenueGate", "softCap", "duration", "tokenLiquidityAmount", "maxQuoteToUse"]);
  });

  it("refuses graduation while the sale conditions are not met, even with the gate open", async function () {
    await pay("a", 90); await pay("b", 90);
    expect(await gate.graduated()).to.equal(true);
    const result = await module.evaluate(migrateCtx());
    expect(result.canMigrate).to.equal(false);
    expect(result.reason).to.equal("Launch conditions not met");
  });

  it("refuses graduation when the sale is done but the revenue gate is closed", async function () {
    const result = await module.evaluate(migrateCtx({ totalRaised: SOFT_CAP }));
    expect(result.canMigrate).to.equal(false);
    expect(result.reason).to.match(/^Revenue gate closed/);
    const soldOut = await module.evaluate(migrateCtx({ soldOut: true }));
    expect(soldOut.canMigrate).to.equal(false);
  });

  it("does not open for payments that are recorded but not counted", async function () {
    await pay("a", 55); await pay("b", 40); await pay("c", 59);
    expect(await gate.totalPayments()).to.equal(3n);
    expect(await module.gateOpen()).to.equal(false);
    expect((await module.evaluate(migrateCtx({ totalRaised: SOFT_CAP }))).canMigrate).to.equal(false);
  });

  it("allows graduation once counted payments reach the gate threshold", async function () {
    await pay("a", 90);
    expect((await module.evaluate(migrateCtx({ totalRaised: SOFT_CAP }))).canMigrate).to.equal(false);
    await pay("b", 60);
    const result = await module.evaluate(migrateCtx({ totalRaised: SOFT_CAP }));
    expect(result.canMigrate).to.equal(true);
    expect(coder.decode(["uint256"], result.data)[0]).to.equal(SOFT_CAP);
  });

  it("rechecks the gate inside executeMigration", async function () {
    await expect(module.executeMigration(hookCtx(), "0x")).to.be.revertedWith("RevenueGateMigrate: revenue gate closed");
    await pay("a", 90); await pay("b", 90);
    // No Pancake router on the local chain, so a passing check returns the empty payload.
    const [version, data] = await module.executeMigration.staticCall(hookCtx(), "0x");
    expect(version).to.equal(0n);
    expect(data).to.equal("0x");
  });

  it("only answers to OpenFour Core and only for its bound token", async function () {
    await expect(module.connect(stranger).evaluate(migrateCtx())).to.be.revertedWith("RevenueGateMigrate: only fourCore");
    await expect(module.connect(stranger).executeMigration(hookCtx(), "0x")).to.be.revertedWith("RevenueGateMigrate: only fourCore");
    await expect(module.evaluate(migrateCtx({ token: stranger.address }))).to.be.revertedWith("RevenueGateMigrate: wrong token");
  });

  it("rejects a gate address that is not a contract, and cannot be initialised twice", async function () {
    const { instance, raw } = await cloneModule(stranger.address);
    await expect(instance.init(token, core.address, ethers.ZeroAddress, raw, "1.0.0")).to.be.revertedWith("RevenueGateMigrate: gate is not a contract");
    const again = coder.encode([PARAMS], [[await gate.getAddress(), SOFT_CAP, 0n, 0n, 0n]]);
    await expect(module.init(token, core.address, ethers.ZeroAddress, again, "1.0.0")).to.be.reverted;
  });
});

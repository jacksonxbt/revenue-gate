const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("RevenueGate", function () {
  let gate, owner, oracle, user1, user2;
  const THRESHOLD = 5000; // 50 eligible payments at confidence 100

  beforeEach(async function () {
    [owner, oracle, user1, user2] = await ethers.getSigners();
    const Factory = await ethers.getContractFactory("RevenueGate");
    gate = await Factory.deploy(oracle.address, THRESHOLD);
  });

  it("deploys with correct initial state", async function () {
    expect(await gate.oracle()).to.equal(oracle.address);
    expect(await gate.graduationThreshold()).to.equal(THRESHOLD);
    expect(await gate.graduated()).to.equal(false);
    expect(await gate.totalPayments()).to.equal(0);
  });

  it("records eligible payment (confidence >= 60)", async function () {
    const id = ethers.id("PAY-0001");
    await expect(
      gate.connect(oracle).recordPayment(id, user1.address, 85, ethers.parseEther("0.01"))
    ).to.emit(gate, "PaymentRecorded").withArgs(id, user1.address, 85, ethers.parseEther("0.01"), true);

    expect(await gate.totalPayments()).to.equal(1);
    expect(await gate.eligiblePayments()).to.equal(1);
    expect(await gate.totalWeightedScore()).to.equal(85);
  });

  it("records flagged payment (confidence < 60)", async function () {
    const id = ethers.id("PAY-0002");
    await gate.connect(oracle).recordPayment(id, user1.address, 15, ethers.parseEther("0.01"));

    expect(await gate.totalPayments()).to.equal(1);
    expect(await gate.flaggedPayments()).to.equal(1);
    expect(await gate.eligiblePayments()).to.equal(0);
    expect(await gate.totalWeightedScore()).to.equal(0);
  });

  it("rejects duplicate payment", async function () {
    const id = ethers.id("PAY-0003");
    await gate.connect(oracle).recordPayment(id, user1.address, 70, ethers.parseEther("0.01"));
    await expect(
      gate.connect(oracle).recordPayment(id, user1.address, 70, ethers.parseEther("0.01"))
    ).to.be.revertedWith("Already processed");
  });

  it("rejects non-oracle caller", async function () {
    const id = ethers.id("PAY-0004");
    await expect(
      gate.connect(user1).recordPayment(id, user1.address, 80, ethers.parseEther("0.01"))
    ).to.be.revertedWith("Only oracle");
  });

  it("triggers graduation when threshold met", async function () {
    for (let i = 0; i < 50; i++) {
      const id = ethers.id(`PAY-${i}`);
      await gate.connect(oracle).recordPayment(id, user1.address, 100, ethers.parseEther("0.01"));
    }
    expect(await gate.graduated()).to.equal(true);
    expect(await gate.totalWeightedScore()).to.equal(5000);
  });

  it("returns correct graduation progress", async function () {
    const id = ethers.id("PAY-PROG");
    await gate.connect(oracle).recordPayment(id, user1.address, 80, ethers.parseEther("0.01"));

    const progress = await gate.getGraduationProgress();
    expect(progress._totalWeightedScore).to.equal(80);
    expect(progress._graduationThreshold).to.equal(THRESHOLD);
    expect(progress._progressPercent).to.equal(1); // 80/5000 = 1%
    expect(progress._graduated).to.equal(false);
  });

  it("owner can update oracle", async function () {
    await gate.connect(owner).setOracle(user2.address);
    expect(await gate.oracle()).to.equal(user2.address);
  });

  it("non-owner cannot update oracle", async function () {
    await expect(
      gate.connect(user1).setOracle(user2.address)
    ).to.be.revertedWith("Only owner");
  });
});

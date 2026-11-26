const hre = require("hardhat");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("Deploying with:", deployer.address);
  console.log("Balance:", hre.ethers.formatEther(await hre.ethers.provider.getBalance(deployer.address)), "BNB");

  // Oracle address = deployer for hackathon (backend signs with same key)
  const oracleAddress = deployer.address;
  const graduationThreshold = 5000; // 50 payments at confidence 100, or more at lower confidence

  const Factory = await hre.ethers.getContractFactory("RevenueGate");
  const gate = await Factory.deploy(oracleAddress, graduationThreshold);
  await gate.waitForDeployment();

  const address = await gate.getAddress();
  console.log("RevenueGate deployed to:", address);
  console.log("Oracle:", oracleAddress);
  console.log("Graduation threshold:", graduationThreshold);
  console.log("");
  console.log("Add to your .env:");
  console.log(`CONTRACT_ADDRESS=${address}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

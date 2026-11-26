import { ethers } from "ethers";

function env(key, fallback) { return process.env[key] || fallback; }

const ABI = [
  "function recordPayment(bytes32 paymentId, address payer, uint256 confidence, uint256 amount) external",
  "function getGraduationProgress() external view returns (uint256, uint256, uint256, uint256, uint256, bool, uint256)",
  "function graduated() external view returns (bool)",
];

let _contract;

function getContract() {
  if (!_contract) {
    const rpc = env("BSC_TESTNET_RPC", "https://data-seed-prebsc-1-s1.bnbchain.org:8545");
    const provider = new ethers.JsonRpcProvider(rpc, 97);
    const wallet = new ethers.Wallet(env("DEPLOYER_PRIVATE_KEY"), provider);
    _contract = new ethers.Contract(env("CONTRACT_ADDRESS"), ABI, wallet);
  }
  return _contract;
}

function getReadContract() {
  const rpc = env("BSC_TESTNET_RPC", "https://data-seed-prebsc-1-s1.bnbchain.org:8545");
  const provider = new ethers.JsonRpcProvider(rpc, 97);
  return new ethers.Contract(env("CONTRACT_ADDRESS"), ABI, provider);
}

export async function recordPaymentOnChain(paymentIdStr, payerAddress, confidence, amountWei) {
  if (!env("CONTRACT_ADDRESS") || !env("DEPLOYER_PRIVATE_KEY")) {
    console.log("On-chain recording skipped: missing CONTRACT_ADDRESS or DEPLOYER_PRIVATE_KEY");
    return null;
  }

  try {
    const contract = getContract();
    const paymentIdHash = ethers.id(paymentIdStr);
    const tx = await contract.recordPayment(paymentIdHash, payerAddress, confidence, amountWei);
    console.log(`Payment recorded on-chain: ${tx.hash}`);
    return tx.hash;
  } catch (err) {
    console.error("On-chain recording failed:", err.message);
    return null;
  }
}

export async function getGraduationProgress() {
  if (!env("CONTRACT_ADDRESS")) return null;

  try {
    const contract = getReadContract();
    const result = await contract.getGraduationProgress();
    return {
      totalWeightedScore: Number(result[0]),
      graduationThreshold: Number(result[1]),
      totalPayments: Number(result[2]),
      eligiblePayments: Number(result[3]),
      flaggedPayments: Number(result[4]),
      graduated: result[5],
      progressPercent: Number(result[6]),
    };
  } catch (err) {
    console.error("Failed to read graduation progress:", err.message);
    return null;
  }
}

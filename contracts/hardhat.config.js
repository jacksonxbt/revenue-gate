require("@nomicfoundation/hardhat-toolbox");

const DEPLOYER_KEY = process.env.DEPLOYER_PRIVATE_KEY || "0x" + "0".repeat(64);

module.exports = {
  solidity: {
    // OpenFour's required settings for modules.
    version: "0.8.24",
    settings: { optimizer: { enabled: true, runs: 200 }, viaIR: true },
    // RevenueGate.sol keeps the settings it was deployed and verified with.
    overrides: { "contracts/RevenueGate.sol": { version: "0.8.24", settings: {} } },
  },
  networks: {
    bscTestnet: {
      url: "https://data-seed-prebsc-1-s1.bnbchain.org:8545",
      chainId: 97,
      accounts: [DEPLOYER_KEY],
    },
  },
  etherscan: {
    apiKey: {
      bscTestnet: process.env.BSCSCAN_API_KEY || "",
    },
  },
};

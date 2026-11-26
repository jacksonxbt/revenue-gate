require("@nomicfoundation/hardhat-toolbox");

const DEPLOYER_KEY = process.env.DEPLOYER_PRIVATE_KEY || "0x" + "0".repeat(64);

module.exports = {
  solidity: "0.8.24",
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

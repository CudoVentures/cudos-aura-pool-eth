import * as dotenv from "dotenv";
import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import "@nomicfoundation/hardhat-chai-matchers";
import "@nomiclabs/hardhat-ethers";
import "solidity-coverage";
import "@nomiclabs/hardhat-etherscan";


dotenv.config({ path: "./.env" });

const config: HardhatUserConfig = {
    solidity: {
        compilers: [
            {
                version: "0.6.6",
                settings: {
                    optimizer: {
                        enabled: true,
                    },
                },
            },
            {
                version: "0.6.12",
                settings: {
                    optimizer: {
                        enabled: true,
                    },
                },
            },
            {
                version: "0.8.1",
                settings: {
                    optimizer: {
                        enabled: true,
                    },
                },
            },
        ],
    },
    networks: {
        sepolia: {
            url: `${process.env.SEPOLIA_NODE_URL ?? ""}`,
            accounts: [process.env.SEPOLIA_PRIVATE_KEY ?? ""],
        },
        mainnet: {
            url: `${process.env.MAINNET_NODE_URL ?? ""}`,
            accounts: [process.env.MAINNET_PRIVATE_KEY ?? ""],
        },
    },
    gasReporter: {
        enabled: true,
    },
    etherscan: {
        apiKey: {
            sepolia: process.env.SEPOLIA_ETHERSCAN_API_KEY ?? "",
            mainnet: process.env.MAINNET_ETHERSCAN_API_KEY ?? "",
        }
    },
    mocha: {
        timeout: 100000000,
    },
    typechain: {
        target: "ethers-v5",
        alwaysGenerateOverloads: true,
    },
};

export default config;

import { run, ethers } from "hardhat";
import { CudosAccessControls__factory, CudosMarkets__factory } from "../typechain-types";

async function main() {
    const [wallet] = await ethers.getSigners();

    let cudosAccessControlAddress = process.env.CUDOS_ACCESS_CONTROLS_ADDRESS ?? "";

    if (cudosAccessControlAddress == "") {
        console.log(
            "'CUDOS_ACCESS_CONTROLS_ADDRESS' is empty, deploying CudosAccessControl contract."
        );
        const cudosAccessControls = await new CudosAccessControls__factory(wallet).deploy();
        await cudosAccessControls.deployed();
        cudosAccessControlAddress = cudosAccessControls.address;
        console.log("CudosAccessControl contract deployed at address " + cudosAccessControlAddress);

        await cudosAccessControls.deployTransaction.wait(5);
        try {
            await run("verify:verify", {
                address: cudosAccessControlAddress,
                constructorArguments: [],
            });
        } catch (e){
            console.log(e)
        }
    }


    const cudosMarkets = await new CudosMarkets__factory(wallet).deploy(cudosAccessControlAddress);
    await cudosMarkets.deployed();
    console.log("CudosMarkets contract deployed at address " + cudosMarkets.address);

    await cudosMarkets.deployTransaction.wait(5);

    await run("verify:verify", {
        address: cudosMarkets.address,
        constructorArguments: [cudosAccessControlAddress],
    });
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});

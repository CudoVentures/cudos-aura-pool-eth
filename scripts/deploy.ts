import { run, ethers } from "hardhat";
import { CudosAccessControls__factory, CudosAuraPool__factory } from "../typechain-types";

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

        await run("verify:verify", {
            address: cudosAccessControlAddress,
            constructorArguments: [],
        });
    }


    const cudosAuraPool = await new CudosAuraPool__factory(wallet).deploy(cudosAccessControlAddress);
    await cudosAuraPool.deployed();
    console.log("CudosAuraPool contract deployed at address " + cudosAuraPool.address);

    await cudosAuraPool.deployTransaction.wait(5);

    await run("verify:verify", {
        address: cudosAuraPool.address,
        constructorArguments: [cudosAccessControlAddress],
    });
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});

import {HardhatRuntimeEnvironment} from "hardhat/types";
import {DeployFunction} from "hardhat-deploy/types";
import { ethers } from "hardhat";
import {deployContract} from "../deployUtils";
let deploymode: string = <string>process.env.deploymode;

const deploy: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
    if (deploymode!="base") {
        return;
    }
    const {
        deployments: { get },
    } = hre;
    
    const positionFactoryDeployment = await get("PositionFactory");
    const zchfDeployment = await get("Frankencoin");
    let positionFactoryContract = await ethers.getContractAt("PositionFactory", 
        positionFactoryDeployment.address);
    let zchfContract = await ethers.getContractAt("Frankencoin", zchfDeployment.address);;
    let mintingHubContract = await deployContract(hre, "MintingHub", 
        [zchfContract.address, positionFactoryContract.address]);

    // create a minting hub too while we have no ZCHF supply
    try {
        let tx = await zchfContract.suggestMinter(mintingHubContract.address, 0, 0, "Minting Hub", { gasLimit: 2_000_000 });
        await tx.wait();
    } catch (err) {
        console.log("Suggest minter failed, probably already registered:")
        console.error(err);
    }
};
export default deploy;

import {HardhatRuntimeEnvironment} from "hardhat/types";
import {DeployFunction} from "hardhat-deploy/types";
import { ethers } from "hardhat";
import { BigNumber } from "ethers";
import { floatToDec18 } from "../../math";

//'deploymode' is defined in package.json as part of command deployPositions/deploy
let deploymode: string = <string>process.env.deploymode;

/*
    HOWTO
    - inspect config file parameters/paramsPositions
    - ensure minter has enough collateral and ZCHF to ask for position
    - run via: npm run-script deployPositions:network sepolia
*/

async function deployPos(params, hre: HardhatRuntimeEnvironment) {
    /*
    let tx = await mintingHubContract.openPosition(collateral, minCollateral, 
        fInitialCollateral, initialLimit, duration, challengePeriod, fFees, 
        fliqPrice, fReserve);
    */
    //------
    // get minting hub contract
    const {deployments: { get },} = hre;
    const mintingHubDeployment = await get("MintingHub");
    const fcDeployment = await get("Frankencoin");
    const collateralDeployment = await get(params.name);

    let mintingHubContract = await ethers.getContractAt("MintingHub", 
        mintingHubDeployment.address);
    
    let collateralAddr = params.collateralTknAddr;
    let fMinCollateral = floatToDec18(params.minCollateral);
    let fInitialCollateral = floatToDec18(params.initialCollateral);
    let initialLimitZCHF = floatToDec18(params.initialLimitZCHF);
    let duration = BigNumber.from(params.durationDays).mul(86_400);
    let challengePeriod = BigNumber.from(params.challengePeriodSeconds);
    let feesPPM = BigNumber.from(params.feesPercent * 1e4);
    let fliqPrice = floatToDec18(params.liqPriceCHF);
    let fReservePPM = BigNumber.from(params.reservePercent * 1e4);
    let fOpeningFeeZCHF = BigNumber.from(1000).mul(BigNumber.from(10).pow(18));

    // approvals
    let ZCHFContract = await ethers.getContractAt("Frankencoin", 
        fcDeployment.address);
    let CollateralContract = await ethers.getContractAt(params.name, 
        collateralDeployment.address);
    
    await CollateralContract.approve(mintingHubContract.address, fInitialCollateral,  { gasLimit: 1_000_000 });
    await ZCHFContract.approve(mintingHubContract.address, fOpeningFeeZCHF,  { gasLimit: 1_000_000 });
    
    let tx = await mintingHubContract.openPosition(collateralAddr, fMinCollateral, 
        fInitialCollateral, initialLimitZCHF, duration, challengePeriod, feesPPM, 
        fliqPrice, fReservePPM,  { gasLimit: 2_000_000 });

    await tx.wait();
    
    return tx;
}

const deploy: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
    if (deploymode!="pos") {
        return;
    }
    const paramFile = "paramsPositions.json";

    let chainId = hre.network.config["chainId"];
    let paramsArr = require(__dirname + `/../parameters/${paramFile}`);

    // find config for current chain
    for(var k=0; k<paramsArr.length; k++) {
        let params = paramsArr[k];
        if (chainId==params.chainId) {
            // deploy position according to parameters
            let tx = await deployPos(params, hre);
            console.log("Deployed position, tx =", tx);
        }
    }
};
export default deploy;

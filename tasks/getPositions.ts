import { getFlashbotDeploymentAddress } from '../scripts/utils/deployments';
import { task } from 'hardhat/config';
import { floatToDec18 } from '../scripts/utils/math';

// npx hardhat get-positions --network mainnet --owner <ADDRESS>
task('get-positions', 'Get positions owned by an account')
  .addParam('owner', 'The address of the owner')
  .setAction(async ({ owner }, hre) => {
    console.log(`> Checking positions owned by: ${owner}`);
    const { formatEther, formatUnits } = hre.ethers;

    // Get MintingHubGateway contract
    const [signer] = await hre.ethers.getSigners();
    const mintingHubGatewayAddress = await getFlashbotDeploymentAddress('mintingHubGateway');
    const mintingHubGateway = await hre.ethers.getContractAt('MintingHub', mintingHubGatewayAddress, signer);

    // Filter PositionOpened events, starting from block 22088283 (see deployments metadata)
    const positionOpenedEvent = mintingHubGateway.filters.PositionOpened(owner);
    const events = await mintingHubGateway.queryFilter(positionOpenedEvent, 22088283, 'latest');
    console.log(`> Found ${events.length} positions.\n`);

    await Promise.all(events.map(async (event) => {
      try {
        const position = await hre.ethers.getContractAt('Position', event.args.position);
        const collateral = await hre.ethers.getContractAt('ERC20', await position.collateral());

        const positionAddress = await position.getAddress();
        const price = await position.price();
        const virtualPrice = await position.virtualPrice();
        const isClosed = await position.isClosed();
        const fixedAnnualRatePPM = await position.fixedAnnualRatePPM();
        const reserveContribution = await position.reserveContribution();
        const principal = await position.principal();
        const interest = await position.getInterest();
        const collateralRequirement = await position.getCollateralRequirement();
        const collateralBalance = await collateral.balanceOf(positionAddress);
        const collateralDecimals = await collateral.decimals();
        const collateralSymbol = await collateral.symbol();
        const collateralValue = (collateralBalance * price) / floatToDec18(1);

        console.log(`Position:            ${positionAddress}`);
        console.log(`- Collateral:        ${formatUnits(collateralBalance, collateralDecimals)} ${collateralSymbol}`);
        console.log(`- Price:             ${formatUnits(price, 36n - collateralDecimals)} dEURO`);
        console.log(`- Collateral value:  ${formatEther(collateralValue)} dEURO`);
        // console.log(`- Principal: ${formatEther(principal)} dEURO`);
        // console.log(`- Interest: ${formatEther(interest)} dEURO`);
        // console.log(`- Virtual price: ${virtualPrice}`);
        // console.log(`- Fixed annual rate: ${fixedAnnualRatePPM} PPM`);
        // console.log(`- Reserve contribution: ${formatEther(reserveContribution)} dEURO`);
        // console.log(`- Collateral requirement: ${formatEther(collateralRequirement)} dEURO`);
        // console.log(`- Closed: ${isClosed}`);
        console.log('----------------------------');
      } catch (error) {
        console.error(`Error processing position ${event.args.position}:`, error);
      }
    }));
  });
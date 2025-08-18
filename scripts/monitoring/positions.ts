import { getTokenPrices } from '../utils/coingecko';
import { PositionState, ChallengeState, PositionStatus, RiskLevel, ChallengeStatus } from './types';
import monitorConfig from '../utils/monitorConfig';
import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { MintingHubGateway } from '../../typechain';
import { floatToDec18 } from '../utils/math';
import { batchedEventQuery } from '../utils/blockchain';

/**
 * Fetches all active positions with their states
 * @param mintingHub MintingHub contract
 * @param hre HardhatRuntimeEnvironment
 * @param collateralPriceConversionRate Optional conversion rate for collateral prices
 * @returns Array of PositionState
 */
export async function getPositions(
  mintingHub: MintingHubGateway,
  hre: HardhatRuntimeEnvironment,
  collateralPriceConversionRate?: number,
): Promise<PositionState[]> {
  const { formatUnits } = hre.ethers;
  
  const events = await batchedEventQuery(
    mintingHub,
    mintingHub.filters.PositionOpened(),
    monitorConfig.deploymentBlock,
  );
  
  const now = Date.now() / 1000;

  // Process all positions
  const positionsData: PositionState[] = [];
  const specialTokenPrice: { [key: string]: string } = {};
  await Promise.all(
    events.map(async (event, index) => {
      try {
        const position = await hre.ethers.getContractAt('Position', event.args.position);
        const original = await position.original();
        const collateral = await hre.ethers.getContractAt('ERC20Wrapper', await position.collateral());
        const created = (await event.getBlock()).timestamp;
        const start = await position.start();
        const cooldown = await position.cooldown();

        const owner = await position.owner();
        const address = await position.getAddress();
        const price = await position.price();
        const virtualPrice = await position.virtualPrice();
        const collateralRequirement = await position.getCollateralRequirement();
        const debt = await position.getDebt();
        const interest = await position.getInterest();
        const collateralBalance = await collateral.balanceOf(address);
        const collateralDecimals = await collateral.decimals();
        const collateralSymbol = await collateral.symbol();
        const collateralAddress = (await collateral.getAddress()).toLowerCase();
        const collateralValue = (collateralBalance * price) / floatToDec18(1);
        const collateralUtilization =
          collateralValue > 0 ? Number((debt * 100000n) / collateralValue) / Number(1000) : 0;
        const expiration = await position.expiration();
        const isClosed = await position.isClosed();
        const challengedAmount = await position.challengedAmount();
        const challengePeriod = await position.challengePeriod();
        const minimumCollateral = await position.minimumCollateral();
        const liveVirtualPrice = collateralBalance > 0 ? (collateralRequirement * 10n ** 18n) / collateralBalance : price;

        // WFPS & DEPS need direct market price fetching
        if (['WFPS', 'DEPS'].includes(collateralSymbol.toUpperCase()) && !specialTokenPrice[collateralAddress]) {
          const underlying = await collateral.underlying();
          const native = await hre.ethers.getContractAt('Equity', underlying);
          const nativePrice = await native.price();
          specialTokenPrice[collateralAddress] = formatUnits(nativePrice, collateralDecimals);
        }

        // Determine position state
        let state = PositionStatus.OPEN;
        if (now < Number(start)) {
          state = PositionStatus.PROPOSED;
        } else if (challengedAmount > 0n) {
          state = PositionStatus.CHALLENGED;
        } else if (now < Number(cooldown)) {
          state = PositionStatus.COOLDOWN;
        } else if (isClosed) {
          state = PositionStatus.CLOSED;
        } else if (Number(expiration) - now < monitorConfig.thresholds.positionExpirationWarning * 86400) {
          state = PositionStatus.EXPIRING;
        } else {
          state = PositionStatus.OPEN;
        }

        positionsData.push({
          created,
          start,
          state,
          cooldown,
          address,
          original,
          owner,
          collateralAddress,
          collateralSymbol,
          collateralDecimals,
          price,
          virtualPrice,
          collateralBalance,
          collateralValue,
          debt,
          interest,
          utilization: collateralUtilization,
          utilizationMarket: 100, // Default, lowered if market price is available
          expiration,
          isClosed,
          challengedAmount,
          challengePeriod,
          riskLevel: RiskLevel.LOW, // Default
          minimumCollateral,
          liveVirtualPrice,
        });
      } catch (error) {
        console.error(`Error processing position ${event.args.position}:`, error);
      }
    }),
  );

  // Get collateral market prices
  const collateralAddresses = Array.from(new Set(positionsData.map((position) => position.collateralAddress)));
  const marketPrices = {
    ...(await getTokenPrices(collateralAddresses, collateralPriceConversionRate)),
    ...specialTokenPrice,
  };
  positionsData.forEach((pos) => {
    const marketPrice = marketPrices[pos.collateralAddress];
    const virtualPrice = formatUnits(pos.liveVirtualPrice, 36n - pos.collateralDecimals);
    if (marketPrice) {
      if (Number(virtualPrice) > Number(marketPrice) && pos.state !== PositionStatus.CHALLENGED) {
        pos.state = PositionStatus.UNDERCOLLATERIZED;
      }
      pos.marketPrice = marketPrice;
      pos.utilizationMarket = (Number(marketPrice) * 100000) / Number(virtualPrice) / 1000;
    }

    // Update state and risk level
    if (
      pos.state === PositionStatus.CHALLENGED ||
      pos.state === PositionStatus.UNDERCOLLATERIZED ||
      (pos.utilizationMarket && pos.utilizationMarket > monitorConfig.thresholds.positionUtilizationCritical)
    ) {
      pos.riskLevel = RiskLevel.HIGH;
    } else if (
      pos.state === PositionStatus.EXPIRING ||
      pos.state === PositionStatus.COOLDOWN ||
      (pos.utilizationMarket && pos.utilizationMarket > monitorConfig.thresholds.positionUtilizationWarning)
    ) {
      pos.riskLevel = RiskLevel.MEDIUM;
    } else {
      pos.riskLevel = RiskLevel.LOW;
    }
  });

  return positionsData;
}

/**
 * Fetches all active challenges
 * @param mintingHub MintingHub contract
 * @param hre HardhatRuntimeEnvironment
 * @returns Array of ChallengeState
 */
export async function getChallenges(
  mintingHub: MintingHubGateway,
  hre: HardhatRuntimeEnvironment,
): Promise<ChallengeState[]> {
  try {
    let challengeIndex = 0;
    const challengesData: ChallengeState[] = [];
    while (challengeIndex < monitorConfig.limits.challenges) {
      try {
        const challenge = await mintingHub.challenges(challengeIndex);
        if (challenge.challenger === hre.ethers.ZeroAddress) {
          challengeIndex++;
          continue;
        }

        const position = await hre.ethers.getContractAt('Position', challenge.position);
        const challengeData = await position.challengeData();
        const liqPrice = challengeData.liqPrice;
        const collateral = await hre.ethers.getContractAt('ERC20', await position.collateral());
        const collateralSymbol = await collateral.symbol();
        const collateralDecimals = await collateral.decimals();
        const owner = await position.owner();
        const currentPrice = await mintingHub.price(challengeIndex);

        challengesData.push({
          id: challengeIndex,
          challenger: challenge.challenger,
          start: Number(challenge.start),
          position: challenge.position,
          collateralSymbol,
          size: hre.ethers.formatUnits(challenge.size, collateralDecimals),
          liqPrice: hre.ethers.formatUnits(liqPrice, 36n - collateralDecimals),
          currentPrice: hre.ethers.formatUnits(currentPrice, 36n - collateralDecimals),
          positionOwner: owner,
          status: Number(currentPrice) === 0 ? ChallengeStatus.EXPIRED : ChallengeStatus.ACTIVE,
          collateralAddress: await collateral.getAddress(),
        });

        challengeIndex++;
      } catch (error) {
        break;
      }
    }

    return challengesData;
  } catch (error) {
    console.error('Error fetching challenges:', error);
    return [];
  }
}

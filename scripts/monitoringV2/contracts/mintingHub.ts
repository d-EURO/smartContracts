import { Contract, ethers } from 'ethers';
import {
  PositionState,
  PositionCollateralState,
  ChallengeData,
  MintingHubState,
  MintingHubPositionOpenedEvent,
} from '../dto';
import { ERC20ABI } from '../../../exports/abis/utils/ERC20';
import { PositionV2ABI } from '../../../exports/abis/MintingHubV2/PositionV2';

export async function mintingHubState(
  mintingHub: Contract, 
  positionEvents: MintingHubPositionOpenedEvent[]
): Promise<MintingHubState> {
  // positions
  const validPositionEvents = positionEvents.filter(event => {
    if (!event.position || event.position === ethers.ZeroAddress) {
      console.warn(`\x1b[33mSkipping position event with invalid address: ${event.position}\x1b[0m`);
      return false;
    }
    return true;
  });
  const positions = await Promise.all(
    validPositionEvents.map((event) => getPositionState(event.position, mintingHub.runner!.provider!, event.timestamp)),
  );

  // collaterals
  const uniqueCollaterals = Array.from(
    new Set(positions.map((position) => position.collateralAddress)),
  );
  const collateralPromises = uniqueCollaterals.map((address) =>
    getPositionCollateralState(address, mintingHub.runner!.provider!),
  );
  const collaterals = await Promise.all(collateralPromises);

  // challenges
  const challenges = await getChallenges(mintingHub);

  return {
    positions,
    collaterals,
    challenges,
  };
}


export async function getPositionState(
  positionAddress: string,
  provider: ethers.Provider,
  created: number = 0,
): Promise<PositionState> {
  if (!positionAddress || positionAddress === ethers.ZeroAddress) {
    throw new Error(`\x1b[31mInvalid position address: ${positionAddress}\x1b[0m`);
  }
  
  const position = new ethers.Contract(positionAddress, PositionV2ABI, provider);

  const [
    owner,
    original,
    collateralAddress,
    price,
    virtualPrice,
    collateralRequirement,
    debt,
    interest,
    minimumCollateral,
    limit,
    principal,
    riskPremiumPPM,
    reserveContribution,
    fixedAnnualRatePPM,
    lastAccrual,
    start,
    cooldown,
    expiration,
    challengedAmount,
    challengePeriod,
    isClosed,
  ] = await Promise.all([
    position.owner(),
    position.original(),
    position.collateral(),
    position.price(),
    position.virtualPrice(),
    position.getCollateralRequirement(),
    position.getDebt(),
    position.getInterest(),
    position.minimumCollateral(),
    position.limit(),
    position.principal(),
    position.riskPremiumPPM(),
    position.reserveContribution(),
    position.fixedAnnualRatePPM(),
    position.lastAccrual(),
    position.start(),
    position.cooldown(),
    position.expiration(),
    position.challengedAmount(),
    position.challengePeriod(),
    position.isClosed(),
  ]);

  const collateral = new ethers.Contract(collateralAddress, ERC20ABI, provider);
  const collateralBalance = await collateral.balanceOf(positionAddress);

  return {
    address: positionAddress,
    owner,
    original,
    collateralAddress,
    collateralBalance,
    price,
    virtualPrice,
    collateralRequirement,
    debt,
    interest,
    minimumCollateral,
    limit,
    principal,
    riskPremiumPPM,
    reserveContribution,
    fixedAnnualRatePPM,
    lastAccrual,
    start,
    cooldown,
    expiration,
    challengedAmount,
    challengePeriod,
    isClosed,
    created,
  };
}

export async function getPositionCollateralState(
  collateralAddress: string,
  provider: ethers.Provider,
): Promise<PositionCollateralState> {
  if (!collateralAddress || collateralAddress === ethers.ZeroAddress) {
    throw new Error(`\x1b[31mInvalid collateral address: ${collateralAddress}\x1b[0m`);
  }
  
  const collateral = new ethers.Contract(collateralAddress, ERC20ABI, provider);

  const [address, name, symbol, decimals] = await Promise.all([
    collateral.getAddress(),
    collateral.name(),
    collateral.symbol(),
    collateral.decimals(),
  ]);

  return {
    address,
    name,
    symbol,
    decimals,
  };
}

export async function getChallenges(mintingHub: Contract, maxChallenges: number = 100): Promise<ChallengeData[]> {
  const challenges: ChallengeData[] = [];

  for (let i = 0; i < maxChallenges; i++) {
    try {
      const challenge = await mintingHub.challenges(i); // throws if out of bounds
      if (challenge.challenger === ethers.ZeroAddress) continue;
      
      const position = new ethers.Contract(challenge.position, PositionV2ABI, mintingHub.runner);
      const [collateralAddress, positionOwner] = await Promise.all([
        position.collateral(),
        position.owner(),
      ]);
      
      // Get challenge data and current price
      const challengeData = await position.challengeData();
      const liqPrice = challengeData.liqPrice;
      const phase = Number(challengeData.phase);
      const currentPrice = await mintingHub.price(i);

      challenges.push({
        id: i,
        challenger: challenge.challenger,
        position: challenge.position,
        start: Number(challenge.start),
        size: challenge.size,
        collateralAddress,
        liqPrice,
        phase,
        currentPrice,
        positionOwner,
      });
    } catch (error) {
      break;
    }
  }

  return challenges;
}
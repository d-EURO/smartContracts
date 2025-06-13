import { Contract, ethers, ZeroAddress } from 'ethers';
import { PositionState, MintingHubPositionOpenedEvent } from '../dto';
import { ERC20ABI, PositionV2ABI } from '@deuro/eurocoin';

export async function getPositionsState(
  mintingHub: Contract,
  activePositionAddresses: string[],
  positionOpenedEvents: MintingHubPositionOpenedEvent[],
): Promise<PositionState[]> {
  return Promise.all([
    ...activePositionAddresses.map((a) => getPositionState(a, mintingHub)),
    ...positionOpenedEvents.map((e) => getPositionState(e.position, mintingHub, e.timestamp)),
  ]);
}

export async function getPositionState(
  positionAddress: string,
  mintingHub: Contract,
  created?: number,
): Promise<PositionState> {
  if (!positionAddress || positionAddress === ZeroAddress) {
    throw new Error(`\x1b[31mInvalid position address: ${positionAddress}\x1b[0m`);
  }

  const provider = mintingHub.runner!.provider!;
  const position = new ethers.Contract(positionAddress, PositionV2ABI, provider);

  const [
    owner,
    original,
    collateralAddress,
    price,
    virtualPrice,
    expiredPurchasePrice,
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
    mintingHub.expiredPurchasePrice(positionAddress),
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
    expiredPurchasePrice,
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

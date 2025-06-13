import { ethers } from 'ethers';
import { CollateralState, MintingHubPositionOpenedEvent } from '../dto';
import { ERC20ABI } from '@deuro/eurocoin';

export async function getCollateralState(
  positionOpenedEvents: MintingHubPositionOpenedEvent[],
  provider: ethers.Provider,
): Promise<CollateralState[]> {
  return Promise.all(positionOpenedEvents.map((e) => getSingleCollateralState(e.collateral, provider)));
}

async function getSingleCollateralState(collateralAddress: string, provider: ethers.Provider): Promise<CollateralState> {
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

import { Contract } from 'ethers';
import { MintingHubState } from '../dto';

export async function getMintingHubState(mintingHub: Contract): Promise<MintingHubState> {
  const [openingFee, challengerReward, expiredPriceFactor, positionFactory, deuro, positionRoller, rate] =
    await Promise.all([
      mintingHub.openingFee(),
      mintingHub.challengerReward(),
      mintingHub.expiredPriceFactor(),
      mintingHub.positionFactory(),
      mintingHub.dEURO(),
      mintingHub.positionRoller(),
      mintingHub.rate(),
    ]);

  return {
    openingFee,
    challengerReward,
    expiredPriceFactor,
    positionFactory,
    deuro,
    positionRoller,
    rate,
  };
}

import { Contract, ethers } from 'ethers';
import { ChallengeState } from '../dto';
import { PositionV2ABI } from '@deuro/eurocoin';

export async function getChallengesState(mintingHub: Contract): Promise<ChallengeState[]> {
  const challenges: ChallengeState[] = [];
  let i = 0;
  // Avoid infinite loop
  // Slow if many challenges
  // TODO: Improve by only fetching active challenges
  while (i < 100000) {
    try {
      const challenge = await mintingHub.challenges(i); // throws if out of bounds
      if (challenge.challenger === ethers.ZeroAddress) {
        i++;
        continue;
      }

      const position = new ethers.Contract(challenge.position, PositionV2ABI, mintingHub.runner);
      const [collateralAddress, positionOwner, challengeData, currentPrice] = await Promise.all([
        position.collateral(),
        position.owner(),
        position.challengeData(),
        mintingHub.price(i),
      ]);

      challenges.push({
        id: i,
        challenger: challenge.challenger,
        position: challenge.position,
        start: Number(challenge.start),
        size: challenge.size,
        collateralAddress,
        liqPrice: challengeData.liqPrice,
        phase: Number(challengeData.phase),
        currentPrice,
        positionOwner,
      });

      i++;
    } catch (error) {
      break;
    }
  }

  return challenges;
}

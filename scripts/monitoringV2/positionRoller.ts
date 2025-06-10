import { ethers } from 'ethers';
import { fetchEvents } from './utils';
import { RollEvent, PositionRollerState } from './dto/positionRoller.dto';

export async function positionRollerState(
  contract: ethers.Contract,
): Promise<PositionRollerState> {
  const rollEvents = await fetchEvents<RollEvent>(
    contract,
    contract.filters.Roll()
  );

  return {
    rollEvents,
  };
}
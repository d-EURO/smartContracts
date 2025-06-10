import { ethers } from 'ethers';
import { PositionRollerState } from './dto';

export async function positionRollerState(
  contract: ethers.Contract,
): Promise<PositionRollerState> {
  const address = await contract.getAddress();
  
  return {
    address,
  };
}
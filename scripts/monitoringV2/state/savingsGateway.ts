import { ethers } from 'ethers';
import { SavingsGatewayState } from '../dto/savingsGateway.dto';

export async function getSavingsGatewayState(
  savingsContract: ethers.Contract,
  deuroContract: ethers.Contract
): Promise<SavingsGatewayState> {
  const address = await savingsContract.getAddress();
  const currentRatePPM = await savingsContract.currentRatePPM();
  const nextRatePPM = await savingsContract.nextRatePPM();
  const nextChange = await savingsContract.nextChange();
  const gatewayAddress = await savingsContract.GATEWAY();
  const equityAddress = await savingsContract.equity();
  const deuroAddress = await deuroContract.getAddress();
  const totalSavings = await deuroContract.balanceOf(address);
  const currentTicks = await savingsContract.currentTicks();


  return {
    address,
    currentRatePPM,
    nextRatePPM,
    nextChange,
    gatewayAddress,
    equityAddress,
    deuroAddress,
    totalSavings,
    currentTicks,
  };
}
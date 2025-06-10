import { ethers } from 'ethers';
import { SavingsGatewayStateExtended } from './dto/savingsGateway.dto';
import { 
  SavedEvent, 
  InterestCollectedEvent, 
  WithdrawnEvent, 
  RateProposedEvent, 
  RateChangedEvent 
} from './dto/event.dto';
import { fetchEvents } from './utils';

export async function savingsGatewayState(
  savingsContract: ethers.Contract,
  deuroContract: ethers.Contract
): Promise<SavingsGatewayStateExtended> {
  const address = await savingsContract.getAddress();
  const currentRatePPM = await savingsContract.currentRatePPM();
  const nextRatePPM = await savingsContract.nextRatePPM();
  const nextChange = await savingsContract.nextChange();
  const hasPendingChange = currentRatePPM !== nextRatePPM;
  const gatewayAddress = await savingsContract.GATEWAY();
  const equityAddress = await savingsContract.equity();
  const deuroAddress = await deuroContract.getAddress();
  const totalSavings = await deuroContract.balanceOf(address);
  const currentTicks = await savingsContract.currentTicks();

  const savedEvents = await fetchEvents<SavedEvent>(savingsContract, savingsContract.filters.Saved());
  const interestCollectedEvents = await fetchEvents<InterestCollectedEvent>(savingsContract, savingsContract.filters.InterestCollected());
  const withdrawnEvents = await fetchEvents<WithdrawnEvent>(savingsContract, savingsContract.filters.Withdrawn());
  const rateProposedEvents = await fetchEvents<RateProposedEvent>(savingsContract, savingsContract.filters.RateProposed());
  const rateChangedEvents = await fetchEvents<RateChangedEvent>(savingsContract, savingsContract.filters.RateChanged());

  return {
    address,
    currentRatePPM,
    nextRatePPM,
    nextChange,
    hasPendingChange,
    gatewayAddress,
    equityAddress,
    deuroAddress,
    totalSavings,
    currentTicks,
    savedEvents,
    interestCollectedEvents,
    withdrawnEvents,
    rateProposedEvents,
    rateChangedEvents,
  };
}
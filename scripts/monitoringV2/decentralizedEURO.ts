import { Contract, ethers, formatEther, ZeroAddress } from 'ethers';
import monitorConfig from '../utils/monitorConfig';
import { batchedEventQuery } from '../utils/blockchain';
import { DecentralizedEuroStateExtended } from './dto/deuro.dto';
import { 
  BaseEvent,
  TransferEvent, 
  LossEvent, 
  ProfitEvent, 
  MinterAppliedEvent, 
  MinterDeniedEvent, 
  ProfitDistributedEvent
} from './dto/event.dto';


export async function decentralizedEuroState(contract: ethers.Contract): Promise<DecentralizedEuroStateExtended> {
  const address = await contract.getAddress();
  const name = await contract.name();
  const symbol = await contract.symbol();
  const decimals = await contract.decimals();
  const totalSupply = await contract.totalSupply();
  const equityAddress = await contract.reserve();
  const reserveBalance = await contract.balanceOf(equityAddress);
  const minterReserve = await contract.minterReserve();
  const equity = await contract.equity();
  const minApplicationPeriod = await contract.MIN_APPLICATION_PERIOD();
  const minApplicationFee = await contract.MIN_FEE();

  const transferEvents = await fetchEvents<TransferEvent>(contract, contract.filters.Transfer());
  const lossEvents = await fetchEvents<LossEvent>(contract, contract.filters.Loss());
  const profitEvents = await fetchEvents<ProfitEvent>(contract, contract.filters.Profit());
  const minterAppliedEvents = await fetchEvents<MinterAppliedEvent>(contract, contract.filters.MinterApplied());
  const minterDeniedEvents = await fetchEvents<MinterDeniedEvent>(contract, contract.filters.MinterDenied());
  const profitsDistributedEvents = await fetchEvents<ProfitDistributedEvent>(contract, contract.filters.ProfitDistributed());

  return {
    address,
    name,
    symbol,
    decimals,
    totalSupply,
    reserveBalance,
    minterReserve,
    equity,
    equityAddress,
    minApplicationPeriod,
    minApplicationFee,
    transferEvents,
    lossEvents,
    profitEvents,
    minterAppliedEvents,
    minterDeniedEvents,
    profitsDistributedEvents,
  };
}

async function fetchEvents<T extends BaseEvent>(
  contract: Contract,
  eventFilter: any
): Promise<T[]> {
  const events = await batchedEventQuery(contract, eventFilter, monitorConfig.deploymentBlock);
  const processedEvents: T[] = [];
  
  for (const event of events) {
    const block = await event.getBlock();
    processedEvents.push({
      ...event.args,
      txHash: event.transactionHash,
      timestamp: block.timestamp,
    } as T);
  }
  
  return processedEvents.sort((a, b) => b.timestamp - a.timestamp);
}
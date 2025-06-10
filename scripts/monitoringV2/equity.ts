import { ethers } from 'ethers';
import { EquityStateExtended } from './dto/equity.dto';
import { TradeEvent, DelegationEvent } from './dto/event.dto';
import { fetchEvents } from './utils';

export async function equityState(contract: ethers.Contract): Promise<EquityStateExtended> {
  const address = await contract.getAddress();
  const name = await contract.name();
  const symbol = await contract.symbol();
  const decimals = await contract.decimals();
  const totalSupply = await contract.totalSupply();
  const price = await contract.price();
  const marketCap = (BigInt(price) * totalSupply) / 10n ** 18n;
  const totalVotes = await contract.totalVotes();
  const dEuroAddress = await contract.dEURO();
  const valuationFactor = await contract.VALUATION_FACTOR();
  const minHoldingDuration = await contract.MIN_HOLDING_DURATION();
  const quorum = await contract.QUORUM();

  const tradeEvents = await fetchEvents<TradeEvent>(contract, contract.filters.Trade());
  const delegationEvents = await fetchEvents<DelegationEvent>(contract, contract.filters.Delegation());

  return {
    address,
    name,
    symbol,
    decimals,
    totalSupply,
    price,
    marketCap,
    totalVotes,
    dEuroAddress,
    valuationFactor,
    minHoldingDuration,
    quorum,
    tradeEvents,
    delegationEvents,
  };
}


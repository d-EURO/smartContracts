import { ethers } from 'ethers';
import { EquityState } from '../dto';

export async function getEquityState(contract: ethers.Contract): Promise<EquityState> {
  const address = await contract.getAddress();
  const name = await contract.name();
  const symbol = await contract.symbol();
  const decimals = await contract.decimals();
  const totalSupply = await contract.totalSupply();
  const price = await contract.price();
  const totalVotes = await contract.totalVotes();
  const dEuroAddress = await contract.dEURO();
  const valuationFactor = await contract.VALUATION_FACTOR();
  const minHoldingDuration = await contract.MIN_HOLDING_DURATION();
  
  return {
    address,
    name,
    symbol,
    decimals,
    totalSupply,
    price,
    totalVotes,
    dEuroAddress,
    valuationFactor,
    minHoldingDuration,
  };
}


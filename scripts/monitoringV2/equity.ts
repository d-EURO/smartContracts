import { ethers } from 'ethers';
import { EquityState } from './dto/equity.dto';

export async function equityState(contract: ethers.Contract): Promise<EquityState> {
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
  };
}


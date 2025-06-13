import { ethers } from 'ethers';
import { DecentralizedEuroState } from '../dto';

export async function getDecentralizedEuroState(contract: ethers.Contract): Promise<DecentralizedEuroState> {
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
  };
}

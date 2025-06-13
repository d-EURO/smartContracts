import { ethers } from 'ethers';
import { DEPSWrapperState } from '../dto';
import { EquityABI } from '@deuro/eurocoin';

export async function getDepsWrapperState(contract: ethers.Contract): Promise<DEPSWrapperState> {
  const address = await contract.getAddress();
  const name = await contract.name();
  const symbol = await contract.symbol();
  const decimals = await contract.decimals();
  const totalSupply = await contract.totalSupply();
  const underlyingAddress = await contract.underlying();
  const underlyingContract = new ethers.Contract(underlyingAddress, EquityABI, contract.runner);
  const underlyingSymbol = await underlyingContract.symbol();

  return {
    address,
    name,
    symbol,
    decimals,
    totalSupply,
    underlyingAddress,
    underlyingSymbol,
  };
}

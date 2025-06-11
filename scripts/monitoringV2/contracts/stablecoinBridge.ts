import { ethers } from 'ethers';
import { Bridge, StablecoinBridgeState } from '../dto/stablecoinBridge.dto';
import { ERC20ABI } from '@deuro/eurocoin';

export async function stablecoinBridgeState(
  contract: ethers.Contract,
  bridgeType: Bridge,
): Promise<StablecoinBridgeState> {
  const address = await contract.getAddress();
  const dEuroAddress = await contract.dEURO();
  const limit = await contract.limit();
  const minted = await contract.minted();
  const horizon = await contract.horizon();
  const eurAddress = await contract.eur();
  const eurContract = new ethers.Contract(eurAddress, ERC20ABI, contract.runner);
  const eurSymbol = await eurContract.symbol();
  const eurDecimals = await eurContract.decimals();

  return {
    bridgeType,
    address,
    eurAddress,
    eurSymbol,
    eurDecimals,
    dEuroAddress,
    limit,
    minted,
    horizon,
  };
}

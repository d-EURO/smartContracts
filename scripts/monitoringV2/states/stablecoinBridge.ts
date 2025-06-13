import { ethers } from 'ethers';
import { Bridge, StablecoinBridgeState } from '../dto';
import { ADDRESS, ERC20ABI, StablecoinBridgeABI } from '@deuro/eurocoin';

// TODO: Would it be possible to identify Bridges by their ABI and simply filter them from the
// set of active minters? This way we don't have to make any changes when a new bridge is deployed.
export async function getStablecoinBridgesStates(
  provider: ethers.Provider,
  blockchainId: number,
): Promise<StablecoinBridgeState[]> {
  const bridges = Object.values(Bridge);
  return Promise.all(
    bridges.map(async (bridge) => {
      const bridgeAddress = ADDRESS[blockchainId][bridge as keyof (typeof ADDRESS)[1]];
      const bridgeContract = new ethers.Contract(bridgeAddress, StablecoinBridgeABI, provider);
      return getStablecoinBridgeState(bridgeContract, bridge);
    }),
  );
}

async function getStablecoinBridgeState(contract: ethers.Contract, bridgeType: Bridge): Promise<StablecoinBridgeState> {
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

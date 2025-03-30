import { ethers } from 'ethers';
import { BridgeState, HealthStatus } from './types';
import monitorConfig from '../utils/monitorConfig';
import { StablecoinBridge } from '../../typechain';
import { HardhatEthersProvider } from '@nomicfoundation/hardhat-ethers/internal/hardhat-ethers-provider';
import { Time } from './utils';

/**
 * Fetches the state of a StablecoinBridge contract
 * @param bridge StablecoinBridge contract
 * @param name Bridge name
 * @param provider Ethers provider
 * @returns BridgeState
 */
export async function getBridgeState(
  bridge: StablecoinBridge,
  name: string,
  provider: HardhatEthersProvider,
): Promise<BridgeState> {
  const address = await bridge.getAddress();
  const eur = await bridge.eur();
  const eurContract = new ethers.Contract(eur, ['function symbol() view returns (string)'], provider);
  const eurSymbol = await eurContract.symbol();
  const limit = await bridge.limit();
  const minted = await bridge.minted();
  const horizon = await bridge.horizon();

  const utilizationPercentage = Number((minted * BigInt(10000)) / limit) / 100;
  const daysToExpiry = Time.daysLeft(Number(horizon));

  let status = HealthStatus.HEALTHY;
  if (
    utilizationPercentage > monitorConfig.thresholds.bridgeUtilizationCritical ||
    daysToExpiry < monitorConfig.thresholds.bridgeExpirationCritical
  ) {
    status = HealthStatus.CRITICAL;
  } else if (
    utilizationPercentage > monitorConfig.thresholds.bridgeUtilizationWarning ||
    daysToExpiry < monitorConfig.thresholds.bridgeExpirationWarning
  ) {
    status = HealthStatus.WARNING;
  }

  return {
    name,
    address,
    eur,
    symbol: eurSymbol,
    limit,
    minted,
    utilization: utilizationPercentage,
    horizon,
    status,
  };
}

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
  const usd = await bridge.usd();
  const usdContract = new ethers.Contract(usd, ['function symbol() view returns (string)'], provider);
  const usdSymbol = await usdContract.symbol();
  const limit = await bridge.limit();
  const minted = await bridge.minted();
  const horizon = await bridge.horizon();

  const utilizationPercentage = Number((minted * BigInt(10000)) / limit) / 100;
  const daysToExpiry = Time.daysLeft(Number(horizon));

  let expirationStatus = HealthStatus.HEALTHY;
  if (daysToExpiry === 0) {
    expirationStatus = minted > 0 ? HealthStatus.EXPIRED : HealthStatus.CLOSED;
  } else if (daysToExpiry < monitorConfig.thresholds.bridgeExpirationCritical) {
    expirationStatus = HealthStatus.CRITICAL;
  } else if (daysToExpiry < monitorConfig.thresholds.bridgeExpirationWarning) {
    expirationStatus = HealthStatus.WARNING;
  }

  let utilizationStatus = HealthStatus.HEALTHY;
  if (utilizationPercentage > monitorConfig.thresholds.bridgeUtilizationCritical) {
    utilizationStatus = HealthStatus.CRITICAL;
  } else if (utilizationPercentage > monitorConfig.thresholds.bridgeUtilizationWarning) {
    utilizationStatus = HealthStatus.WARNING;
  } else if (expirationStatus === HealthStatus.CLOSED) {
    utilizationStatus = HealthStatus.CLOSED;
  }

  return {
    name,
    address,
    usd,
    symbol: usdSymbol,
    limit,
    minted,
    utilization: utilizationPercentage,
    horizon,
    expirationStatus,
    utilizationStatus,
  };
}

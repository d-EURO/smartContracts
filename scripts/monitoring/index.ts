import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { MonitoringModule } from './module';

let instance: MonitoringModule | null = null;
let initPromise: Promise<MonitoringModule> | null = null;
let isInitializing = false;

/**
 * Gets a singleton instance of the MonitoringModule
 * @param hre HardhatRuntimeEnvironment
 * @returns Initialized MonitoringModule instance
 */
export async function getMonitoringModule(hre: HardhatRuntimeEnvironment): Promise<MonitoringModule> {
  if (instance) {
    return instance;
  } else if (isInitializing && initPromise) {
    return initPromise;
  }

  isInitializing = true;
  initPromise = (async () => {
    const module = new MonitoringModule(hre);
    instance = await module.init();
    isInitializing = false;
    return instance;
  })();

  return initPromise;
}

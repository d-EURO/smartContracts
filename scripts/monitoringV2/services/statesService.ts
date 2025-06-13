import { ethers } from 'ethers';
import { MintingHubPositionOpenedEvent, SystemStateData, ContractSet } from '../dto';
import { db } from '../database/client';
import { statePersistence } from '../database/statePersistence';
import {
  getStablecoinBridgesStates,
  getChallengesState,
  getCollateralState,
  getDecentralizedEuroState,
  getDepsWrapperState,
  getEquityState,
  getFrontendGatewayState,
  getMintingHubState,
  getPositionsState,
  getSavingsGatewayState,
} from '../states';

export class StatesService {
  constructor(
    private contracts: ContractSet,
    private provider: ethers.Provider,
    private blockchainId: number,
  ) {}

  async getSystemState(positionEvents: MintingHubPositionOpenedEvent[]): Promise<SystemStateData> {
    console.log(`\x1b[33mFetching complete system state...\x1b[0m`);
    const systemState = await this.getSystemStateData(positionEvents);
    await this.persistSystemState(systemState);
    console.log(`\x1b[32mSystem state fetched and persisted successfully\x1b[0m`);
    return systemState;
  }

  private async getSystemStateData(positionEvents: MintingHubPositionOpenedEvent[]): Promise<SystemStateData> {
    const activePositionAddresses: string[] = await db.getActivePositionAddresses();

    const results = await Promise.allSettled([
      getDecentralizedEuroState(this.contracts.deuroContract),
      getEquityState(this.contracts.equityContract),
      getDepsWrapperState(this.contracts.depsContract),
      getSavingsGatewayState(this.contracts.savingsContract, this.contracts.deuroContract),
      getFrontendGatewayState(this.contracts.frontendGatewayContract),
      getMintingHubState(this.contracts.mintingHubContract),
      getPositionsState(this.contracts.mintingHubContract, activePositionAddresses, positionEvents),
      getChallengesState(this.contracts.mintingHubContract),
      getCollateralState(positionEvents, this.provider),
      getStablecoinBridgesStates(this.provider, this.blockchainId),
    ]);

    const [
      deuroState,
      equityState,
      depsState,
      savingsState,
      frontendState,
      mintingHubState,
      positionsState,
      challengesState,
      collateralState,
      bridgeStates,
    ] = results.map((result, index) => {
      if (result.status === 'fulfilled') return result.value;
      console.error(`\x1b[31mState fetch failed for index ${index}:`, result.reason, '\x1b[0m');
      return null;
    });

    return {
      deuroState,
      equityState,
      depsState,
      savingsState,
      frontendState,
      mintingHubState,
      positionsState,
      challengesState,
      collateralState,
      bridgeStates,
    } as SystemStateData;
  }

  private async persistSystemState(systemState: SystemStateData): Promise<void> {
    console.log('\x1b[32mPersisting system state to database...\x1b[0m');
    await statePersistence.persistAllSystemState(systemState);
    console.log('\x1b[32mSystem state persisted successfully\x1b[0m');
  }
}

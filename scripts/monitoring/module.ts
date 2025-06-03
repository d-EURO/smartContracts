import { getDeploymentAddresses } from '../utils/deployments';
import { getSavingsGatewayState } from './savingsGateway';
import { getChallenges, getPositions } from './positions';
import { HardhatRuntimeEnvironment } from 'hardhat/types';
import {
  BridgeState,
  DEPSWrapperState,
  DecentralizedEuroState,
  DeploymentAddresses,
  DeploymentContracts,
  EquityState,
  PositionState,
  SavingsGatewayState,
} from './types';
import monitorConfig from '../utils/monitorConfig';
import { getDecentralizedEuroState } from './decentralizedEURO';
import { getEquityState } from './equity';
import { getBridgeState } from './stablecoinBridge';
import { getDEPSWrapperState } from './depsWrapper';
import { getUsdToEur } from '../utils/coingecko';
import { colors } from '../utils/table';

// A unified interface for all monitoring functions
export class MonitoringModule {
  private hre: HardhatRuntimeEnvironment;
  private deployment: DeploymentAddresses;
  private contracts: DeploymentContracts = {} as DeploymentContracts;
  private usdToEuroRate: number = 0; 

  constructor(hre: HardhatRuntimeEnvironment) {
    this.hre = hre;
    this.deployment = getDeploymentAddresses();
  }

  async init() {
    await this.getUSDToEuroRate();
    await this.initializeContracts();
    return this;
  }

  private async getUSDToEuroRate() {
    this.usdToEuroRate = await getUsdToEur();
    console.log(`${colors.yellow}> Current EUR/USD exchange rate applied to market prices: ${this.usdToEuroRate}${colors.reset}`);
  }

  /**
   * Initializes contract instances
   */
  private async initializeContracts() {
    const { getContractAt, getSigners } = this.hre.ethers;
    const [signer] = await getSigners();

    this.contracts.decentralizedEURO = await getContractAt(
      'DecentralizedEURO',
      this.deployment.decentralizedEURO,
      signer,
    );
    this.contracts.equity = await getContractAt('Equity', this.deployment.equity, signer);
    this.contracts.mintingHubGateway = await getContractAt(
      'MintingHubGateway',
      this.deployment.mintingHubGateway,
      signer,
    );
    this.contracts.savingsGateway = await getContractAt('SavingsGateway', this.deployment.savingsGateway, signer);
    this.contracts.depsWrapper = await getContractAt('DEPSWrapper', this.deployment.depsWrapper, signer);
    for (const bridge of monitorConfig.bridges) {
      this.contracts[bridge] = await getContractAt('StablecoinBridge', this.deployment[bridge], signer);
    }
  }

  /**
   * Gets the state of the DEPSWrapper contract
   * @returns DEPSWrapperState
   */
  async getDEPSWrapperState(): Promise<DEPSWrapperState> {
    return getDEPSWrapperState(this.contracts.depsWrapper);
  }

  /**
   * Gets the state of the DecentralizedEURO contract
   * @returns DecentralizedEuroState
   */
  async getDecentralizedEuroState(): Promise<DecentralizedEuroState> {
    return getDecentralizedEuroState(this.contracts.decentralizedEURO);
  }

  /**
   * Gets the state of the Equity contract
   * @returns EquityState
   */
  async getEquityState(): Promise<EquityState> {
    return getEquityState(this.contracts.equity);
  }

  /**
   * Gets the state of the Savings Gateway contract
   * @returns SavingsGatewayState
   */
  async getSavingsGatewayState(): Promise<SavingsGatewayState> {
    return getSavingsGatewayState(this.contracts.savingsGateway, this.contracts.decentralizedEURO);
  }

  /**
   * Gets bridge states
   * @returns Array of BridgeState
   */
  async getBridgeStates(): Promise<BridgeState[]> {
    return Promise.all(
      monitorConfig.bridges.map((name) => getBridgeState(this.contracts[name], name, this.hre.ethers.provider)),
    );
  }

  /**
   * Gets all positions
   * @returns Array of PositionState
   */
  async getPositions(): Promise<PositionState[]> {
    return getPositions(this.contracts.mintingHubGateway, this.hre, this.usdToEuroRate);
  }

  /**
   * Gets all active challenges
   * @returns Array of challenges
   * // TODO: Integrate into monitoring
   */
  async getChallenges() {
    return getChallenges(this.contracts.mintingHubGateway, this.hre);
  }

  /**
   * Gets complete system state
   * @returns Complete system state
   */
  async getCompleteSystemState() {
    console.log('🔄 Starting complete system state collection...');
    
    console.log('📊 Fetching dEURO state...');
    const decentralizedEurotate = await this.getDecentralizedEuroState();
    console.log('✅ dEURO state complete');
    
    console.log('📊 Fetching equity state...');
    const equityState = await this.getEquityState();
    console.log('✅ Equity state complete');
    
    console.log('📊 Fetching DEPS wrapper state...');
    const depsWrapperState = await this.getDEPSWrapperState();
    console.log('✅ DEPS wrapper state complete');
    
    console.log('📊 Fetching savings gateway state...');
    const savingsGatewayState = await this.getSavingsGatewayState();
    console.log('✅ Savings gateway state complete');
    
    console.log('📊 Fetching bridge states...');
    const bridgeStates = await this.getBridgeStates();
    console.log('✅ Bridge states complete');
    
    console.log('📊 Fetching positions...');
    const positions = await this.getPositions();
    console.log('✅ Positions complete');
    
    console.log('📊 Fetching challenges...');
    const challenges = await this.getChallenges();
    console.log('✅ Challenges complete');

    console.log('🎉 All system state collection complete!');

    return {
      decentralizedEurotate,
      equityState,
      depsWrapperState,
      savingsGatewayState,
      bridgeStates,
      positions,
      challenges,
    };
  }
}

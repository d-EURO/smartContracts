import { getDeploymentAddresses } from '../utils/deployments';
import { getSavingsGatewayState } from './savingsGateway';
import { getChallenges, getPositions } from './positions';
import { HardhatRuntimeEnvironment } from 'hardhat/types';
import {
  BridgeState,
  JuiceDollarState,
  DeploymentAddresses,
  DeploymentContracts,
  EquityState,
  PositionState,
  SavingsGatewayState,
} from './types';
import monitorConfig from '../utils/monitorConfig';
import { getJuiceDollarState } from './juiceDollar';
import { getEquityState } from './equity';
import { getBridgeState } from './stablecoinBridge';

// A unified interface for all monitoring functions
export class MonitoringModule {
  private hre: HardhatRuntimeEnvironment;
  private deployment: DeploymentAddresses;
  private contracts: DeploymentContracts = {} as DeploymentContracts;

  constructor(hre: HardhatRuntimeEnvironment) {
    this.hre = hre;
    this.deployment = getDeploymentAddresses();
  }

  async init() {
    await this.initializeContracts();
    return this;
  }

  /**
   * Initializes contract instances
   */
  private async initializeContracts() {
    const { getContractAt, getSigners } = this.hre.ethers;
    const [signer] = await getSigners();

    this.contracts.juiceDollar = await getContractAt(
      'JuiceDollar',
      this.deployment.juiceDollar,
    );
    this.contracts.juiceDollar = this.contracts.juiceDollar.connect(signer);
    this.contracts.equity = await getContractAt('Equity', this.deployment.equity);
    this.contracts.equity = this.contracts.equity.connect(signer);
    this.contracts.mintingHubGateway = await getContractAt(
      'MintingHubGateway',
      this.deployment.mintingHubGateway,
    );
    this.contracts.mintingHubGateway = this.contracts.mintingHubGateway.connect(signer);
    this.contracts.savingsGateway = await getContractAt('SavingsGateway', this.deployment.savingsGateway);
    this.contracts.savingsGateway = this.contracts.savingsGateway.connect(signer);
    for (const bridge of monitorConfig.bridges) {
      this.contracts[bridge] = await getContractAt('StablecoinBridge', this.deployment[bridge]);
      this.contracts[bridge] = this.contracts[bridge].connect(signer);
    }
  }

  /**
   * Gets the state of the JuiceDollar contract
   * @returns JuiceDollarState
   */
  async getJuiceDollarState(): Promise<JuiceDollarState> {
    return getJuiceDollarState(this.contracts.juiceDollar);
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
    return getSavingsGatewayState(this.contracts.savingsGateway, this.contracts.juiceDollar);
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
    return getPositions(this.contracts.mintingHubGateway, this.hre);
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
    const juiceDollarState = await this.getJuiceDollarState();
    const equityState = await this.getEquityState();
    const savingsGatewayState = await this.getSavingsGatewayState();
    const bridgeStates = await this.getBridgeStates();
    const positions = await this.getPositions();
    const challenges = await this.getChallenges();

    return {
      juiceDollarState,
      equityState,
      savingsGatewayState,
      bridgeStates,
      positions,
      challenges,
    };
  }
}

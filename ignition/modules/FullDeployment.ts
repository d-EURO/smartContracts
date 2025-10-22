import { buildModule } from '@nomicfoundation/hardhat-ignition/modules';
import JuiceDollarModule from './JuiceDollar';
import FrontendGatewayModule from './FrontendGateway';
import MintingHubGatewayModule from './MintingHubGateway';
import PositionFactoryModule from './PositionFactory';
import PositionRollerModule from './PositionRoller';
import SavingsGatewayModule from './SavingsGateway';
import StablecoinBridgeUSDT from './StablecoinBridgeUSDT';

export default buildModule('FullDeployment', (m) => {
  const { juiceDollar } = m.useModule(JuiceDollarModule);
  const { positionFactory } = m.useModule(PositionFactoryModule);
  const { positionRoller } = m.useModule(PositionRollerModule);
  const { stablecoinBridgeUSDT } = m.useModule(StablecoinBridgeUSDT);
  const { frontendGateway } = m.useModule(FrontendGatewayModule);
  const { savingsGateway } = m.useModule(SavingsGatewayModule);
  const { mintingHubGateway } = m.useModule(MintingHubGatewayModule);

  // 1. Initialize the frontend gateway
  m.call(frontendGateway, 'init', [savingsGateway, mintingHubGateway], { id: 'FrontendGateway_init' });

  // 2. Initialize minters
  m.call(juiceDollar, 'initialize', [mintingHubGateway, 'MintingHubGateway'], {
    id: 'JuiceDollar_initialize_MintingHubGateway',
  });
  m.call(juiceDollar, 'initialize', [positionRoller, 'PositionRoller'], {
    id: 'JuiceDollar_initialize_PositionRoller',
  });
  m.call(juiceDollar, 'initialize', [savingsGateway, 'SavingsGateway'], {
    id: 'JuiceDollar_initialize_SavingsGateway',
  });
  m.call(juiceDollar, 'initialize', [frontendGateway, 'FrontendGateway'], {
    id: 'JuiceDollar_initialize_FrontendGateway',
  });
  m.call(juiceDollar, 'initialize', [stablecoinBridgeUSDT, 'StablecoinBridgeUSDT'], {
    id: 'JuiceDollar_initialize_StablecoinBridgeUSDT',
  });

  // TODO: Mint some JUSD to close initialisation phase (IMPORTANT!)

  return {
    juiceDollar,
    positionFactory,
    positionRoller,
    stablecoinBridgeUSDT,
    frontendGateway,
    savingsGateway,
    mintingHubGateway,
  };
});

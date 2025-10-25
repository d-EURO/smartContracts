import { buildModule } from '@nomicfoundation/hardhat-ignition/modules';
import JuiceDollarModule from './JuiceDollar';
import FrontendGatewayModule from './FrontendGateway';
import MintingHubGatewayModule from './MintingHubGateway';
import PositionFactoryModule from './PositionFactory';
import PositionRollerModule from './PositionRoller';
import SavingsGatewayModule from './SavingsGateway';
import StablecoinBridgeStartUSD from './StablecoinBridgeStartUSD';

export default buildModule('FullDeployment', (m) => {
  const { juiceDollar } = m.useModule(JuiceDollarModule);
  const { positionFactory } = m.useModule(PositionFactoryModule);
  const { positionRoller } = m.useModule(PositionRollerModule);
  const { stablecoinBridgeStartUSD } = m.useModule(StablecoinBridgeStartUSD);
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
  m.call(juiceDollar, 'initialize', [stablecoinBridgeStartUSD, 'StablecoinBridgeStartUSD'], {
    id: 'JuiceDollar_initialize_StablecoinBridgeStartUSD',
  });

  // NOTE: JUSD minting to close initialization is handled in scripts/deployment/deployProtocol.ts
  // That script deploys StartUSD, bridges 1000 SUSD → JUSD, and creates initial JUICE tokens

  return {
    juiceDollar,
    positionFactory,
    positionRoller,
    stablecoinBridgeStartUSD,
    frontendGateway,
    savingsGateway,
    mintingHubGateway,
  };
});

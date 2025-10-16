import { buildModule } from '@nomicfoundation/hardhat-ignition/modules';
import JuiceDollarModule from './JuiceDollar';
import DEPSWrapperModule from './DEPSWrapper';
import FrontendGatewayModule from './FrontendGateway';
import MintingHubGatewayModule from './MintingHubGateway';
import PositionFactoryModule from './PositionFactory';
import PositionRollerModule from './PositionRoller';
import SavingsGatewayModule from './SavingsGateway';
import StablecoinBridgeEURC from './StablecoinBridgeEURC';
import StablecoinBridgeEURT from './StablecoinBridgeEURT';
import StablecoinBridgeVEUR from './StablecoinBridgeVEUR';
import StablecoinBridgeEURS from './StablecoinBridgeEURS';

export default buildModule('FullDeployment', (m) => {
  const { decentralizeJUSD } = m.useModule(JuiceDollarModule);
  const { positionFactory } = m.useModule(PositionFactoryModule);
  const { positionRoller } = m.useModule(PositionRollerModule);
  const { stablecoinBridgeEURC } = m.useModule(StablecoinBridgeEURC);
  const { stablecoinBridgeEURT } = m.useModule(StablecoinBridgeEURT);
  const { stablecoinBridgeVEUR } = m.useModule(StablecoinBridgeVEUR);
  const { stablecoinBridgeEURS } = m.useModule(StablecoinBridgeEURS);
  const { depsWrapper } = m.useModule(DEPSWrapperModule);
  const { frontendGateway } = m.useModule(FrontendGatewayModule);
  const { savingsGateway } = m.useModule(SavingsGatewayModule);
  const { mintingHubGateway } = m.useModule(MintingHubGatewayModule);

  // 1. Initialize the frontend gateway
  m.call(frontendGateway, 'init', [savingsGateway, mintingHubGateway], { id: 'FrontendGateway_init' });

  // 2. Initialize minters
  m.call(decentralizeJUSD, 'initialize', [mintingHubGateway, 'MintingHubGateway'], {
    id: 'JuiceDollar_initialize_MintingHubGateway',
  });
  m.call(decentralizeJUSD, 'initialize', [positionRoller, 'PositionRoller'], {
    id: 'JuiceDollar_initialize_PositionRoller',
  });
  m.call(decentralizeJUSD, 'initialize', [savingsGateway, 'SavingsGateway'], {
    id: 'JuiceDollar_initialize_SavingsGateway',
  });
  m.call(decentralizeJUSD, 'initialize', [frontendGateway, 'FrontendGateway'], {
    id: 'JuiceDollar_initialize_FrontendGateway',
  });
  m.call(decentralizeJUSD, 'initialize', [stablecoinBridgeEURC, 'StablecoinBridgeEURC'], {
    id: 'JuiceDollar_initialize_StablecoinBridgeEURC',
  });
  m.call(decentralizeJUSD, 'initialize', [stablecoinBridgeEURT, 'StablecoinBridgeEURT'], {
    id: 'JuiceDollar_initialize_StablecoinBridgeEURT',
  });
  m.call(decentralizeJUSD, 'initialize', [stablecoinBridgeVEUR, 'StablecoinBridgeVEUR'], {
    id: 'JuiceDollar_initialize_StablecoinBridgeVEUR',
  });
  m.call(decentralizeJUSD, 'initialize', [stablecoinBridgeEURS, 'StablecoinBridgeEURS'], {
    id: 'JuiceDollar_initialize_StablecoinBridgeEURS',
  });

  // TODO: Mint some JUSD to close initialisation phase (IMPORTANT!)

  return {
    decentralizeJUSD,
    positionFactory,
    positionRoller,
    stablecoinBridgeEURC,
    stablecoinBridgeEURT,
    stablecoinBridgeVEUR,
    stablecoinBridgeEURS,
    depsWrapper,
    frontendGateway,
    savingsGateway,
    mintingHubGateway,
  };
});

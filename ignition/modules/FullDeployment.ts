import { buildModule } from '@nomicfoundation/hardhat-ignition/modules';
import DecentralizedEUROModule from './DecentralizedEURO';
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
  const { decentralizedEURO } = m.useModule(DecentralizedEUROModule);
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
  m.call(decentralizedEURO, 'initialize', [mintingHubGateway, 'MintingHubGateway'], {
    id: 'DecentralizedEURO_initialize_MintingHubGateway',
  });
  m.call(decentralizedEURO, 'initialize', [positionRoller, 'PositionRoller'], {
    id: 'DecentralizedEURO_initialize_PositionRoller',
  });
  m.call(decentralizedEURO, 'initialize', [savingsGateway, 'SavingsGateway'], {
    id: 'DecentralizedEURO_initialize_SavingsGateway',
  });
  m.call(decentralizedEURO, 'initialize', [frontendGateway, 'FrontendGateway'], {
    id: 'DecentralizedEURO_initialize_FrontendGateway',
  });
  m.call(decentralizedEURO, 'initialize', [stablecoinBridgeEURC, 'StablecoinBridgeEURC'], {
    id: 'DecentralizedEURO_initialize_StablecoinBridgeEURC',
  });
  m.call(decentralizedEURO, 'initialize', [stablecoinBridgeEURT, 'StablecoinBridgeEURT'], {
    id: 'DecentralizedEURO_initialize_StablecoinBridgeEURT',
  });
  m.call(decentralizedEURO, 'initialize', [stablecoinBridgeVEUR, 'StablecoinBridgeVEUR'], {
    id: 'DecentralizedEURO_initialize_StablecoinBridgeVEUR',
  });
  m.call(decentralizedEURO, 'initialize', [stablecoinBridgeEURS, 'StablecoinBridgeEURS'], {
    id: 'DecentralizedEURO_initialize_StablecoinBridgeEURS',
  });

  // TODO: Mint some dEURO to close initialisation phase (IMPORTANT!)

  return {
    decentralizedEURO,
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

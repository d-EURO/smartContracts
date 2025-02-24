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
  const deuro = m.useModule(DecentralizedEUROModule);
  const positionFactory = m.useModule(PositionFactoryModule);
  const positionRoller = m.useModule(PositionRollerModule);
  const stablecoinBridgeEURC = m.useModule(StablecoinBridgeEURC);
  const stablecoinBridgeEURT = m.useModule(StablecoinBridgeEURT);
  const stablecoinBridgeVEUR = m.useModule(StablecoinBridgeVEUR);
  const stablecoinBridgeEURS = m.useModule(StablecoinBridgeEURS);
  const deps = m.useModule(DEPSWrapperModule);
  const frontend = m.useModule(FrontendGatewayModule);
  const savingsGateway = m.useModule(SavingsGatewayModule);
  const mintingHub = m.useModule(MintingHubGatewayModule);

  return {
    ...deuro,
    ...positionFactory,
    ...positionRoller,
    ...stablecoinBridgeEURC,
    ...stablecoinBridgeEURT,
    ...stablecoinBridgeVEUR,
    ...stablecoinBridgeEURS,
    ...deps,
    ...frontend,
    ...savingsGateway,
    ...mintingHub,
  };
});

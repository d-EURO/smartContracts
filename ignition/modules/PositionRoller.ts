import { buildModule } from '@nomicfoundation/hardhat-ignition/modules';
import DecentralizedEUROModule from './DecentralizedEURO';

export default buildModule('PositionRoller', (m) => {
  const { decentralizedEURO } = m.useModule(DecentralizedEUROModule);

  const positionRoller = m.contract('PositionRoller', [decentralizedEURO]);

  return { positionRoller };
});

import { buildModule } from '@nomicfoundation/hardhat-ignition/modules';
import JuiceDollarModule from './JuiceDollar';

export default buildModule('PositionRoller', (m) => {
  const { decentralizeJUSD } = m.useModule(JuiceDollarModule);

  const positionRoller = m.contract('PositionRoller', [decentralizeJUSD]);

  return { positionRoller };
});

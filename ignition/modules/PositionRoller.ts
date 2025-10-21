import { buildModule } from '@nomicfoundation/hardhat-ignition/modules';
import JuiceDollarModule from './JuiceDollar';

export default buildModule('PositionRoller', (m) => {
  const { juiceDollar } = m.useModule(JuiceDollarModule);

  const positionRoller = m.contract('PositionRoller', [juiceDollar]);

  return { positionRoller };
});

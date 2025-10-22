import { buildModule } from '@nomicfoundation/hardhat-ignition/modules';
import JuiceDollarModule from './JuiceDollar';

export default buildModule('StablecoinBridgeUSDT', (m) => {
  const { juiceDollar } = m.useModule(JuiceDollarModule);

  const other = m.getParameter('other');
  const limit = m.getParameter('limit');
  const weeks = m.getParameter('weeks');

  const stablecoinBridgeUSDT = m.contract('StablecoinBridge', [other, juiceDollar, limit, weeks], {
    id: 'StablecoinBridgeUSDT',
  });

  return { stablecoinBridgeUSDT };
});

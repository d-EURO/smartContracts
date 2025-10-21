import { buildModule } from '@nomicfoundation/hardhat-ignition/modules';
import JuiceDollarModule from './JuiceDollar';

export default buildModule('StablecoinBridgeStartUSD', (m) => {
  const { juiceDollar } = m.useModule(JuiceDollarModule);

  const other = m.getParameter('other');
  const limit = m.getParameter('limit');
  const weeks = m.getParameter('weeks');

  const stablecoinBridgeStartUSD = m.contract('StablecoinBridge', [other, juiceDollar, limit, weeks], {
    id: 'StablecoinBridgeStartUSD',
  });

  return { stablecoinBridgeStartUSD };
});

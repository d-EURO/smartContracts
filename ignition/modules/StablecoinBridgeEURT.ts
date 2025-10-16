import { buildModule } from '@nomicfoundation/hardhat-ignition/modules';
import JuiceDollarModule from './JuiceDollar';

export default buildModule('StablecoinBridgeEURT', (m) => {
  const { decentralizeJUSD } = m.useModule(JuiceDollarModule);

  const other = m.getParameter('other');
  const limit = m.getParameter('limit');
  const weeks = m.getParameter('weeks');

  const stablecoinBridgeEURT = m.contract('StablecoinBridge', [other, decentralizeJUSD, limit, weeks], {
    id: 'StablecoinBridgeEURT',
  });

  return { stablecoinBridgeEURT };
});

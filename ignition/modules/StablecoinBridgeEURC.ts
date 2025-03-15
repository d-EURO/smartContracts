import { buildModule } from '@nomicfoundation/hardhat-ignition/modules';
import DecentralizedEUROModule from './DecentralizedEURO';

export default buildModule('StablecoinBridgeEURC', (m) => {
  const { decentralizedEURO } = m.useModule(DecentralizedEUROModule);

  const other = m.getParameter('other');
  const limit = m.getParameter('limit');
  const weeks = m.getParameter('weeks');

  const stablecoinBridgeEURC = m.contract('StablecoinBridge', [other, decentralizedEURO, limit, weeks], {
    id: 'StablecoinBridgeEURC',
  });

  return { stablecoinBridgeEURC };
});

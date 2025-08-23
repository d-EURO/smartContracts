import { buildModule } from '@nomicfoundation/hardhat-ignition/modules';
import DecentralizedEUROModule from './DecentralizedEURO';

export default buildModule('StablecoinBridgeEURT', (m) => {
  const { decentralizedEURO } = m.useModule(DecentralizedEUROModule);

  const other = m.getParameter('other');
  const limit = m.getParameter('limit');
  const weeks = m.getParameter('weeks');
  const mintFeePPM = m.getParameter('mintFeePPM', 0); // Default to 0% mint fee
  const burnFeePPM = m.getParameter('burnFeePPM', 0); // Default to 0% burn fee

  const stablecoinBridgeEURT = m.contract('StablecoinBridge', [other, decentralizedEURO, limit, weeks, mintFeePPM, burnFeePPM], {
    id: 'StablecoinBridgeEURT',
  });

  return { stablecoinBridgeEURT };
});

import { buildModule } from '@nomicfoundation/hardhat-ignition/modules';

export default buildModule('DecentralizedEURO', (m) => {
  const minApplicationPeriod = m.getParameter('minApplicationPeriod');

  const decentralizedEURO = m.contract('DecentralizedEURO', [minApplicationPeriod]);

  return { decentralizedEURO };
});

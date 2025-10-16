import { buildModule } from '@nomicfoundation/hardhat-ignition/modules';

export default buildModule('JuiceDollar', (m) => {
  const minApplicationPeriod = m.getParameter('minApplicationPeriod');

  const decentralizeJUSD = m.contract('JuiceDollar', [minApplicationPeriod]);

  return { decentralizeJUSD };
});

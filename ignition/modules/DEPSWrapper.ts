import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";
import JuiceDollarModule from "./JuiceDollar";

export default buildModule("DEPSWrapper", (m) => {
  const { decentralizeJUSD } = m.useModule(JuiceDollarModule);
  const equityAddress = m.staticCall(decentralizeJUSD, "reserve", []);

  const depsWrapper = m.contract("DEPSWrapper", [equityAddress]);
  
  return { depsWrapper };
});
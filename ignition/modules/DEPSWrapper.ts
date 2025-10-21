import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";
import DecentralizedEUROModule from "./DecentralizedEURO";

export default buildModule("DEPSWrapper", (m) => {
  const { decentralizedEURO } = m.useModule(DecentralizedEUROModule);
  const equityAddress = m.staticCall(decentralizedEURO, "reserve", []);

  const depsWrapper = m.contract("DEPSWrapper", [equityAddress]);
  
  return { depsWrapper };
});
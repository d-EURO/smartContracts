import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";
import JuiceDollarModule from "./JuiceDollar";
import DEPSWrapperModule from "./DEPSWrapper";

export default buildModule("FrontendGateway", (m) => {
  const { decentralizeJUSD } = m.useModule(JuiceDollarModule);
  const { depsWrapper } = m.useModule(DEPSWrapperModule);

  const frontendGateway = m.contract("FrontendGateway", [decentralizeJUSD, depsWrapper]);
  
  return { frontendGateway };
});
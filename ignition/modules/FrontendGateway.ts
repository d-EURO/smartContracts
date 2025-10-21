import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";
import DecentralizedEUROModule from "./DecentralizedEURO";
import DEPSWrapperModule from "./DEPSWrapper";

export default buildModule("FrontendGateway", (m) => {
  const { decentralizedEURO } = m.useModule(DecentralizedEUROModule);
  const { depsWrapper } = m.useModule(DEPSWrapperModule);

  const frontendGateway = m.contract("FrontendGateway", [decentralizedEURO, depsWrapper]);
  
  return { frontendGateway };
});
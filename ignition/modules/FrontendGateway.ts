import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";
import JuiceDollarModule from "./JuiceDollar";

export default buildModule("FrontendGateway", (m) => {
  const { juiceDollar } = m.useModule(JuiceDollarModule);

  const frontendGateway = m.contract("FrontendGateway", [juiceDollar]);

  return { frontendGateway };
});
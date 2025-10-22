import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";
import JuiceDollarModule from "./JuiceDollar";
import FrontendGatewayModule from "./FrontendGateway";

export default buildModule("SavingsGateway", (m) => {
  const { juiceDollar } = m.useModule(JuiceDollarModule);
  const { frontendGateway } = m.useModule(FrontendGatewayModule);
  const initialRatePPM = m.getParameter("initialRatePPM");

  const savingsGateway = m.contract("SavingsGateway", [juiceDollar, initialRatePPM, frontendGateway]);

  return { savingsGateway };
});
import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";
import JuiceDollarModule from "./JuiceDollar";
import FrontendGatewayModule from "./FrontendGateway";

export default buildModule("SavingsGateway", (m) => {
  const { decentralizeJUSD } = m.useModule(JuiceDollarModule);
  const { frontendGateway } = m.useModule(FrontendGatewayModule);
  const initialRatePPM = m.getParameter("initialRatePPM"); 

  const savingsGateway = m.contract("SavingsGateway", [decentralizeJUSD, initialRatePPM, frontendGateway]);

  return { savingsGateway };
});
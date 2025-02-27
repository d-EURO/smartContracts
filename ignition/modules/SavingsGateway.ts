import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";
import DecentralizedEUROModule from "./DecentralizedEURO";
import FrontendGatewayModule from "./FrontendGateway";

export default buildModule("SavingsGateway", (m) => {
  const { decentralizedEURO } = m.useModule(DecentralizedEUROModule);
  const { frontendGateway } = m.useModule(FrontendGatewayModule);
  const initialRatePPM = m.getParameter("initialRatePPM"); 

  const savingsGateway = m.contract("SavingsGateway", [decentralizedEURO, initialRatePPM, frontendGateway]);

  return { savingsGateway };
});
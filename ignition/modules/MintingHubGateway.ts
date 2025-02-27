import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";
import DecentralizedEUROModule from "./DecentralizedEURO";
import SavingsGatewayModule from "./SavingsGateway";
import PositionRollerModule from "./PositionRoller";
import PositionFactoryModule from "./PositionFactory";
import FrontendGatewayModule from "./FrontendGateway";

export default buildModule("MintingHubGateway", (m) => {
  const { decentralizedEURO } = m.useModule(DecentralizedEUROModule);
  const { savingsGateway } = m.useModule(SavingsGatewayModule);
  const { positionRoller } = m.useModule(PositionRollerModule);
  const { positionFactory } = m.useModule(PositionFactoryModule);
  const { frontendGateway } = m.useModule(FrontendGatewayModule);

  const mintingHubGateway = m.contract("MintingHubGateway", [
    decentralizedEURO,
    savingsGateway,
    positionRoller,
    positionFactory,
    frontendGateway,
  ]);

  return { mintingHubGateway };
});
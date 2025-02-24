import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

export default buildModule("PositionFactory", (m) => {
  const positionFactory = m.contract("PositionFactory", []);
  return { positionFactory };
});
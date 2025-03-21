import * as fs from 'fs';
import * as path from 'path';

const ARTIFACTS_PATH = path.join(process.cwd(), 'artifacts/contracts');
const ABIS_EXPORT_PATH = path.join(process.cwd(), 'exports/abis');

const contractABI = [
  {
    from: `${ARTIFACTS_PATH}/DecentralizedEURO.sol/DecentralizedEURO.json`,
    to: `${ABIS_EXPORT_PATH}/core/DecentralizedEURO.ts`,
    exportName: 'DecentralizedEUROABI',
  },

  {
    from: `${ARTIFACTS_PATH}/Equity.sol/Equity.json`,
    to: `${ABIS_EXPORT_PATH}/core/Equity.ts`,
    exportName: 'EquityABI',
  },

  {
    from: `${ARTIFACTS_PATH}/gateway/FrontendGateway.sol/FrontendGateway.json`,
    to: `${ABIS_EXPORT_PATH}/core/FrontendGateway.ts`,
    exportName: 'FrontendGatewayABI',
  },

  {
    from: `${ARTIFACTS_PATH}/gateway/MintingHubGateway.sol/MintingHubGateway.json`,
    to: `${ABIS_EXPORT_PATH}/core/MintingHubGateway.ts`,
    exportName: 'MintingHubGatewayABI',
  },

  {
    from: `${ARTIFACTS_PATH}/gateway/SavingsGateway.sol/SavingsGateway.json`,
    to: `${ABIS_EXPORT_PATH}/core/SavingsGateway.ts`,
    exportName: 'SavingsGatewayABI',
  },

  {
    from: `${ARTIFACTS_PATH}/MintingHubV2/PositionFactory.sol/PositionFactory.json`,
    to: `${ABIS_EXPORT_PATH}/MintingHubV2/PositionFactoryV2.ts`,
    exportName: 'PositionFactoryV2ABI',
  },

  {
    from: `${ARTIFACTS_PATH}/MintingHubV2/PositionRoller.sol/PositionRoller.json`,
    to: `${ABIS_EXPORT_PATH}/MintingHubV2/PositionRoller.ts`,
    exportName: 'PositionRollerABI',
  },

  {
    from: `${ARTIFACTS_PATH}/MintingHubV2/Position.sol/Position.json`,
    to: `${ABIS_EXPORT_PATH}/MintingHubV2/PositionV2.ts`,
    exportName: 'PositionV2ABI',
  },
  {
    from: `${ARTIFACTS_PATH}/StablecoinBridge.sol/StablecoinBridge.json`,
    to: `${ABIS_EXPORT_PATH}/utils/StablecoinBridge.ts`,
    exportName: 'StablecoinBridgeABI',
  },

  {
    from: `${ARTIFACTS_PATH}/utils/DEPSWrapper.sol/DEPSWrapper.json`,
    to: `${ABIS_EXPORT_PATH}/utils/DEPSWrapper.ts`,
    exportName: 'DEPSWrapperABI',
  },

  {
    from: `${ARTIFACTS_PATH}/MintingHubV2/MintingHub.sol/MintingHub.json`,
    to: `${ABIS_EXPORT_PATH}/utils/MintingHubV2.ts`,
    exportName: 'MintingHubV2ABI',
  },

  {
    from: `${ARTIFACTS_PATH}/Savings.sol/Savings.json`,
    to: `${ABIS_EXPORT_PATH}/utils/Savings.ts`,
    exportName: 'SavingsABI',
  },

];

contractABI.forEach((contract) => {
  // Read the JSON file
  fs.readFile(contract.from, 'utf8', (err, data) => {
  if (err) {
    console.error('Error reading JSON file:', err);
    return;
  }

  // Parse the JSON data
  const jsonData = JSON.parse(data);

  // Extract the ABI
  const abi = jsonData.abi;

  // Create the TypeScript content
  const tsContent = `export const ${contract.exportName} = ${JSON.stringify(abi, null, 2)} as const;`;

  // Write the TypeScript file
  fs.writeFile(contract.to, tsContent, 'utf8', (err) => {
    if (err) {
      console.error('Error writing TypeScript file:', err);
      return;
    }
      console.log(`${contract.exportName} ABI exported successfully to ${contract.to}`);
    });
  });
});

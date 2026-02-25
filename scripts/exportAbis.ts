import * as fs from 'fs';
import * as path from 'path';

const ARTIFACTS_PATH = path.join(process.cwd(), 'artifacts/contracts');
const ABIS_EXPORT_PATH = path.join(process.cwd(), 'exports/abis');

const contractABI = [
  // Shared (version-independent)
  {
    from: `${ARTIFACTS_PATH}/DecentralizedEURO.sol/DecentralizedEURO.json`,
    to: `${ABIS_EXPORT_PATH}/shared/DecentralizedEURO.ts`,
    exportName: 'DecentralizedEUROABI',
  },
  {
    from: `${ARTIFACTS_PATH}/Equity.sol/Equity.json`,
    to: `${ABIS_EXPORT_PATH}/shared/Equity.ts`,
    exportName: 'EquityABI',
  },
  {
    from: `${ARTIFACTS_PATH}/StablecoinBridge.sol/StablecoinBridge.json`,
    to: `${ABIS_EXPORT_PATH}/shared/StablecoinBridge.ts`,
    exportName: 'StablecoinBridgeABI',
  },
  {
    from: `${ARTIFACTS_PATH}/utils/DEPSWrapper.sol/DEPSWrapper.json`,
    to: `${ABIS_EXPORT_PATH}/shared/DEPSWrapper.ts`,
    exportName: 'DEPSWrapperABI',
  },

  // V3
  {
    from: `${ARTIFACTS_PATH}/MintingHubV3/MintingHub.sol/MintingHub.json`,
    to: `${ABIS_EXPORT_PATH}/v3/MintingHub.ts`,
    exportName: 'MintingHubV3ABI',
  },
  {
    from: `${ARTIFACTS_PATH}/Savings.sol/Savings.json`,
    to: `${ABIS_EXPORT_PATH}/v3/Savings.ts`,
    exportName: 'SavingsV3ABI',
  },
  {
    from: `${ARTIFACTS_PATH}/SavingsVaultDEURO.sol/SavingsVaultDEURO.json`,
    to: `${ABIS_EXPORT_PATH}/v3/SavingsVaultDEURO.ts`,
    exportName: 'SavingsVaultDEUROABI',
  },
  {
    from: `${ARTIFACTS_PATH}/MintingHubV3/Position.sol/Position.json`,
    to: `${ABIS_EXPORT_PATH}/v3/Position.ts`,
    exportName: 'PositionV3ABI',
  },
  {
    from: `${ARTIFACTS_PATH}/MintingHubV3/PositionFactory.sol/PositionFactory.json`,
    to: `${ABIS_EXPORT_PATH}/v3/PositionFactory.ts`,
    exportName: 'PositionFactoryV3ABI',
  },
  {
    from: `${ARTIFACTS_PATH}/MintingHubV3/PositionRoller.sol/PositionRoller.json`,
    to: `${ABIS_EXPORT_PATH}/v3/PositionRoller.ts`,
    exportName: 'PositionRollerV3ABI',
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

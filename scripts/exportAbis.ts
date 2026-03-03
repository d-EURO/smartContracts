import * as fs from 'fs';
import * as path from 'path';

const ARTIFACTS_PATH = path.join(process.cwd(), 'artifacts/contracts');
const ABIS_EXPORT_PATH = path.join(process.cwd(), 'exports/abis');

const contractABI = [
  // Shared (version-independent)
  {
    from: `${ARTIFACTS_PATH}/JuiceDollar.sol/JuiceDollar.json`,
    to: `${ABIS_EXPORT_PATH}/shared/JuiceDollar.ts`,
    exportName: 'JuiceDollarABI',
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

  // V3 (new contracts)
  {
    from: `${ARTIFACTS_PATH}/MintingHubV3/MintingHub.sol/MintingHub.json`,
    to: `${ABIS_EXPORT_PATH}/v3/MintingHub.ts`,
    exportName: 'MintingHubV3ABI',
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
  {
    from: `${ARTIFACTS_PATH}/Savings.sol/Savings.json`,
    to: `${ABIS_EXPORT_PATH}/v3/Savings.ts`,
    exportName: 'SavingsV3ABI',
  },
  {
    from: `${ARTIFACTS_PATH}/SavingsVaultJUSD.sol/SavingsVaultJUSD.json`,
    to: `${ABIS_EXPORT_PATH}/v3/SavingsVaultJUSD.ts`,
    exportName: 'SavingsVaultJUSDABI',
  },

  // Utility ABIs
  {
    from: `${ARTIFACTS_PATH}/StartUSD.sol/StartUSD.json`,
    to: `${ABIS_EXPORT_PATH}/utils/StartUSD.ts`,
    exportName: 'StartUSDABI',
  },
];

// Ensure output directories exist
const dirs = ['shared', 'v2', 'v3', 'utils'].map((d) => path.join(ABIS_EXPORT_PATH, d));
for (const dir of dirs) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

contractABI.forEach((contract) => {
  fs.readFile(contract.from, 'utf8', (err, data) => {
  if (err) {
    console.error('Error reading JSON file:', err);
    return;
  }

  const jsonData = JSON.parse(data);
  const abi = jsonData.abi;
  const tsContent = `export const ${contract.exportName} = ${JSON.stringify(abi, null, 2)} as const;`;

  fs.writeFile(contract.to, tsContent, 'utf8', (err) => {
    if (err) {
      console.error('Error writing TypeScript file:', err);
      return;
    }
      console.log(`${contract.exportName} ABI exported successfully to ${contract.to}`);
    });
  });
});

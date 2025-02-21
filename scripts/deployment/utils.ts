import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { Contract } from 'ethers';
import { Network } from 'hardhat/types';
import { run } from 'hardhat';
import readline from 'readline';

export function getParams(name: string, chainId: number): any {
  const paramFile = __dirname + '/parameters/' + name + '.json';
  return require(paramFile)[chainId];
}

export const deployContract = async (
  hre: HardhatRuntimeEnvironment,
  contractName: string,
  args?: any[],
  contract?: string,
  verbose = true,
): Promise<Contract> => {
  const {
    deployments: { deploy, log },
    getNamedAccounts,
    network,
    ethers,
  } = hre;

  const { deployer } = await getNamedAccounts();

  if (process.env.CONFIRM_DEPLOYMENT === 'true') {
    await confirmAndProceed(deployer, network, contractName, args);
  }

  const deployment = await deploy(contractName, {
    from: deployer,
    args: args,
    log: true,
    contract: contract ?? contractName,
  });

  if (verbose) {
    log(`Contract ${contractName} deployed to: ${deployment.address} with args: ${args}`);
  }

  // Wait for 6 confirmations using the deployment's transaction hash
  // if (deployment.transactionHash) {
  //   await ethers.provider.waitForTransaction(deployment.transactionHash, 6);
  // }

  return ethers.getContractAt(contract ?? contractName, deployment.address);
};

export async function confirmAndProceed(
  deployer: string,
  network: Network,
  contractName: string,
  args?: any[],
): Promise<void> {
  console.log(
    `> Deploying (deployer: ${deployer}) on ${network.name} (${network.config['chainId']}): \n> Name: ${contractName} \n> Args: ${args?.join(' ')}`,
  );

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const confirmation = await new Promise<string>((resolve) => {
    rl.question('Proceed? (default: Y) / n\n', (answer: string) => {
      resolve(answer.trim().toLowerCase());
      rl.close();
    });
  });

  if (confirmation === 'n' || confirmation === 'no') {
    console.log('Deployment aborted.');
    process.exit(0);
  }
}

export const verify = async (contractAddress: string, args: any[] | undefined, name?: string) => {
  console.log('-------------------------------------------------------------------');
  console.log(`Verifying ${name ?? 'contract'}...`);
  try {
    const verificationParams: any = {
      address: contractAddress,
    };

    if (args && args.length > 0) {
      verificationParams.constructorArguments = args;
    }

    await run('verify:verify', verificationParams);
  } catch (e: any) {
    if (e.message.toLowerCase().includes('already verified')) {
      console.log('Already Verified!');
    }
  }
};

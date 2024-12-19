import { ethers } from "hardhat";
import readline from "readline";
import { Network } from "hardhat/types";

let defaultSigner: String;

export function setDefaultSigner(signer: String) {
  defaultSigner = signer;
}

export async function getAccounts(): Promise<any[]> {
  const accounts = await ethers.getSigners();
  const users: any = [];
  accounts.forEach((element: any) => {
    users.push(element.address);
  });
  return accounts;
}

export async function createFactory(path: string) {
  const parsed = {};
  return await ethers.getContractFactory(path, { libraries: parsed });
}

export async function createContract(path: string, args: any[] = []) {
  const factory = await createFactory(path);
  return await factory.deploy(...args);
}

export function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function getSigningManagerFromPK(
  ctrAddr: string,
  ctrAbi: string,
  nodeUrl: string,
  pk: any
) {
  const provider = new ethers.JsonRpcProvider(nodeUrl);
  const wallet = new ethers.Wallet(pk);
  const signer = wallet.connect(provider);
  const signingContractManager = new ethers.Contract(ctrAddr, ctrAbi, signer);
  return signingContractManager;
}

export function capitalToShares(
  totalCapital: bigint,
  totalShares: bigint,
  dCapital: bigint
): bigint {
  if (totalShares == 0n) {
    return 1000000n;
  } else {
    return (
      totalShares *
      (((totalCapital + dCapital) / totalCapital) ** (1n / 3n) - 1n)
    );
  }
}
export function sharesToCapital(
  totalCapital: bigint,
  totalShares: bigint,
  dShares: bigint
) {
  return -totalCapital * (((totalShares - dShares) / totalShares) ** 3n - 1n);
}

export function getParams(
  name: string,
  chainId: number,
): any {
  // __dirname + "/../parameters/paramsBridges.json";
  const paramFile = __dirname + "/deployment/parameters/" + name + ".json";
  return require(paramFile)[chainId];
}

export async function confirmAndProceed(
  deployer: string,
  network: Network,
  contractName: string,
  args?: any[]
): Promise<void> {
  console.log(`> Deploying (deployer: ${deployer}) on ${network.name} (${network.config["chainId"]}): \n> Name: ${contractName} \n> Args: ${args?.join(" ")}`);

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const confirmation = await new Promise<string>((resolve) => {
    rl.question("Proceed? (default: Y) / n\n", (answer: string) => {
      resolve(answer.trim().toLowerCase());
      rl.close();
    });
  });

  if (confirmation === "n" || confirmation === "no") {
    console.log("Deployment aborted.");
    process.exit(0);
  }
}
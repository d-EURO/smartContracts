import { ethers } from 'ethers';
import { FrontendGatewayState } from '../dto';

export async function getFrontendGatewayState(
  contract: ethers.Contract,
): Promise<FrontendGatewayState> {
  const address = await contract.getAddress();
  const deuroAddress = await contract.DEURO();
  const equityAddress = await contract.EQUITY();
  const depsAddress = await contract.DEPS();
  const mintingHubAddress = await contract.MINTING_HUB();
  const savingsAddress = await contract.SAVINGS();
  const feeRate = await contract.feeRate();
  const savingsFeeRate = await contract.savingsFeeRate();
  const mintingFeeRate = await contract.mintingFeeRate();
  const nextFeeRate = await contract.nextFeeRate();
  const nextSavingsFeeRate = await contract.nextSavingsFeeRate();
  const nextMintingFeeRate = await contract.nextMintingFeeRate();
  const changeTimeLock = await contract.changeTimeLock();

  return {
    address,
    deuroAddress,
    equityAddress,
    depsAddress,
    mintingHubAddress,
    savingsAddress,
    feeRate,
    savingsFeeRate,
    mintingFeeRate,
    nextFeeRate,
    nextSavingsFeeRate,
    nextMintingFeeRate,
    changeTimeLock,
  };
}
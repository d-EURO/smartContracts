import { ethers } from "hardhat";
import * as helper from "@nomicfoundation/hardhat-network-helpers";

export const latestBlockNumber = async () => {
  return await ethers.provider.getBlockNumber();
};

export const evm_increaseTime = async (seconds: number | bigint) => {
  await helper.time.increase(seconds);
  await helper.mine(1);
};

export const evm_increaseTimeTo = async (seconds: number | bigint) => {
  let latest = BigInt(await helper.time.latest());
  await helper.time.increase(BigInt(seconds) - latest);
};

export const evm_mineBlocks = async (n: number) => {
  await helper.mine(n);
};

export function getFutureTimeStamp(addHours: number) {
  const date = new Date();
  date.setHours(date.getHours() + addHours);
  return date.getTime();
}

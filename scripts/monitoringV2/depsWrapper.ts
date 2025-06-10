import { ethers, ZeroAddress } from 'ethers';
import { DEPSWrapperStateExtended } from './dto/depsWrapper.dto';
import { TransferEvent, WrapEvent, UnwrapEvent } from './dto/event.dto';
import { fetchEvents } from './utils';
import { EquityABI } from '../../exports/abis/core/Equity';

export async function depsWrapperState(contract: ethers.Contract): Promise<DEPSWrapperStateExtended> {
  const address = await contract.getAddress();
  const name = await contract.name();
  const symbol = await contract.symbol();
  const decimals = await contract.decimals();
  const totalSupply = await contract.totalSupply();
  const underlyingAddress = await contract.underlying(); 
  const underlyingContract = new ethers.Contract(underlyingAddress, EquityABI, contract.runner);
  const underlyingSymbol = await underlyingContract.symbol();

  const allTransferEvents = await fetchEvents<TransferEvent>(contract, contract.filters.Transfer());
  const wrapEvents = filterWrapEvents(allTransferEvents);
  const unwrapEvents = filterUnwrapEvents(allTransferEvents);
  const transferEvents = filterTransferEvents(allTransferEvents);

  return {
    address,
    name,
    symbol,
    decimals,
    totalSupply,
    underlyingAddress,
    underlyingSymbol,
    transferEvents,
    wrapEvents,
    unwrapEvents,
  };
}

function filterWrapEvents(transferEvents: TransferEvent[]): WrapEvent[] {
  return transferEvents
    .filter(event => event.from === ZeroAddress)
    .map(event => ({
      txHash: event.txHash,
      timestamp: event.timestamp,
      to: event.to,
      value: event.value,
    }));
}

function filterUnwrapEvents(transferEvents: TransferEvent[]): UnwrapEvent[] {
  return transferEvents
    .filter(event => event.to === ZeroAddress)
    .map(event => ({
      txHash: event.txHash,
      timestamp: event.timestamp,
      from: event.from,
      value: event.value,
    }));
}

function filterTransferEvents(transferEvents: TransferEvent[]): TransferEvent[] {
  return transferEvents.filter(
    event => event.from !== ZeroAddress && event.to !== ZeroAddress
  );
}
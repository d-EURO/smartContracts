import { BaseEvent } from './event.dto';

export interface RollEvent extends BaseEvent {
  source: string;
  collWithdraw: bigint;
  repay: bigint;
  target: string;
  collDeposit: bigint;
  mint: bigint;
}

export interface PositionRollerState {
  rollEvents: RollEvent[];
}
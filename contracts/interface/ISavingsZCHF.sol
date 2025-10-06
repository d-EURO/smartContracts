// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

interface ISavingsZCHF {
	struct Account {
		uint192 saved;
		uint64 ticks;
		address referrer;
		uint32 referralFeePPM;
	}

	// ---------------------------------------------------------------------------------------

	event Saved(address indexed account, uint192 amount);
	event InterestCollected(address indexed account, uint256 interest, uint256 referrerFee);
	event Withdrawn(address indexed account, uint192 amount);

	// ---------------------------------------------------------------------------------------

	error FundsLocked(uint40 remainingSeconds);
	error ModuleDisabled();
	error ReferralFeeTooHigh(uint32 fee);

	// ---------------------------------------------------------------------------------------

	function INTEREST_DELAY() external view returns (uint64);

	function zchf() external view returns (address);

	function savings(address account) external view returns (Account memory);

	// ---------------------------------------------------------------------------------------

	function currentTicks() external view returns (uint64);

	function currentRatePPM() external view returns (uint24);

	function accruedInterest(address accountOwner) external view returns (uint192);

	function accruedInterest(address accountOwner, uint256 timestamp) external view returns (uint192);

	function calculateInterest(Account memory account, uint64 ticks) external pure returns (uint192);

	// ---------------------------------------------------------------------------------------

	function save(uint192 amount) external;

	function save(address owner, uint192 amount) external;

	function save(uint192 amount, address referrer, uint24 referralFeePPM) external;

	function withdraw(address target, uint192 amount) external returns (uint256);

	function withdraw(uint192 amount, address referrer, uint24 referralFeePPM) external;

	function adjust(uint192 targetAmount) external;

	function adjust(uint192 targetAmount, address referrer, uint24 referralFeePPM) external;

	function dropReferrer() external;

	function refreshMyBalance() external returns (uint192);

	function refreshBalance(address owner) external returns (uint192);
}

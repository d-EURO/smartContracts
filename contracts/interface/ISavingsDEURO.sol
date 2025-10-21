// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

interface ISavingsDEURO {
	struct Account {
		uint192 saved;
		uint64 ticks;
	}

	// ---------------------------------------------------------------------------------------

	event Saved(address indexed account, uint192 amount);
	event InterestCollected(address indexed account, uint256 interest);
	event Withdrawn(address indexed account, uint192 amount);

	// ---------------------------------------------------------------------------------------

	error ModuleDisabled();

	// ---------------------------------------------------------------------------------------

	function savings(address account) external view returns (Account memory);

	// ---------------------------------------------------------------------------------------

	function currentTicks() external view returns (uint64);

	function currentRatePPM() external view returns (uint24);

	function accruedInterest(address accountOwner) external view returns (uint192);

	function accruedInterest(address accountOwner, uint256 timestamp) external view returns (uint192);

	function calculateInterest(Account memory account, uint64 ticks) external view returns (uint192);

	// ---------------------------------------------------------------------------------------

	function save(uint192 amount) external;

	function save(address owner, uint192 amount) external;

	function withdraw(address target, uint192 amount) external returns (uint256);

	function adjust(uint192 targetAmount) external;

	function refreshMyBalance() external returns (uint192);

	function refreshBalance(address owner) external returns (uint192);
}

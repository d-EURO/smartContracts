export const FrontendGatewayABI = [
  {
    inputs: [
      {
        internalType: 'address',
        name: 'jusd_',
        type: 'address',
      },
    ],
    stateMutability: 'nonpayable',
    type: 'constructor',
  },
  {
    inputs: [],
    name: 'EquityTooLow',
    type: 'error',
  },
  {
    inputs: [],
    name: 'FrontendCodeAlreadyExists',
    type: 'error',
  },
  {
    inputs: [],
    name: 'NoOpenChanges',
    type: 'error',
  },
  {
    inputs: [
      {
        internalType: 'uint256',
        name: 'minmumExecutionTime',
        type: 'uint256',
      },
    ],
    name: 'NotDoneWaiting',
    type: 'error',
  },
  {
    inputs: [],
    name: 'NotFrontendCodeOwner',
    type: 'error',
  },
  {
    inputs: [],
    name: 'NotGatewayService',
    type: 'error',
  },
  {
    inputs: [
      {
        internalType: 'address',
        name: 'owner',
        type: 'address',
      },
    ],
    name: 'OwnableInvalidOwner',
    type: 'error',
  },
  {
    inputs: [
      {
        internalType: 'address',
        name: 'account',
        type: 'address',
      },
    ],
    name: 'OwnableUnauthorizedAccount',
    type: 'error',
  },
  {
    inputs: [],
    name: 'ProposedChangesToHigh',
    type: 'error',
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: false,
        internalType: 'address',
        name: 'owner',
        type: 'address',
      },
      {
        indexed: false,
        internalType: 'bytes32',
        name: 'frontendCode',
        type: 'bytes32',
      },
    ],
    name: 'FrontendCodeRegistered',
    type: 'event',
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: false,
        internalType: 'address',
        name: 'to',
        type: 'address',
      },
      {
        indexed: false,
        internalType: 'uint256',
        name: 'amount',
        type: 'uint256',
      },
      {
        indexed: false,
        internalType: 'bytes32',
        name: 'frontendCode',
        type: 'bytes32',
      },
    ],
    name: 'FrontendCodeRewardsWithdrawn',
    type: 'event',
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: false,
        internalType: 'address',
        name: 'from',
        type: 'address',
      },
      {
        indexed: false,
        internalType: 'address',
        name: 'to',
        type: 'address',
      },
      {
        indexed: false,
        internalType: 'bytes32',
        name: 'frontendCode',
        type: 'bytes32',
      },
    ],
    name: 'FrontendCodeTransferred',
    type: 'event',
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: false,
        internalType: 'bytes32',
        name: 'frontendCode',
        type: 'bytes32',
      },
      {
        indexed: false,
        internalType: 'address',
        name: 'user',
        type: 'address',
      },
      {
        indexed: false,
        internalType: 'uint256',
        name: 'amount',
        type: 'uint256',
      },
      {
        indexed: false,
        internalType: 'uint256',
        name: 'reward',
        type: 'uint256',
      },
    ],
    name: 'InvestRewardAdded',
    type: 'event',
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: false,
        internalType: 'address',
        name: 'position',
        type: 'address',
      },
      {
        indexed: false,
        internalType: 'bytes32',
        name: 'frontendCode',
        type: 'bytes32',
      },
    ],
    name: 'NewPositionRegistered',
    type: 'event',
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: 'address',
        name: 'previousOwner',
        type: 'address',
      },
      {
        indexed: true,
        internalType: 'address',
        name: 'newOwner',
        type: 'address',
      },
    ],
    name: 'OwnershipTransferred',
    type: 'event',
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: false,
        internalType: 'bytes32',
        name: 'frontendCode',
        type: 'bytes32',
      },
      {
        indexed: false,
        internalType: 'address',
        name: 'position',
        type: 'address',
      },
      {
        indexed: false,
        internalType: 'uint256',
        name: 'amount',
        type: 'uint256',
      },
      {
        indexed: false,
        internalType: 'uint256',
        name: 'reward',
        type: 'uint256',
      },
    ],
    name: 'PositionRewardAdded',
    type: 'event',
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: false,
        internalType: 'address',
        name: 'who',
        type: 'address',
      },
      {
        indexed: false,
        internalType: 'uint24',
        name: 'nextFeeRate',
        type: 'uint24',
      },
      {
        indexed: false,
        internalType: 'uint24',
        name: 'nextSavingsFeeRate',
        type: 'uint24',
      },
      {
        indexed: false,
        internalType: 'uint24',
        name: 'nextMintingFeeRate',
        type: 'uint24',
      },
    ],
    name: 'RateChangesExecuted',
    type: 'event',
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: false,
        internalType: 'address',
        name: 'who',
        type: 'address',
      },
      {
        indexed: false,
        internalType: 'uint24',
        name: 'nextFeeRate',
        type: 'uint24',
      },
      {
        indexed: false,
        internalType: 'uint24',
        name: 'nextSavingsFeeRate',
        type: 'uint24',
      },
      {
        indexed: false,
        internalType: 'uint24',
        name: 'nextMintingFeeRate',
        type: 'uint24',
      },
      {
        indexed: false,
        internalType: 'uint256',
        name: 'nextChange',
        type: 'uint256',
      },
    ],
    name: 'RateChangesProposed',
    type: 'event',
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: false,
        internalType: 'bytes32',
        name: 'frontendCode',
        type: 'bytes32',
      },
      {
        indexed: false,
        internalType: 'address',
        name: 'user',
        type: 'address',
      },
      {
        indexed: false,
        internalType: 'uint256',
        name: 'amount',
        type: 'uint256',
      },
      {
        indexed: false,
        internalType: 'uint256',
        name: 'reward',
        type: 'uint256',
      },
    ],
    name: 'RedeemRewardAdded',
    type: 'event',
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: false,
        internalType: 'bytes32',
        name: 'frontendCode',
        type: 'bytes32',
      },
      {
        indexed: false,
        internalType: 'address',
        name: 'saver',
        type: 'address',
      },
      {
        indexed: false,
        internalType: 'uint256',
        name: 'interest',
        type: 'uint256',
      },
      {
        indexed: false,
        internalType: 'uint256',
        name: 'reward',
        type: 'uint256',
      },
    ],
    name: 'SavingsRewardAdded',
    type: 'event',
  },
  {
    inputs: [],
    name: 'EQUITY',
    outputs: [
      {
        internalType: 'contract Equity',
        name: '',
        type: 'address',
      },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'JUSD',
    outputs: [
      {
        internalType: 'contract IERC20',
        name: '',
        type: 'address',
      },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'MINTING_HUB',
    outputs: [
      {
        internalType: 'contract IMintingHubGateway',
        name: '',
        type: 'address',
      },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'SAVINGS',
    outputs: [
      {
        internalType: 'contract SavingsGateway',
        name: '',
        type: 'address',
      },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'changeTimeLock',
    outputs: [
      {
        internalType: 'uint256',
        name: '',
        type: 'uint256',
      },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'executeChanges',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [],
    name: 'feeRate',
    outputs: [
      {
        internalType: 'uint24',
        name: '',
        type: 'uint24',
      },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      {
        internalType: 'bytes32',
        name: '',
        type: 'bytes32',
      },
    ],
    name: 'frontendCodes',
    outputs: [
      {
        internalType: 'uint256',
        name: 'balance',
        type: 'uint256',
      },
      {
        internalType: 'address',
        name: 'owner',
        type: 'address',
      },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      {
        internalType: 'address',
        name: 'position',
        type: 'address',
      },
    ],
    name: 'getPositionFrontendCode',
    outputs: [
      {
        internalType: 'bytes32',
        name: '',
        type: 'bytes32',
      },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      {
        internalType: 'address',
        name: 'savings',
        type: 'address',
      },
      {
        internalType: 'address',
        name: 'mintingHub',
        type: 'address',
      },
    ],
    name: 'init',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      {
        internalType: 'uint256',
        name: 'amount',
        type: 'uint256',
      },
      {
        internalType: 'uint256',
        name: 'expectedShares',
        type: 'uint256',
      },
      {
        internalType: 'bytes32',
        name: 'frontendCode',
        type: 'bytes32',
      },
    ],
    name: 'invest',
    outputs: [
      {
        internalType: 'uint256',
        name: '',
        type: 'uint256',
      },
    ],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      {
        internalType: 'address',
        name: '',
        type: 'address',
      },
    ],
    name: 'lastUsedFrontendCode',
    outputs: [
      {
        internalType: 'bytes32',
        name: '',
        type: 'bytes32',
      },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'mintingFeeRate',
    outputs: [
      {
        internalType: 'uint24',
        name: '',
        type: 'uint24',
      },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'nextFeeRate',
    outputs: [
      {
        internalType: 'uint24',
        name: '',
        type: 'uint24',
      },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'nextMintingFeeRate',
    outputs: [
      {
        internalType: 'uint24',
        name: '',
        type: 'uint24',
      },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'nextSavingsFeeRate',
    outputs: [
      {
        internalType: 'uint24',
        name: '',
        type: 'uint24',
      },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'owner',
    outputs: [
      {
        internalType: 'address',
        name: '',
        type: 'address',
      },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      {
        internalType: 'uint24',
        name: 'newFeeRatePPM_',
        type: 'uint24',
      },
      {
        internalType: 'uint24',
        name: 'newSavingsFeeRatePPM_',
        type: 'uint24',
      },
      {
        internalType: 'uint24',
        name: 'newMintingFeeRatePPM_',
        type: 'uint24',
      },
      {
        internalType: 'address[]',
        name: 'helpers',
        type: 'address[]',
      },
    ],
    name: 'proposeChanges',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      {
        internalType: 'address',
        name: 'target',
        type: 'address',
      },
      {
        internalType: 'uint256',
        name: 'shares',
        type: 'uint256',
      },
      {
        internalType: 'uint256',
        name: 'expectedProceeds',
        type: 'uint256',
      },
      {
        internalType: 'bytes32',
        name: 'frontendCode',
        type: 'bytes32',
      },
    ],
    name: 'redeem',
    outputs: [
      {
        internalType: 'uint256',
        name: '',
        type: 'uint256',
      },
    ],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      {
        internalType: 'address',
        name: '',
        type: 'address',
      },
    ],
    name: 'referredPositions',
    outputs: [
      {
        internalType: 'bytes32',
        name: '',
        type: 'bytes32',
      },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      {
        internalType: 'bytes32',
        name: 'frontendCode',
        type: 'bytes32',
      },
    ],
    name: 'registerFrontendCode',
    outputs: [
      {
        internalType: 'bool',
        name: '',
        type: 'bool',
      },
    ],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      {
        internalType: 'address',
        name: 'position',
        type: 'address',
      },
      {
        internalType: 'bytes32',
        name: 'frontendCode',
        type: 'bytes32',
      },
    ],
    name: 'registerPosition',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [],
    name: 'renounceOwnership',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [],
    name: 'savingsFeeRate',
    outputs: [
      {
        internalType: 'uint24',
        name: '',
        type: 'uint24',
      },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      {
        internalType: 'bytes32',
        name: 'frontendCode',
        type: 'bytes32',
      },
      {
        internalType: 'address',
        name: 'to',
        type: 'address',
      },
    ],
    name: 'transferFrontendCode',
    outputs: [
      {
        internalType: 'bool',
        name: '',
        type: 'bool',
      },
    ],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      {
        internalType: 'address',
        name: 'newOwner',
        type: 'address',
      },
    ],
    name: 'transferOwnership',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      {
        internalType: 'address',
        name: 'position',
        type: 'address',
      },
      {
        internalType: 'uint256',
        name: 'amount',
        type: 'uint256',
      },
    ],
    name: 'updatePositionRewards',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      {
        internalType: 'address',
        name: 'savingsOwner',
        type: 'address',
      },
      {
        internalType: 'bytes32',
        name: 'frontendCode',
        type: 'bytes32',
      },
    ],
    name: 'updateSavingCode',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      {
        internalType: 'address',
        name: 'saver',
        type: 'address',
      },
      {
        internalType: 'uint256',
        name: 'interest',
        type: 'uint256',
      },
    ],
    name: 'updateSavingRewards',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      {
        internalType: 'bytes32',
        name: 'frontendCode',
        type: 'bytes32',
      },
    ],
    name: 'withdrawRewards',
    outputs: [
      {
        internalType: 'uint256',
        name: '',
        type: 'uint256',
      },
    ],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      {
        internalType: 'bytes32',
        name: 'frontendCode',
        type: 'bytes32',
      },
      {
        internalType: 'address',
        name: 'to',
        type: 'address',
      },
    ],
    name: 'withdrawRewardsTo',
    outputs: [
      {
        internalType: 'uint256',
        name: '',
        type: 'uint256',
      },
    ],
    stateMutability: 'nonpayable',
    type: 'function',
  },
] as const;

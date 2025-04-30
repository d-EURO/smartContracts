const { ethers } = require('hardhat');

// replace with a bytes32 string you want to decode
const bytes32 = '0x1000000000000000000000000000000000000000000000000000000000000000';

try {
  const attemptDecode = ethers.decodeBytes32String(bytes32);
  console.log('bytes32:', bytes32);
  console.log('Decoded bytes32:', attemptDecode);
  console.log('Decoded string length: ', attemptDecode.length);
  console.log('Decoded string ASCII: ', attemptDecode.charCodeAt(0));
} catch (error: any) {
  console.log('Could not decode to string:', error.message);
}

const { ethers } = require('ethers');
require('dotenv').config();

async function main() {
  const provider = new ethers.JsonRpcProvider(`https://eth-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}`);
  const wallet = new ethers.Wallet(process.env.DEPLOYER_PRIVATE_KEY, provider);

  console.log('Using account:', wallet.address);

  const dEUROAddress = '0xbA3f535bbCcCcA2A154b573Ca6c5A49BAAE0a3ea';
  const dEUROABI = [
    'function approve(address spender, uint256 amount) returns (bool)',
    'function suggestMinter(address _minter, uint256 _applicationPeriod, uint256 _applicationFee, string _message)',
    'function balanceOf(address) view returns (uint256)'
  ];

  const dEURO = new ethers.Contract(dEUROAddress, dEUROABI, wallet);

  const bridges = [
    { name: 'VEUR', address: '0x935332D2899EAdE0083f5398A154186aD8e5cF56', message: 'VEUR Bridge' },
    { name: 'EURS', address: '0x8A7984B542c38661e4FD04029A8F181fd088AC59', message: 'EURS Bridge' },
    { name: 'EURe', address: '0xf3432984b708A3Dc9555CcF9B4dBc78015DeB8FD', message: 'EURe Bridge' }
  ];

  const applicationPeriod = 1209600; // 14 days in seconds
  const applicationFee = ethers.parseEther('1000'); // 1000 dEURO

  // Check balance
  const balance = await dEURO.balanceOf(wallet.address);
  console.log('dEURO Balance:', ethers.formatEther(balance), 'dEURO');

  // First, approve dEURO spending
  console.log('\nApproving dEURO spending...');
  const totalFee = applicationFee * BigInt(bridges.length);
  const approveTx = await dEURO.approve(dEUROAddress, totalFee);
  console.log(`Approve transaction hash: ${approveTx.hash}`);
  await approveTx.wait();
  console.log('✅ Approval confirmed!');

  for (const bridge of bridges) {
    console.log(`\nSuggesting ${bridge.name} bridge as minter...`);
    console.log(`Address: ${bridge.address}`);

    const tx = await dEURO.suggestMinter(
      bridge.address,
      applicationPeriod,
      applicationFee,
      bridge.message
    );

    console.log(`Transaction hash: ${tx.hash}`);
    const receipt = await tx.wait();
    console.log(`✅ ${bridge.name} bridge suggested! Gas used: ${receipt.gasUsed.toString()}`);
  }

  console.log('\n🎉 All bridges suggested as minters!');
  console.log('⏳ Waiting period: 14 days');
  console.log('After 14 days, the bridges will be active (unless vetoed)');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

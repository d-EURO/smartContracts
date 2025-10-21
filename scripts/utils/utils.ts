// Known contract addresses for display formatting
// Populated after Citrea deployment
const KNOWN_ADDRESSES: Record<string, string> = {
  // Add deployed contract addresses here after deployment:
  // '0x...': 'JuiceDollar',
  // '0x...': 'Equity',
  // '0x...': 'PositionFactory',
  // '0x...': 'PositionRoller',
  // '0x...': 'StablecoinBridgeStartUSD',
  // '0x...': 'FrontendGateway',
  // '0x...': 'SavingsGateway',
  // '0x...': 'MintingHubGateway',
};

export function formatHash(
  hash: string,
  makeLink: boolean = false,
  linkType: string = 'address',
  replaceKnown: boolean = true,
): string {
  const formatted = (replaceKnown && KNOWN_ADDRESSES[hash.toLowerCase()]) || `${hash.slice(0, 6)}...${hash.slice(-4)}`;
  if (makeLink) {
    return hyperlink(etherscanUrl(hash, linkType), formatted);
  }
  return formatted;
}

export function hyperlink(url: string, text: string): string {
  // OSC 8 hyperlink escape sequence
  return `\u001b]8;;${url}\u0007${text}\u001b]8;;\u0007`;
}

export function etherscanUrl(hash: string, type: string = 'address'): string {
  return `https://etherscan.io/${type}/${hash}`;
}

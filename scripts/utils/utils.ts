const KNOWN_ADDRESSES: Record<string, string> = {
  '0x01ae4c18c2677f97bab536c48d6c36858f5c86d7': 'Deployer',
  '0xba3f535bbcccca2a154b573ca6c5a49baae0a3ea': 'DecentralizedEURO',
  '0xc71104001a3ccda1bef1177d765831bd1bfe8ee6': 'Equity',
  '0x167144d66ac1d02eaafca3649ef3305ea31ee5a8': 'PositionFactory',
  '0x4ce0ab2fc21bd27a47a64f594fdf7654ea57dc79': 'PositionRoller',
  '0xd03cd3ea55e67bc61b78a0d70ee93018e2182dbe': 'EURC-Bridge',
  '0x2353d16869f717bfcd22dabc0adbf4dca62c609f': 'EURT-Bridge',
  '0x3ed40fa0e5c803e807ebd51355e388006f9e1fee': 'VEUR-Bridge',
  '0x0423f419de1c44151b6b000e2daa51859c1d5d2a': 'EURS-Bridge',
  '0x103747924e74708139a9400e4ab4bea79fffa380': 'DEPSWrapper',
  '0x5c49c00f897bd970d964bfb8c3065ae65a180994': 'FrontendGateway',
  '0x073493d73258c4beb6542e8dd3e1b2891c972303': 'SavingsGateway',
  '0x8b3c41c649b9c7085c171cbb82337889b3604618': 'MintingHubGateway',
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

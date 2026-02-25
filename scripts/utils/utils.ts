export function formatHash(
  hash: string,
  makeLink: boolean = false,
  linkType: string = 'address',
): string {
  const formatted = `${hash.slice(0, 6)}...${hash.slice(-4)}`;
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

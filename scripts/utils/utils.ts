export function formatAddress(address: string, makeLink: boolean = false) {
  const formatted = `${address.slice(0, 6)}...${address.slice(-4)}`;
  if (makeLink) {
    return createHyperlink(`https://etherscan.io/address/${address}`, formatted);
  }
  return formatted;
}

export function createHyperlink(url: string, text: string): string {
  // OSC 8 hyperlink escape sequence
  return `\u001b]8;;${url}\u0007${text}\u001b]8;;\u0007`;
}
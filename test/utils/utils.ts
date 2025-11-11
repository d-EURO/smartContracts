export function capitalToShares(
  totalCapital: bigint,
  totalShares: bigint,
  dCapital: bigint
): bigint {
  if (totalShares == 0n) {
    return 100000000n;
  } else {
    return (
      totalShares *
      (((totalCapital + dCapital) / totalCapital) ** (1n / 3n) - 1n)
    );
  }
}
export function sharesToCapital(
  totalCapital: bigint,
  totalShares: bigint,
  dShares: bigint
) {
  return -totalCapital * (((totalShares - dShares) / totalShares) ** 3n - 1n);
}
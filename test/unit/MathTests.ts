import { expect } from "chai";
import { floatToDec18, abs } from "../../scripts/utils/math";
import { TestMathUtil } from "../../typechain";
import { ethers } from "hardhat";

describe("Math Tests", () => {
  let MathContract: TestMathUtil;

  const expectResult = (result: number, fResult: bigint) => {
    const err = abs(floatToDec18(result) - fResult);
    if (err > BigInt(10e6)) {
      console.log("expected=", result);
      console.log("received=", fResult);
      console.log("abs error=", err);
    }
    expect(err).to.be.lessThan(BigInt(10e6));
  };

  before(async () => {
    const factory = await ethers.getContractFactory("TestMathUtil");
    MathContract = await factory.deploy();
  });

  describe("math", () => {
    it("div", async () => {
      const a = 1.5;
      const b = 0.4;
      const result = a / b;
      const fA = floatToDec18(a);
      const fB = floatToDec18(b);
      const fResult = await MathContract.divD18(fA, fB);
      expectResult(result, fResult);
    });

    it("mul", async () => {
      const a = 1.5;
      const b = 0.4;
      const result = a * b;
      const fA = floatToDec18(a);
      const fB = floatToDec18(b);
      const fResult = await MathContract.mulD18(fA, fB);
      expectResult(result, fResult);
    });

    it("pow10", async () => {
      const testCases = [0.5, 0.9, 1.0, 1.5, 2.0, 5.0, 10.0];
      for (const a of testCases) {
        const result = a ** 10;
        const fA = floatToDec18(a);
        const fResult = await MathContract.power10(fA);
        expectResult(result, fResult);
      }
    });

    it("tenth root", async () => {
      const numbers = [
        0.01, 0.1, 0.5, 0.9,
        1, 1.00000005, 1.000003, 1.0002, 1.01,
        1000000000000
      ];
      for (const number of numbers) {
        const result = number ** (1 / 10);
        const fNumber = floatToDec18(number);
        const tx = await MathContract.tenthRoot(fNumber, true);
        await expect(tx).to.not.be.reverted;
        const fResult = await MathContract.result();
        expectResult(result, fResult);
      }
    });

    it("tenth root powers of 2", async () => {
      const testCases = [
        { input: 2, expected: 2 ** 0.1 },
        { input: 32, expected: Math.sqrt(2) },
        { input: 1024, expected: 2 },
      ];
      for (const test of testCases) {
        const fNumber = floatToDec18(test.input);
        const tx = await MathContract.tenthRoot(fNumber, true);
        await expect(tx).to.not.be.reverted;
        const fResult = await MathContract.result();
        expectResult(test.expected, fResult);
      }
    });

    it("round-trip power10 and tenth root", async () => {
      const testCases = [0.5, 1.5, 2.0, 10.0];
      for (const x of testCases) {
        const fX = floatToDec18(x);
        const fPow10 = await MathContract.power10(fX);
        await MathContract.tenthRoot(fPow10, true);
        const fRoundTrip = await MathContract.result();
        expectResult(x, fRoundTrip);
      }
    });

    it("total shares", async () => {
      const totalShares = floatToDec18(10000);
      const capitalBefore = floatToDec18(1000000000000); // 1000 billion
      const numbers = [
        7000000000000, 1000, 100, 10, 1, 0.1, 0.01, 0.001, 0.0001, 0.00001,
      ];
      for (let k = 0; k < numbers.length; k++) {
        const fNumber = floatToDec18(numbers[k]);
        const fResult = await MathContract.calculateShares(
          totalShares,
          capitalBefore,
          fNumber,
        );
        expect(fResult).to.be.above(0n);
      }
    });
  });
});

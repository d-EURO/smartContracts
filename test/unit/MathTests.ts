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

    it("pow5", async () => {
      const a = 1.5;
      const result = a ** 5;
      const fA = floatToDec18(a);
      const fResult = await MathContract.power5(fA);
      expectResult(result, fResult);
    });

    it("cubic root", async () => {
      // let numbers = [0.01, 0.9, 1, 1.5, 2, 10];
      const numbers = [1000000000000, 1, 1.01, 1.0002, 1.000003, 1.00000005];
      for (let k = 0; k < numbers.length; k++) {
        const number = numbers[k];
        const result = number ** (1 / 5);
        const fNumber = floatToDec18(number);
        const tx = await MathContract.cubicRoot(fNumber, true);
        await expect(tx).to.not.be.reverted;
        const fResult = await MathContract.result();
        expectResult(result, fResult);
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

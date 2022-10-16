import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { ethers, upgrades } from 'hardhat'
import { Contract, Signer, BigNumber, BigNumberish, Event } from 'ethers'
import { TransactionResponse } from '@ethersproject/providers'
import { expect } from 'chai'
import { BigNumber as BN } from 'bignumber.js'

const imul = (a: BigNumberish, b: BigNumberish, c: BigNumberish) => {
  return ethers.BigNumber.from(
    new BN(a.toString()).times(b.toString()).idiv(c.toString()).toString(10),
  )
}

export const increaseTime = async (seconds: BigNumberish) => {
  const now = (await ethers.provider.getBlock('latest')).timestamp
  await ethers.provider.send('evm_mine', [
    ethers.BigNumber.from(seconds).add(now).toNumber(),
  ])
}

let policyMaker: Contract,
  mockParseToken: Contract,
  mockMarketOracle: Contract,
  mockCpiOracle: Contract
let prevEpoch: BigNumber, prevTime: BigNumber
let deployer: Signer, user: Signer, orchestrator: Signer

const MAX_RATE = ethers.utils.parseUnits('1', 24)
const MAX_SUPPLY = ethers.BigNumber.from(2).pow(255).sub(1).div(MAX_RATE)
const BASE_CPI = ethers.utils.parseUnits('1', 20)
const INITIAL_CPI = ethers.utils.parseUnits('251.712', 18)

const INITIAL_CPI_25P_MORE = imul(INITIAL_CPI, '1.25', 1)
const INITIAL_CPI_25P_LESS = imul(INITIAL_CPI, '0.75', 1)
const INITIAL_RATE = imul(INITIAL_CPI, 1e18, BASE_CPI)
const INITIAL_RATE_30P_MORE = imul(INITIAL_RATE, '1.3', 1)
const INITIAL_RATE_30P_LESS = imul(INITIAL_RATE, '0.7', 1)
const INITIAL_RATE_5P_MORE = imul(INITIAL_RATE, '1.05', 1)
const INITIAL_RATE_5P_LESS = imul(INITIAL_RATE, '0.95', 1)
const INITIAL_RATE_60P_MORE = imul(INITIAL_RATE, '1.6', 1)
const INITIAL_RATE_50P_LESS = imul(INITIAL_RATE, '0.5', 1)
const INITIAL_RATE_2X = INITIAL_RATE.mul(2)

async function mockedUpgradablePolicy() {
  // get signers
  const [deployer, user, orchestrator] = await ethers.getSigners()
  // deploy mocks
  const mockParseToken = await (
    await ethers.getContractFactory('MockParseToken')
  )
    .connect(deployer)
    .deploy()
  const mockMarketOracle = await (await ethers.getContractFactory('MockOracle'))
    .connect(deployer)
    .deploy('MarketOracle')
  const mockCpiOracle = await (await ethers.getContractFactory('MockOracle'))
    .connect(deployer)
    .deploy('CpiOracle')
  // deploy upgradable contract
  const policyMaker = await upgrades.deployProxy(
    (await ethers.getContractFactory('PolicyMaker')).connect(deployer),
    [mockParseToken.address, BASE_CPI.toString()],
    {
      initializer: 'initialize(address,uint256)',
    },
  )
  // setup oracles
  await policyMaker
    .connect(deployer)
    .setMarketOracle(mockMarketOracle.address)
  await policyMaker.connect(deployer).setCpiOracle(mockCpiOracle.address)
  await policyMaker
    .connect(deployer)
    .setOrchestrator(await orchestrator.getAddress())
  // return entities
  return {
    deployer,
    user,
    orchestrator,
    mockParseToken,
    mockMarketOracle,
    mockCpiOracle,
    policyMaker,
  }
}
function toBN(x: string) {
  return ethers.utils.parseUnits(x, 18);
}


async function mockedUpgradablePolicyWithOpenRebaseWindow() {
  const {
    deployer,
    user,
    orchestrator,
    mockParseToken,
    mockMarketOracle,
    mockCpiOracle,
    policyMaker,
  } = await mockedUpgradablePolicy()
  await policyMaker.connect(deployer).setTimingParameters(60, 0, 60)
  await policyMaker.connect(deployer).setTaxParameters(toBN('0.01'), toBN('0.01'), toBN('0.01'));
  return {
    deployer,
    user,
    orchestrator,
    mockParseToken,
    mockMarketOracle,
    mockCpiOracle,
    policyMaker,
  }
}

async function mockExternalData(
  rate: BigNumberish,
  cpi: BigNumberish,
  uFragSupply: BigNumberish,
  rateValidity = true,
  cpiValidity = true,
) {
  await mockMarketOracle.connect(deployer).storeData(rate)
  await mockMarketOracle.connect(deployer).storeValidity(rateValidity)
  await mockCpiOracle.connect(deployer).storeData(cpi)
  await mockCpiOracle.connect(deployer).storeValidity(cpiValidity)
  await mockParseToken.connect(deployer).storeSupply(uFragSupply)
}

async function parseRebaseLog(response: Promise<TransactionResponse>) {
  const receipt = (await (await response).wait()) as any
  const logs = receipt.events.filter(
    (event: Event) => event.event === 'LogRebase',
  )
  return logs[0].args
}

describe('UFragmentsPolicy', function () {
  before('setup UFragmentsPolicy contract', async () => {
    ; ({
      deployer,
      user,
      orchestrator,
      mockParseToken,
      mockMarketOracle,
      mockCpiOracle,
      policyMaker,
    } = await loadFixture(mockedUpgradablePolicy))
  })

  it('should reject any ether sent to it', async function () {
    await expect(
      user.sendTransaction({ to: policyMaker.address, value: 1 }),
    ).to.be.reverted
  })
})

describe('UFragmentsPolicy:initialize', async function () {
  describe('initial values set correctly', function () {
    before('setup UFragmentsPolicy contract', async () => {
      ; ({
        deployer,
        user,
        orchestrator,
        mockParseToken,
        mockMarketOracle,
        mockCpiOracle,
        policyMaker,
      } = await loadFixture(mockedUpgradablePolicy))
    })


    it('minRebaseOrTaxTimeIntervalSec', async function () {
      expect(await policyMaker.minRebaseOrTaxTimeIntervalSec()).to.eq(
        24 * 60 * 60,
      )
    })
    it('epoch', async function () {
      expect(await policyMaker.rebaseEpoch()).to.eq(0)
    })

    it('rebaseOrTaxWindowOffsetSec', async function () {
      expect(await policyMaker.rebaseOrTaxWindowOffsetSec()).to.eq(7200)
    })
    it('rebaseOrTaxWindowLengthSec', async function () {
      expect(await policyMaker.rebaseOrTaxWindowLengthSec()).to.eq(1200)
    })
    it('should set owner', async function () {
      expect(await policyMaker.owner()).to.eq(await deployer.getAddress())
    })
    it('should set reference to uFragments', async function () {
      expect(await policyMaker.parseToken()).to.eq(mockParseToken.address)
    })
  })
})

describe('UFragmentsPolicy:setMarketOracle', async function () {
  before('setup UFragmentsPolicy contract', async () => {
    ; ({
      deployer,
      user,
      orchestrator,
      mockParseToken,
      mockMarketOracle,
      mockCpiOracle,
      policyMaker,
    } = await loadFixture(mockedUpgradablePolicy))
  })

  it('should set marketOracle', async function () {
    await policyMaker
      .connect(deployer)
      .setMarketOracle(await deployer.getAddress())
    expect(await policyMaker.marketOracle()).to.eq(
      await deployer.getAddress(),
    )
  })
})

describe('UFragments:setMarketOracle:accessControl', function () {
  before('setup UFragmentsPolicy contract', async () => {
    ; ({
      deployer,
      user,
      orchestrator,
      mockParseToken,
      mockMarketOracle,
      mockCpiOracle,
      policyMaker,
    } = await loadFixture(mockedUpgradablePolicy))
  })

  it('should be callable by owner', async function () {
    await expect(
      policyMaker
        .connect(deployer)
        .setMarketOracle(await deployer.getAddress()),
    ).to.not.be.reverted
  })

  it('should NOT be callable by non-owner', async function () {
    await expect(
      policyMaker
        .connect(user)
        .setMarketOracle(await deployer.getAddress()),
    ).to.be.reverted
  })
})

describe('UFragmentsPolicy:setCpiOracle', async function () {
  before('setup UFragmentsPolicy contract', async () => {
    ; ({
      deployer,
      user,
      orchestrator,
      mockParseToken,
      mockMarketOracle,
      mockCpiOracle,
      policyMaker,
    } = await loadFixture(mockedUpgradablePolicy))
  })

  it('should set cpiOracle', async function () {
    await policyMaker
      .connect(deployer)
      .setCpiOracle(await deployer.getAddress())
    expect(await policyMaker.cpiOracle()).to.eq(
      await deployer.getAddress(),
    )
  })
})

describe('UFragments:setCpiOracle:accessControl', function () {
  before('setup UFragmentsPolicy contract', async () => {
    ; ({
      deployer,
      user,
      orchestrator,
      mockParseToken,
      mockMarketOracle,
      mockCpiOracle,
      policyMaker,
    } = await loadFixture(mockedUpgradablePolicy))
  })

  it('should be callable by owner', async function () {
    await expect(
      policyMaker
        .connect(deployer)
        .setCpiOracle(await deployer.getAddress()),
    ).to.not.be.reverted
  })

  it('should NOT be callable by non-owner', async function () {
    await expect(
      policyMaker.connect(user).setCpiOracle(await deployer.getAddress()),
    ).to.be.reverted
  })
})

describe('UFragmentsPolicy:setOrchestrator', async function () {
  before('setup UFragmentsPolicy contract', async () => {
    ; ({
      deployer,
      user,
      orchestrator,
      mockParseToken,
      mockMarketOracle,
      mockCpiOracle,
      policyMaker,
    } = await loadFixture(mockedUpgradablePolicy))
  })

  it('should set orchestrator', async function () {
    await policyMaker
      .connect(deployer)
      .setOrchestrator(await user.getAddress())
    expect(await policyMaker.orchestrator()).to.eq(await user.getAddress())
  })
})

describe('UFragments:setOrchestrator:accessControl', function () {
  before('setup UFragmentsPolicy contract', async () => {
    ; ({
      deployer,
      user,
      orchestrator,
      mockParseToken,
      mockMarketOracle,
      mockCpiOracle,
      policyMaker,
    } = await loadFixture(mockedUpgradablePolicy))
  })

  it('should be callable by owner', async function () {
    await expect(
      policyMaker
        .connect(deployer)
        .setOrchestrator(await deployer.getAddress()),
    ).to.not.be.reverted
  })

  it('should NOT be callable by non-owner', async function () {
    await expect(
      policyMaker
        .connect(user)
        .setOrchestrator(await deployer.getAddress()),
    ).to.be.reverted
  })
})

describe('UFragmentsPolicy:CurveParameters', async function () {
  before('setup UFragmentsPolicy contract', async function () {
    ; ({
      deployer,
      user,
      orchestrator,
      mockParseToken,
      mockMarketOracle,
      mockCpiOracle,
      policyMaker,
    } = await loadFixture(mockedUpgradablePolicy))
  })

  describe('when rebaseFunctionGrowth is more than 0', async function () {
    it('should setRebaseFunctionGrowth', async function () {
      await policyMaker.connect(deployer).setRebaseFunctionGrowth(1000)
      expect(await policyMaker.rebaseFunctionGrowth()).to.eq(1000)
    })
  })

  describe('when rebaseFunctionGrowth is less than 0', async function () {
    it('should fail', async function () {
      await expect(
        policyMaker.connect(deployer).setRebaseFunctionGrowth(-1),
      ).to.be.reverted
    })
  })

  describe('when rebaseFunctionLowerPercentage is more than 0', async function () {
    it('should fail', async function () {
      await expect(
        policyMaker
          .connect(deployer)
          .setRebaseFunctionLowerPercentage(1000),
      ).to.be.reverted
    })
  })

  describe('when rebaseFunctionLowerPercentage is less than 0', async function () {
    it('should setRebaseFunctionLowerPercentage', async function () {
      await policyMaker
        .connect(deployer)
        .setRebaseFunctionLowerPercentage(-1)
      expect(await policyMaker.rebaseFunctionLowerPercentage()).to.eq(-1)
    })
  })

  describe('when rebaseFunctionUpperPercentage is less than 0', async function () {
    it('should fail', async function () {
      await expect(
        policyMaker.connect(deployer).setRebaseFunctionUpperPercentage(-1),
      ).to.be.reverted
    })
  })

  describe('when rebaseFunctionUpperPercentage is more than 0', async function () {
    it('should setRebaseFunctionUpperPercentage', async function () {
      await policyMaker
        .connect(deployer)
        .setRebaseFunctionUpperPercentage(1000)
      expect(await policyMaker.rebaseFunctionUpperPercentage()).to.eq(1000)
    })
  })
})

describe('UFragments:setRebaseFunctionGrowth:accessControl', function () {
  before('setup UFragmentsPolicy contract', async () => {
    ; ({
      deployer,
      user,
      orchestrator,
      mockParseToken,
      mockMarketOracle,
      mockCpiOracle,
      policyMaker,
    } = await loadFixture(mockedUpgradablePolicy))
  })

  it('should be callable by owner', async function () {
    await expect(policyMaker.connect(deployer).setRebaseFunctionGrowth(1))
      .to.not.be.reverted
  })

  it('should NOT be callable by non-owner', async function () {
    await expect(policyMaker.connect(user).setRebaseFunctionGrowth(1)).to
      .be.reverted
  })
})

describe('UFragments:setRebaseFunctionLowerPercentage:accessControl', function () {
  before('setup UFragmentsPolicy contract', async () => {
    ; ({
      deployer,
      user,
      orchestrator,
      mockParseToken,
      mockMarketOracle,
      mockCpiOracle,
      policyMaker,
    } = await loadFixture(mockedUpgradablePolicy))
  })

  it('should be callable by owner', async function () {
    await expect(
      policyMaker.connect(deployer).setRebaseFunctionLowerPercentage(-1),
    ).to.not.be.reverted
  })

  it('should NOT be callable by non-owner', async function () {
    await expect(
      policyMaker.connect(user).setRebaseFunctionLowerPercentage(-1),
    ).to.be.reverted
  })
})

describe('UFragments:setRebaseFunctionUpperPercentage:accessControl', function () {
  before('setup UFragmentsPolicy contract', async () => {
    ; ({
      deployer,
      user,
      orchestrator,
      mockParseToken,
      mockMarketOracle,
      mockCpiOracle,
      policyMaker,
    } = await loadFixture(mockedUpgradablePolicy))
  })

  it('should be callable by owner', async function () {
    await expect(
      policyMaker.connect(deployer).setRebaseFunctionUpperPercentage(1),
    ).to.not.be.reverted
  })

  it('should NOT be callable by non-owner', async function () {
    await expect(
      policyMaker.connect(user).setRebaseFunctionUpperPercentage(1),
    ).to.be.reverted
  })
})

describe('UFragmentsPolicy:setTimingParameters', async function () {
  before('setup UFragmentsPolicy contract', async function () {
    ; ({
      deployer,
      user,
      orchestrator,
      mockParseToken,
      mockMarketOracle,
      mockCpiOracle,
      policyMaker,
    } = await loadFixture(mockedUpgradablePolicy))
  })

  describe('when interval=0', function () {
    it('should fail', async function () {
      await expect(
        policyMaker.connect(deployer).setTimingParameters(0, 0, 0),
      ).to.be.reverted
    })
  })

  describe('when offset > interval', function () {
    it('should fail', async function () {
      await expect(
        policyMaker
          .connect(deployer)
          .setTimingParameters(300, 3600, 300),
      ).to.be.reverted
    })
  })

  describe('when params are valid', function () {
    it('should setTimingParameters', async function () {
      await policyMaker
        .connect(deployer)
        .setTimingParameters(600, 60, 300)
      expect(await policyMaker.minRebaseOrTaxTimeIntervalSec()).to.eq(600)
      expect(await policyMaker.rebaseOrTaxWindowOffsetSec()).to.eq(60)
      expect(await policyMaker.rebaseOrTaxWindowLengthSec()).to.eq(300)
    })
  })
})

describe('UFragments:setTimingParameters:accessControl', function () {
  before('setup UFragmentsPolicy contract', async () => {
    ; ({
      deployer,
      user,
      orchestrator,
      mockParseToken,
      mockMarketOracle,
      mockCpiOracle,
      policyMaker,
    } = await loadFixture(mockedUpgradablePolicy))
  })

  it('should be callable by owner', async function () {
    await expect(
      policyMaker
        .connect(deployer)
        .setTimingParameters(600, 60, 300),
    ).to.not.be.reverted
  })

  it('should NOT be callable by non-owner', async function () {
    await expect(
      policyMaker.connect(user).setTimingParameters(600, 60, 300),
    ).to.be.reverted
  })
})

describe('UFragmentsPolicy:Rebase:accessControl', async function () {
  beforeEach('setup UFragmentsPolicy contract', async function () {
    ; ({
      deployer,
      user,
      orchestrator,
      mockParseToken,
      mockMarketOracle,
      mockCpiOracle,
      policyMaker,
    } = await loadFixture(mockedUpgradablePolicyWithOpenRebaseWindow))
    // await setupContractsWithOpenRebaseWindow()
    await mockExternalData(INITIAL_RATE_30P_MORE, INITIAL_CPI, 1000, true)
    await increaseTime(60)
  })

  describe('when rebase called by orchestrator', function () {
    it('should succeed', async function () {
      await expect(policyMaker.connect(orchestrator).rebaseOrTax()).to.not.be
        .reverted
    })
  })

  describe('when rebase called by non-orchestrator', function () {
    it('should fail', async function () {
      await expect(policyMaker.connect(user).rebaseOrTax()).to.be.reverted
    })
  })
})

describe('UFragmentsPolicy:Rebase', async function () {
  before('setup UFragmentsPolicy contract', async () => {
    ; ({
      deployer,
      user,
      orchestrator,
      mockParseToken,
      mockMarketOracle,
      mockCpiOracle,
      policyMaker,
    } = await loadFixture(mockedUpgradablePolicyWithOpenRebaseWindow))
  })

  describe('when minRebaseOrTaxTimeIntervalSec has NOT passed since the previous rebase', function () {
    before(async function () {
      await mockExternalData(INITIAL_RATE_30P_MORE, INITIAL_CPI, 1010)
      await increaseTime(60)
      await policyMaker.connect(orchestrator).rebaseOrTax()
    })

    it('should fail', async function () {
      await expect(policyMaker.connect(orchestrator).rebaseOrTax()).to.be
        .reverted
    })
  })
})

// describe('UFragmentsPolicy:Rebase', async function () {
//   before('setup UFragmentsPolicy contract', async () => {
//     ; ({
//       deployer,
//       user,
//       orchestrator,
//       mockParseToken,
//       mockMarketOracle,

//       mockCpiOracle,
//       policyMaker,
//     } = await loadFixture(mockedUpgradablePolicyWithOpenRebaseWindow))
//   })

//   describe('when rate is within deviationThreshold', function () {
//     before(async function () {
//       await policyMaker
//         .connect(deployer)
//         .setTimingParameters(60, 0, 60)
//     })

//     it('should return 0', async function () {
//       await mockExternalData(INITIAL_RATE.sub(1), INITIAL_CPI, 1000)
//       await increaseTime(60)
//       expect(
//         (await parseRebaseLog(policyMaker.connect(orchestrator).rebaseOrTax()))
//           .requestedSupplyAdjustment,
//       ).to.eq(0)
//       await increaseTime(60)

//       await mockExternalData(INITIAL_RATE.add(1), INITIAL_CPI, 1000)
//       expect(
//         (await parseRebaseLog(policyMaker.connect(orchestrator).rebaseOrTax()))
//           .requestedSupplyAdjustment,
//       ).to.eq(0)
//       await increaseTime(60)

//       await mockExternalData(INITIAL_RATE_5P_MORE.sub(2), INITIAL_CPI, 1000)
//       expect(
//         (await parseRebaseLog(policyMaker.connect(orchestrator).rebaseOrTax()))
//           .requestedSupplyAdjustment,
//       ).to.eq(0)
//       await increaseTime(60)

//       await mockExternalData(INITIAL_RATE_5P_LESS.add(2), INITIAL_CPI, 1000)
//       expect(
//         (await parseRebaseLog(policyMaker.connect(orchestrator).rebaseOrTax()))
//           .requestedSupplyAdjustment,
//       ).to.eq(0)
//       await increaseTime(60)
//     })
//   })
// })

describe('UFragmentsPolicy:Rebase', async function () {
  before('setup UFragmentsPolicy contract', async () => {
    ; ({
      deployer,
      user,
      orchestrator,
      mockParseToken,
      mockMarketOracle,
      mockCpiOracle,
      policyMaker,
    } = await loadFixture(mockedUpgradablePolicyWithOpenRebaseWindow))
  })

  describe('when rate is more than MAX_RATE', function () {
    it('should return same supply delta as delta for MAX_RATE', async function () {
      // Any exchangeRate >= (MAX_RATE=100x) would result in the same supply increase
      await mockExternalData(MAX_RATE, INITIAL_CPI, 1000)
      await increaseTime(60)

      const supplyChange = (
        await parseRebaseLog(policyMaker.connect(orchestrator).rebaseOrTax())
      ).requestedSupplyAdjustment

      await increaseTime(60)

      await mockExternalData(
        MAX_RATE.add(ethers.utils.parseUnits('1', 17)),
        INITIAL_CPI,
        1000,
      )
      expect(
        (await parseRebaseLog(policyMaker.connect(orchestrator).rebaseOrTax()))
          .requestedSupplyAdjustment,
      ).to.eq(supplyChange)

      await increaseTime(60)

      await mockExternalData(MAX_RATE.mul(2), INITIAL_CPI, 1000)
      expect(
        (await parseRebaseLog(policyMaker.connect(orchestrator).rebaseOrTax()))
          .requestedSupplyAdjustment,
      ).to.eq(supplyChange)
    })
  })
})

describe('UFragmentsPolicy:Rebase', async function () {
  before('setup UFragmentsPolicy contract', async () => {
    ; ({
      deployer,
      user,
      orchestrator,
      mockParseToken,
      mockMarketOracle,
      mockCpiOracle,
      policyMaker,
    } = await loadFixture(mockedUpgradablePolicyWithOpenRebaseWindow))
  })

  describe('when uFragments grows beyond MAX_SUPPLY', function () {
    before(async function () {
      await mockExternalData(INITIAL_RATE_2X, INITIAL_CPI, MAX_SUPPLY.sub(1))
      await increaseTime(60)
    })

    it('should apply SupplyAdjustment {MAX_SUPPLY - totalSupply}', async function () {
      // Supply is MAX_SUPPLY-1, exchangeRate is 2x; resulting in a new supply more than MAX_SUPPLY
      // However, supply is ONLY increased by 1 to MAX_SUPPLY
      expect(
        (await parseRebaseLog(policyMaker.connect(orchestrator).rebaseOrTax()))
          .requestedSupplyAdjustment,
      ).to.eq(1)
    })
  })
})

describe('UFragmentsPolicy:Rebase', async function () {
  before('setup UFragmentsPolicy contract', async () => {
    ; ({
      deployer,
      user,
      orchestrator,
      mockParseToken,
      mockMarketOracle,
      mockCpiOracle,
      policyMaker,
    } = await loadFixture(mockedUpgradablePolicyWithOpenRebaseWindow))
  })

  describe('when uFragments supply equals MAX_SUPPLY and rebase attempts to grow', function () {
    before(async function () {
      await mockExternalData(INITIAL_RATE_2X, INITIAL_CPI, MAX_SUPPLY)
      await increaseTime(60)
    })

    it('should not grow', async function () {
      expect(
        (await parseRebaseLog(policyMaker.connect(orchestrator).rebaseOrTax()))
          .requestedSupplyAdjustment,
      ).to.eq(0)
    })
  })
})

describe('UFragmentsPolicy:Rebase', async function () {
  before('setup UFragmentsPolicy contract', async () => {
    ; ({
      deployer,
      user,
      orchestrator,
      mockParseToken,
      mockMarketOracle,
      mockCpiOracle,
      policyMaker,
    } = await loadFixture(mockedUpgradablePolicyWithOpenRebaseWindow))
  })

  describe('when the market oracle returns invalid data', function () {
    it('should fail', async function () {
      await mockExternalData(INITIAL_RATE_30P_MORE, INITIAL_CPI, 1000, false)
      await increaseTime(60)
      await expect(policyMaker.connect(orchestrator).rebaseOrTax()).to.be
        .reverted
    })
  })

  describe('when the market oracle returns valid data', function () {
    it('should NOT fail', async function () {
      await mockExternalData(INITIAL_RATE_30P_MORE, INITIAL_CPI, 1000, true)
      await increaseTime(60)
      await expect(policyMaker.connect(orchestrator).rebaseOrTax()).to.not.be
        .reverted
    })
  })
})

describe('UFragmentsPolicy:Rebase', async function () {
  before('setup UFragmentsPolicy contract', async () => {
    ; ({
      deployer,
      user,
      orchestrator,
      mockParseToken,
      mockMarketOracle,
      mockCpiOracle,
      policyMaker,
    } = await loadFixture(mockedUpgradablePolicyWithOpenRebaseWindow))
  })

  describe('when the cpi oracle returns invalid data', function () {
    it('should fail', async function () {
      await mockExternalData(
        INITIAL_RATE_30P_MORE,
        INITIAL_CPI,
        1000,
        true,
        false,
      )
      await increaseTime(60)
      await expect(policyMaker.connect(orchestrator).rebaseOrTax()).to.be
        .reverted
    })
  })

  describe('when the cpi oracle returns valid data', function () {
    it('should NOT fail', async function () {
      await mockExternalData(
        INITIAL_RATE_30P_MORE,
        INITIAL_CPI,
        1000,
        true,
        true,
      )
      await increaseTime(60)
      await expect(policyMaker.connect(orchestrator).rebaseOrTax()).to.not.be
        .reverted
    })
  })
})

describe('UFragmentsPolicy:Rebase', async function () {
  before('setup UFragmentsPolicy contract', async () => {
    ; ({
      deployer,
      user,
      orchestrator,
      mockParseToken,
      mockMarketOracle,
      mockCpiOracle,
      policyMaker,
    } = await loadFixture(mockedUpgradablePolicyWithOpenRebaseWindow))
  })

  describe('positive rate and no change CPI', function () {
    beforeEach(async function () {
      await mockExternalData(INITIAL_RATE_30P_MORE, INITIAL_CPI, 1000)
      await policyMaker
        .connect(deployer)
        .setTimingParameters(60, 0, 60)
      await increaseTime(60)
      await policyMaker.connect(orchestrator).rebaseOrTax()
      prevEpoch = await policyMaker.rebaseEpoch()
      prevTime = await policyMaker.lastRebaseOrTaxTimestampSec()
      await mockExternalData(INITIAL_RATE_60P_MORE, INITIAL_CPI, 1010)
      await increaseTime(60)
    })

    it('should increment epoch', async function () {
      await policyMaker.connect(orchestrator).rebaseOrTax()
      expect(await policyMaker.rebaseEpoch()).to.eq(prevEpoch.add(1))
    })



    it('should update lastRebaseTimestamp', async function () {
      await policyMaker.connect(orchestrator).rebaseOrTax()
      const time = await policyMaker.lastRebaseOrTaxTimestampSec()
      expect(time.sub(prevTime)).to.gte(60)
    })

    it('should emit Rebase with positive requestedSupplyAdjustment', async function () {
      const r = policyMaker.connect(orchestrator).rebaseOrTax()
      await expect(r)
        .to.emit(policyMaker, 'LogRebase')
        .withArgs(
          prevEpoch.add(1),
          INITIAL_RATE_60P_MORE,
          INITIAL_CPI,
          55,
          (
            await parseRebaseLog(r)
          ).timestampSec,
        )
    })

    it('should call getData from the market oracle', async function () {
      await expect(policyMaker.connect(orchestrator).rebaseOrTax())
        .to.emit(mockMarketOracle, 'FunctionCalled')
        .withArgs('MarketOracle', 'getData', policyMaker.address)
    })

    it('should call getData from the cpi oracle', async function () {
      await expect(policyMaker.connect(orchestrator).rebaseOrTax())
        .to.emit(mockCpiOracle, 'FunctionCalled')
        .withArgs('CpiOracle', 'getData', policyMaker.address)
    })

    it('should call uFrag Rebase', async function () {
      const r = policyMaker.connect(orchestrator).rebaseOrTax()
      await expect(r)
        .to.emit(mockParseToken, 'FunctionCalled')
        .withArgs('UFragments', 'rebase', policyMaker.address)
      await expect(r)
        .to.emit(mockParseToken, 'FunctionArguments')
        .withArgs([prevEpoch.add(1)], [55])
    })
  })
})

describe('UFragmentsPolicy:Rebase', async function () {
  before('setup UFragmentsPolicy contract', async () => {
    ; ({
      deployer,
      user,
      orchestrator,
      mockParseToken,
      mockMarketOracle,
      mockCpiOracle,
      policyMaker,
    } = await loadFixture(mockedUpgradablePolicyWithOpenRebaseWindow))
  })

  describe('negative rate', function () {
    before(async function () {
      await mockExternalData(INITIAL_RATE_30P_LESS, INITIAL_CPI, 1000)
      await increaseTime(60)
    })

    it('should emit Rebase with negative requestedSupplyAdjustment', async function () {
      expect(
        (await parseRebaseLog(policyMaker.connect(orchestrator).rebaseOrTax()))
          .requestedSupplyAdjustment,
      ).to.eq(-29)
    })
  })

  describe('max positive rebase', function () {
    before(async function () {
      await mockExternalData(INITIAL_RATE_2X, INITIAL_CPI, 1000)
      await policyMaker
        .connect(deployer)
        .setRebaseFunctionGrowth('100' + '000000000000000000')
      await increaseTime(60)
    })

    it('should emit Rebase with positive requestedSupplyAdjustment', async function () {
      expect(
        (await parseRebaseLog(policyMaker.connect(orchestrator).rebaseOrTax()))
          .requestedSupplyAdjustment,
      ).to.eq(100)
    })
  })

  describe('max negative rebase', function () {
    before(async function () {
      await mockExternalData(0, INITIAL_CPI, 1000)
      await policyMaker
        .connect(deployer)
        .setRebaseFunctionGrowth('75' + '000000000000000000')
      await increaseTime(60)
    })

    it('should emit Rebase with negative requestedSupplyAdjustment', async function () {
      expect(
        (await parseRebaseLog(policyMaker.connect(orchestrator).rebaseOrTax()))
          .requestedSupplyAdjustment,
      ).to.eq(-100)
    })
  })

  describe('exponent less than -100', function () {
    before(async function () {
      await mockExternalData(0, INITIAL_CPI, 1000)
      await policyMaker
        .connect(deployer)
        .setRebaseFunctionGrowth('150' + '000000000000000000')
      await increaseTime(60)
    })

    it('should emit Rebase with negative requestedSupplyAdjustment', async function () {
      expect(
        (await parseRebaseLog(policyMaker.connect(orchestrator).rebaseOrTax()))
          .requestedSupplyAdjustment,
      ).to.eq(-100)
    })
  })
})

describe('UFragmentsPolicy:Rebase', async function () {
  before('setup UFragmentsPolicy contract', async () => {
    ; ({
      deployer,
      user,
      orchestrator,
      mockParseToken,
      mockMarketOracle,
      mockCpiOracle,
      policyMaker,
    } = await loadFixture(mockedUpgradablePolicyWithOpenRebaseWindow))
  })

  describe('when cpi increases', function () {
    before(async function () {
      await mockExternalData(INITIAL_RATE, INITIAL_CPI_25P_MORE, 1000)
      await increaseTime(60)
      await policyMaker.connect(deployer).setDeviationThresholds(0, 0)
    })

    it('should emit Rebase with negative requestedSupplyAdjustment', async function () {
      expect(
        (await parseRebaseLog(policyMaker.connect(orchestrator).rebaseOrTax()))
          .requestedSupplyAdjustment,
      ).to.eq(-20)
    })
  })
})

describe('UFragmentsPolicy:Rebase', async function () {
  before('setup UFragmentsPolicy contract', async () => {
    ; ({
      deployer,
      user,
      orchestrator,
      mockParseToken,
      mockMarketOracle,
      mockCpiOracle,
      policyMaker,
    } = await loadFixture(mockedUpgradablePolicyWithOpenRebaseWindow))
  })

  describe('when cpi decreases', function () {
    before(async function () {
      await mockExternalData(INITIAL_RATE, INITIAL_CPI_25P_LESS, 1000)
      await increaseTime(60)
      await policyMaker.connect(deployer).setDeviationThresholds(0, 0)
    })

    it('should emit Rebase with positive requestedSupplyAdjustment', async function () {
      expect(
        (await parseRebaseLog(policyMaker.connect(orchestrator).rebaseOrTax()))
          .requestedSupplyAdjustment,
      ).to.eq(32)
    })
  })
})

// describe('UFragmentsPolicy:Rebase', async function () {
//   before('setup UFragmentsPolicy contract', async () => {
//     ; ({
//       deployer,
//       user,
//       orchestrator,
//       mockParseToken,
//       mockMarketOracle,
//       mockCpiOracle,
//       policyMaker,
//     } = await loadFixture(mockedUpgradablePolicyWithOpenRebaseWindow))
//   })

//   describe('rate=TARGET_RATE', function () {
//     before(async function () {
//       await mockExternalData(INITIAL_RATE, INITIAL_CPI, 1000)
//       await policyMaker.connect(deployer).setDeviationThresholds(0,0)
//       await increaseTime(60)
//     })

//     it('should emit Rebase with 0 requestedSupplyAdjustment', async function () {
//       expect(
//         (await parseRebaseLog(policyMaker.connect(orchestrator).rebaseOrTax()))
//           .requestedSupplyAdjustment,
//       ).to.eq(0)
//     })
//   })
// })

describe('UFragmentsPolicy:Rebase', async function () {
  let rbTime: BigNumber,
    rbWindow: BigNumber,
    minRebaseOrTaxTimeIntervalSec: BigNumber,
    now: BigNumber,
    nextRebaseWindowOpenTime: BigNumber,
    timeToWait: BigNumber,
    lastRebaseTimestamp: BigNumber

  beforeEach('setup UFragmentsPolicy contract', async function () {
    ; ({
      deployer,
      user,
      orchestrator,
      mockParseToken,
      mockMarketOracle,
      mockCpiOracle,
      policyMaker,
    } = await loadFixture(mockedUpgradablePolicy))
    await policyMaker
      .connect(deployer)
      .setTimingParameters(86400, 72000, 900)
    await mockExternalData(INITIAL_RATE_30P_MORE, INITIAL_CPI, 1000)
    rbTime = await policyMaker.rebaseOrTaxWindowOffsetSec()
    rbWindow = await policyMaker.rebaseOrTaxWindowLengthSec()
    minRebaseOrTaxTimeIntervalSec = await policyMaker.minRebaseOrTaxTimeIntervalSec()
    now = ethers.BigNumber.from(
      (await ethers.provider.getBlock('latest')).timestamp,
    )
    nextRebaseWindowOpenTime = now
      .sub(now.mod(minRebaseOrTaxTimeIntervalSec))
      .add(rbTime)
      .add(minRebaseOrTaxTimeIntervalSec)
  })

  describe('when its 5s after the rebase window closes', function () {
    it('should fail', async function () {
      timeToWait = nextRebaseWindowOpenTime.sub(now).add(rbWindow).add(5)
      await increaseTime(timeToWait)
      expect(await policyMaker.inRebaseOrTaxWindow()).to.be.false
      await expect(policyMaker.connect(orchestrator).rebaseOrTax()).to.be
        .reverted
    })
  })

  describe('when its 5s before the rebase window opens', function () {
    it('should fail', async function () {
      timeToWait = nextRebaseWindowOpenTime.sub(now).sub(5)
      await increaseTime(timeToWait)
      expect(await policyMaker.inRebaseOrTaxWindow()).to.be.false
      await expect(policyMaker.connect(orchestrator).rebaseOrTax()).to.be
        .reverted
    })
  })

  describe('when its 5s after the rebase window opens', function () {
    it('should NOT fail', async function () {
      timeToWait = nextRebaseWindowOpenTime.sub(now).add(5)
      await increaseTime(timeToWait)
      expect(await policyMaker.inRebaseOrTaxWindow()).to.be.true
      await expect(policyMaker.connect(orchestrator).rebaseOrTax()).to.not.be
        .reverted
      lastRebaseTimestamp = await policyMaker.lastRebaseOrTaxTimestampSec.call()
      expect(lastRebaseTimestamp).to.eq(nextRebaseWindowOpenTime)
    })
  })

  describe('when its 5s before the rebase window closes', function () {
    it('should NOT fail', async function () {
      timeToWait = nextRebaseWindowOpenTime.sub(now).add(rbWindow).sub(5)
      await increaseTime(timeToWait)
      expect(await policyMaker.inRebaseOrTaxWindow()).to.be.true
      await expect(policyMaker.connect(orchestrator).rebaseOrTax()).to.not.be
        .reverted
      lastRebaseTimestamp = await policyMaker.lastRebaseOrTaxTimestampSec.call()
      expect(lastRebaseTimestamp).to.eq(nextRebaseWindowOpenTime)
    })
  })
})

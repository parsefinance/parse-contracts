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
let deployer: Signer, user: Signer, orchestrator: Signer

const BASE_CPI = ethers.utils.parseUnits('1', 20)
const INITIAL_CPI = ethers.utils.parseUnits('100', 18)

const INITIAL_RATE = imul(INITIAL_CPI, 1e18, BASE_CPI)
const INITIAL_RATE_30P_MORE = imul(INITIAL_RATE, '1.3', 1)

const DECIMALS = 18;

async function mockedUpgradablePolicyMaker() {
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

async function parseTaxLog(response: Promise<TransactionResponse>) {
  const receipt = (await (await response).wait()) as any
  const logs = receipt.events.filter(
    (event: Event) => event.event === 'LogTaxChanged',
  )
  return logs[0].args
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
async function mockedUpgradablePolicyMakerWithOpenRebaseWindow() {
  const {
    deployer,
    user,
    orchestrator,
    mockParseToken,
    mockMarketOracle,
    mockCpiOracle,
    policyMaker,
  } = await mockedUpgradablePolicyMaker()
  await policyMaker.connect(deployer).setRebaseTimingParameters(60, 0, 60)
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
async function setPrice(p: string) {
  let DECIMALS = await policyMaker.DECIMALS()
  await mockMarketOracle.connect(deployer).storeData(ethers.utils.parseUnits(p, DECIMALS))
  await mockMarketOracle.connect(deployer).storeValidity(true)
}

async function setCPI(p: string) {
  let DECIMALS = await policyMaker.DECIMALS()
  await mockCpiOracle.connect(deployer).storeData(ethers.utils.parseUnits(p, DECIMALS))
  await mockCpiOracle.connect(deployer).storeValidity(true)
}
function toBN(x: string) {
  return ethers.utils.parseUnits(x, DECIMALS);
}

async function setTaxParameters(theta: BigNumber, s: BigNumber, v: BigNumber) {
  let DECIMALS = await policyMaker.DECIMALS()
  // await policyMaker.connect(deployer).setTaxThetaThreshold(ethers.utils.parseUnits(theta, DECIMALS));
  // await policyMaker.connect(deployer).setTaxStepThreshold(ethers.utils.parseUnits(s, DECIMALS));
  // await policyMaker.connect(deployer).setTaxValue(ethers.utils.parseUnits(v, DECIMALS));
  await policyMaker.connect(deployer).setTaxParameters(theta, s, v);
}

describe('PolicyMaker: setters of tax parameters', async function () {
  let DECIMALS: BigNumber
  before('setup PolicyMaker contract', async () => {
    ; ({
      deployer,
      user,
      orchestrator,
      mockParseToken,
      mockMarketOracle,
      mockCpiOracle,
      policyMaker,
    } = await loadFixture(mockedUpgradablePolicyMaker))
    DECIMALS = await policyMaker.DECIMALS()

  })
  it('set theta to 0 (to be reverted)', async function () {
    await expect(setTaxParameters(toBN('0'), await policyMaker.connect(user).taxStepThreshold(), await policyMaker.connect(user).taxValue()))
      .to.be.reverted;
    // await expect(policyMaker.connect(deployer)
    //   .setTaxThetaThreshold(ethers.utils.parseUnits('0', DECIMALS))).to.be.reverted
  })

  it('set s to 0 (to be reverted)', async function () {

    await expect(policyMaker.connect(deployer)
      .setTaxStepThreshold(ethers.utils.parseUnits('0', DECIMALS))).to.be.reverted
  })

  it('set theta, s, v to valid values', async function () {
    let theta = '0.01'
    let s = '0.001'
    let v = '0.002'
    await setTaxParameters(toBN(theta), toBN(s), toBN(v));

    expect(await policyMaker.taxThetaThreshold()).to
      .eq(ethers.utils.parseUnits(theta, DECIMALS));

    expect(await policyMaker.taxStepThreshold()).to
      .eq(ethers.utils.parseUnits(s, DECIMALS));

    expect(await policyMaker.taxValue()).to
      .eq(ethers.utils.parseUnits(v, DECIMALS));
  })

  it("standard user can't set theta (to be reverted)", async function () {

    await expect(policyMaker.connect(user)
      .setTaxThetaThreshold(ethers.utils.parseUnits('0.1', DECIMALS))).to.be.reverted
  })

  it("standard user can't set s (to be reverted)", async function () {

    await expect(policyMaker.connect(user)
      .setTaxStepThreshold(ethers.utils.parseUnits('0.1', DECIMALS))).to.be.reverted
  })

  it("standard user can't set v (to be reverted)", async function () {

    await expect(policyMaker.connect(user)
      .setTaxValue(ethers.utils.parseUnits('0.1', DECIMALS))).to.be.reverted
  })

})

describe('PolicyMaker: Tax calculation part', async function () {
  let DECIMALS: BigNumber

  beforeEach('setup PolicyMaker contract', async () => {
    ; ({
      deployer,
      user,
      orchestrator,
      mockParseToken,
      mockMarketOracle,
      mockCpiOracle,
      policyMaker,
    } = await loadFixture(mockedUpgradablePolicyMakerWithOpenRebaseWindow))

    DECIMALS = await mockParseToken.DECIMALS()
    await setCPI('100')

  })

  it('should only be callable by orchestrator', async function () {
    await expect(policyMaker.connect(user).rebaseOrTax()).to.be.reverted
    await expect(policyMaker.connect(deployer).rebaseOrTax()).to.be.reverted
  })

  it('taxRate must be 0 when exchangeRate > targetRate', async function () {
    await setPrice('0.97');
    await setTaxParameters(toBN('0.03'), toBN('0.1'), toBN('0.2')); // theta, s, v
    expect(
      (await parseTaxLog(policyMaker.connect(orchestrator).rebaseOrTax())).taxRate)
      .to.be.eq(ethers.utils.parseUnits('0', DECIMALS))

  })

  it('when price is pegged to target', async function () {
    await setPrice('1');
    await setTaxParameters(toBN('0.01'), toBN('0.001'), toBN('0.002')); // theta, s, v

    expect(
      (await parseTaxLog(policyMaker.connect(orchestrator).rebaseOrTax()))
        .taxRate).to.eq(ethers.utils.parseUnits('0', DECIMALS))
  })


  it('when price=0.93 theta=0.02, s=0.001, v=0.01', async function () {
    await setPrice('0.93');
    await setTaxParameters(toBN('0.02'), toBN('0.001'), toBN('0.01')); // theta, s, v

    expect(
      (await parseTaxLog(policyMaker.connect(orchestrator).rebaseOrTax()))
        .taxRate).to.eq(ethers.utils.parseUnits('0.5', DECIMALS))
  })

})

describe('PolicyMaker: epoch of tax', async function () {
  let DECIMALS: BigNumber

  before('setup PolicyMaker contract', async () => {
    ; ({
      deployer,
      user,
      orchestrator,
      mockParseToken,
      mockMarketOracle,
      mockCpiOracle,
      policyMaker,
    } = await loadFixture(mockedUpgradablePolicyMakerWithOpenRebaseWindow))
    await mockExternalData(INITIAL_RATE_30P_MORE, INITIAL_CPI, 1000, true)
    //await increaseTime(60)
    DECIMALS = await mockParseToken.DECIMALS()
  })


  it('taxEpoch should be zero at first', async function () {
    expect(await policyMaker.taxEpoch()).to.eq(0)
  })

  it('should increment taxEpoch', async function () {
    await setPrice('0.95');
    await setTaxParameters(toBN('0.03'), toBN('0.1'), toBN('0.2')); // theta, s, v

    await policyMaker.connect(orchestrator).rebaseOrTax()

    expect(await policyMaker.taxEpoch()).to.eq(1)

  })



})

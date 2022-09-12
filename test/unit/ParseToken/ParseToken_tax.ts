import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { ethers, upgrades } from 'hardhat'
import { Contract, Signer, BigNumber, BigNumberish, Event } from 'ethers'
import { expect } from 'chai'

let parseToken: Contract

let deployer: Signer
let A: Signer
let B: Signer
let C: Signer
let D: Signer
let policyMaker: Signer
let DECIMALS: number
let balance_A_before: BigNumber
let balance_A_after: BigNumber
let balance_B_before: BigNumber
let balance_B_after: BigNumber
let balance_C_before: BigNumber
let balance_C_after: BigNumber
let balance_D_before: BigNumber
let balance_D_after: BigNumber




async function mockedUpgradableparseToken() {
  // get signers
  const [deployer, A, B, C, D, policyMaker] = await ethers.getSigners()
  // deploy mocks

  // deploy upgradable contract
  const factory = await ethers.getContractFactory('ParseToken')
  const parseToken = await upgrades.deployProxy(
    factory.connect(deployer),
    [],
    {
      initializer: 'initialize()',
    },
  )

  DECIMALS = await parseToken.decimals()


  // setup policyMaker
  await parseToken.connect(deployer).setPolicyMaker(await policyMaker.getAddress())
  await parseToken.connect(deployer).setTreasuryAddress(await deployer.getAddress())

  // add balance to accounts
  await parseToken.connect(policyMaker).setTaxRate(ethers.utils.parseUnits('0', DECIMALS))


  let value = ethers.utils.parseUnits('1000000', 0)
  await parseToken.connect(deployer).transfer(await A.getAddress(), value)
  await parseToken.connect(deployer).transfer(await B.getAddress(), value)

  // return entities
  return {
    deployer,
    A,
    B,
    C,
    D,
    policyMaker,
    parseToken,
    DECIMALS,
  }
}

// async function parseTaxLog(response: Promise<TransactionResponse>) {
//   const receipt = (await (await response).wait()) as any
//   const logs = receipt.events.filter(
//     (event: Event) => event.event === 'LogTaxChanged',
//   )
//   return logs[0].args
// }


async function setTaxRate(p: string) {
  await parseToken.connect(policyMaker).setTaxRate(ethers.utils.parseUnits(p, DECIMALS))
}

async function printBalances() {
  console.log("")
  console.log("A:\t before=" + balance_A_before.toString() + " \t after=" + balance_A_after.toString())
  console.log("B:\t before=" + balance_B_before.toString() + " \t after=" + balance_B_after.toString())
  console.log("C:\t before=" + balance_C_before.toString() + " \t after=" + balance_C_after.toString())
  console.log("D:\t before=" + balance_D_before.toString() + " \t after=" + balance_D_after.toString())
  console.log("")

}
describe('parseToken: setTaxRate ', async function () {

  before('setup parseToken contract', async () => {
    ; ({
      deployer,
      A,
      B,
      C,
      D,
      policyMaker,
      parseToken,
      DECIMALS,
    } = await loadFixture(mockedUpgradableparseToken))

  })

  it('setting raxRate by deployer (to be reverted)', async function () {
    await expect(parseToken.connect(deployer).setTaxRate(ethers.utils.parseUnits("0.033", DECIMALS))).to.be.reverted
  })

  it('setting raxRate by standard user (to be reverted)', async function () {
    await expect(parseToken.connect(A).setTaxRate(ethers.utils.parseUnits("0.033", DECIMALS))).to.be.reverted
  })

  it('setting raxRate by policyMaker', async function () {
    await expect(parseToken.connect(policyMaker).setTaxRate(ethers.utils.parseUnits("0.033", DECIMALS))).not.to.be.reverted
    expect(await parseToken.getTaxRate()).to.be.eq(ethers.utils.parseUnits("0.033", DECIMALS))
  })





})


describe('parseToken: transfer ', async function () {

  before('setup parseToken contract', async () => {
    ; ({
      deployer,
      A,
      B,
      C,
      D,
      policyMaker,
      parseToken,
      DECIMALS,
    } = await loadFixture(mockedUpgradableparseToken))
    balance_A_before = BigNumber.from('0')
    balance_A_after = BigNumber.from('0')
    balance_B_before = BigNumber.from('0')
    balance_B_after = BigNumber.from('0')
    balance_C_before = BigNumber.from('0')
    balance_C_after = BigNumber.from('0')
    balance_D_before = BigNumber.from('0')
    balance_D_after = BigNumber.from('0')
  })

  it(' transfer 1000$ , raxRate=0 ', async function () {

    await setTaxRate('0')
    let value = BigNumber.from('1000')
    let tax = BigNumber.from('0')

    balance_A_before = await parseToken.balanceOf(await A.getAddress())
    balance_B_before = await parseToken.balanceOf(await B.getAddress())

    await parseToken.connect(A).transfer(await B.getAddress(), value)

    balance_A_after = await parseToken.balanceOf(await A.getAddress())
    balance_B_after = await parseToken.balanceOf(await B.getAddress())

    expect(balance_B_after.sub(balance_B_before)).to.be.eq(value)
    expect(balance_A_before.sub(balance_A_after).sub(value)).to.be.eq(tax)

    //await printBalances()
  })

  it(' transfer 1000$ , raxRate=0.009 ', async function () {

    await setTaxRate('0.009')
    let value = BigNumber.from('1000')
    let tax = BigNumber.from('9')

    balance_A_before = await parseToken.balanceOf(await A.getAddress())
    balance_B_before = await parseToken.balanceOf(await B.getAddress())

    await parseToken.connect(A).transfer(await B.getAddress(), value)

    balance_A_after = await parseToken.balanceOf(await A.getAddress())
    balance_B_after = await parseToken.balanceOf(await B.getAddress())

    expect(balance_B_after.sub(balance_B_before)).to.be.eq(value)
    expect(balance_A_before.sub(balance_A_after).sub(value)).to.be.eq(tax)

    //await printBalances()
  })

  it(' transfer 5000$ , raxRate=0.025 ', async function () {

    await setTaxRate('0.025')
    let value = BigNumber.from('5000')
    let tax = BigNumber.from('125')

    balance_A_before = await parseToken.balanceOf(await A.getAddress())
    balance_B_before = await parseToken.balanceOf(await B.getAddress())

    await parseToken.connect(A).transfer(await B.getAddress(), value)

    balance_A_after = await parseToken.balanceOf(await A.getAddress())
    balance_B_after = await parseToken.balanceOf(await B.getAddress())

    expect(balance_B_after.sub(balance_B_before)).to.be.eq(value)
    expect(balance_A_before.sub(balance_A_after).sub(value)).to.be.eq(tax)

    //await printBalances()
  })

})


// describe('parseToken: transferAll ', async function () {

//   beforeEach('setup parseToken contract', async () => {
//     ; ({
//       deployer,
//       A,
//       B,
//       C,
//       D,
//       policyMaker,
//       parseToken,
//       DECIMALS,
//     } = await loadFixture(mockedUpgradableparseToken))
//     balance_A_before = BigNumber.from('0')
//     balance_A_after = BigNumber.from('0')
//     balance_B_before = BigNumber.from('0')
//     balance_B_after = BigNumber.from('0')
//     balance_C_before = BigNumber.from('0')
//     balance_C_after = BigNumber.from('0')
//     balance_D_before = BigNumber.from('0')
//     balance_D_after = BigNumber.from('0')
//   })

//   it(' transfer All , raxRate=0 ', async function () {

//     await setTaxRate('0')
//     let tax = BigNumber.from('0')

//     balance_A_before = await parseToken.balanceOf(await A.getAddress())
//     balance_B_before = await parseToken.balanceOf(await B.getAddress())

//     await parseToken.connect(A).transferAll(await B.getAddress())

//     balance_A_after = await parseToken.balanceOf(await A.getAddress())
//     balance_B_after = await parseToken.balanceOf(await B.getAddress())

//     let transferred = balance_B_after.sub(balance_B_before)
//     let payedTax = balance_A_before.sub(transferred)

//     expect(transferred).to.be.eq(balance_A_before.sub(tax))
//     expect(payedTax).to.be.eq(tax)
//     expect(balance_A_after).to.be.eq(BigNumber.from('0'))

//     //await printBalances()
//   })

//   it(' transfer All , raxRate=0.05 ', async function () {

//     await setTaxRate('0.05')
//     let tax = BigNumber.from('47619')

//     balance_A_before = await parseToken.balanceOf(await A.getAddress())
//     balance_B_before = await parseToken.balanceOf(await B.getAddress())

//     await parseToken.connect(A).transferAll(await B.getAddress())

//     balance_A_after = await parseToken.balanceOf(await A.getAddress())
//     balance_B_after = await parseToken.balanceOf(await B.getAddress())

//     let transferred = balance_B_after.sub(balance_B_before)
//     let payedTax = balance_A_before.sub(transferred)

//     expect(transferred).to.be.eq(balance_A_before.sub(tax))
//     expect(payedTax).to.be.eq(tax)
//     expect(balance_A_after).to.be.eq(BigNumber.from('0'))

//     //await printBalances()
//   })

//   it(' transfer All , raxRate=0.003 ', async function () {

//     await setTaxRate('0.003')
//     let tax = BigNumber.from('2991')

//     balance_A_before = await parseToken.balanceOf(await A.getAddress())
//     balance_B_before = await parseToken.balanceOf(await B.getAddress())

//     await parseToken.connect(A).transferAll(await B.getAddress())

//     balance_A_after = await parseToken.balanceOf(await A.getAddress())
//     balance_B_after = await parseToken.balanceOf(await B.getAddress())

//     let transferred = balance_B_after.sub(balance_B_before)
//     let payedTax = balance_A_before.sub(transferred)

//     expect(transferred).to.be.eq(balance_A_before.sub(tax))
//     expect(payedTax).to.be.eq(tax)
//     expect(balance_A_after).to.be.eq(BigNumber.from('0'))

//     //await printBalances()
//   })


// })

describe('parseToken: transferFrom ', async function () {

  before('setup parseToken contract', async () => {
    ; ({
      deployer,
      A,
      B,
      C,
      D,
      policyMaker,
      parseToken,
      DECIMALS,
    } = await loadFixture(mockedUpgradableparseToken))
    balance_A_before = BigNumber.from('0')
    balance_A_after = BigNumber.from('0')
    balance_B_before = BigNumber.from('0')
    balance_B_after = BigNumber.from('0')
    balance_C_before = BigNumber.from('0')
    balance_C_after = BigNumber.from('0')
    balance_D_before = BigNumber.from('0')
    balance_D_after = BigNumber.from('0')
  })

  it(' transfer 1000$ , raxRate=0 ', async function () {

    await setTaxRate('0')
    let value = BigNumber.from('1000')
    let tax = BigNumber.from('0')

    await parseToken.connect(A).approve(await C.getAddress(), value.mul(2))

    balance_A_before = await parseToken.balanceOf(await A.getAddress())
    balance_B_before = await parseToken.balanceOf(await B.getAddress())

    await parseToken.connect(C).transferFrom(await A.getAddress(), await B.getAddress(), value)

    balance_A_after = await parseToken.balanceOf(await A.getAddress())
    balance_B_after = await parseToken.balanceOf(await B.getAddress())

    expect(balance_B_after.sub(balance_B_before)).to.be.eq(value)
    expect(balance_A_before.sub(balance_A_after).sub(value)).to.be.eq(tax)
    expect(await parseToken.allowance(await A.getAddress(), await C.getAddress())).to.be.eq(value.mul(2).sub(tax).sub(value))

    //await printBalances()
  })

  it(' transfer 1000$ , raxRate=0.009 ', async function () {

    await setTaxRate('0.009')
    let value = BigNumber.from('1000')
    let tax = BigNumber.from('9')

    await parseToken.connect(A).approve(await C.getAddress(), value)

    balance_A_before = await parseToken.balanceOf(await A.getAddress())
    balance_B_before = await parseToken.balanceOf(await B.getAddress())

    await parseToken.connect(C).transferFrom(await A.getAddress(), await B.getAddress(), value)

    balance_A_after = await parseToken.balanceOf(await A.getAddress())
    balance_B_after = await parseToken.balanceOf(await B.getAddress())

    expect(balance_B_after.sub(balance_B_before)).to.be.eq(value)
    expect(balance_A_before.sub(balance_A_after).sub(value)).to.be.eq(tax)
    expect(await parseToken.allowance(await A.getAddress(),
      await C.getAddress())).to.be.eq(BigNumber.from('0'))

    //await printBalances()
  })

  it(' approve more than transferred ', async function () {

    await setTaxRate('0.025')
    let value = BigNumber.from('5000')
    let tax = BigNumber.from('125')
    let more = BigNumber.from('999')

    await parseToken.connect(A).approve(await C.getAddress(), value.add(more))

    balance_A_before = await parseToken.balanceOf(await A.getAddress())
    balance_B_before = await parseToken.balanceOf(await B.getAddress())

    await parseToken.connect(C).transferFrom(await A.getAddress(), await B.getAddress(), value)

    balance_A_after = await parseToken.balanceOf(await A.getAddress())
    balance_B_after = await parseToken.balanceOf(await B.getAddress())

    expect(balance_B_after.sub(balance_B_before)).to.be.eq(value)
    expect(balance_A_before.sub(balance_A_after).sub(value)).to.be.eq(tax)
    expect(await parseToken.allowance(await A.getAddress(),
      await C.getAddress())).to.be.eq(BigNumber.from(more))
    //await printBalances()
  })

  it(' transfer more than approved (to be reverted) ', async function () {
    await setTaxRate('0.001')
    let value = BigNumber.from('1000')
    await parseToken.connect(A).approve(await C.getAddress(), value.sub(1))

    await expect(parseToken.connect(C).transferFrom(await A.getAddress(),
      await B.getAddress(), value)).to.be.reverted

  })

})

// describe('parseToken: transferAllFrom ', async function () {

//   beforeEach('setup parseToken contract', async () => {
//     ; ({
//       deployer,
//       A,
//       B,
//       C,
//       D,
//       policyMaker,
//       parseToken,
//       DECIMALS,
//     } = await loadFixture(mockedUpgradableparseToken))
//     balance_A_before = BigNumber.from('0')
//     balance_A_after = BigNumber.from('0')
//     balance_B_before = BigNumber.from('0')
//     balance_B_after = BigNumber.from('0')
//     balance_C_before = BigNumber.from('0')
//     balance_C_after = BigNumber.from('0')
//     balance_D_before = BigNumber.from('0')
//     balance_D_after = BigNumber.from('0')
//   })

//   it(' transfer All , raxRate=0 ', async function () {

//     await setTaxRate('0')
//     let tax = BigNumber.from('0')


//     balance_A_before = await parseToken.balanceOf(await A.getAddress())
//     balance_B_before = await parseToken.balanceOf(await B.getAddress())

//     let approvedValue = balance_A_before
//     await parseToken.connect(A).approve(await C.getAddress(), approvedValue)


//     await parseToken.connect(C).transferAllFrom(await A.getAddress(), await B.getAddress())

//     balance_A_after = await parseToken.balanceOf(await A.getAddress())
//     balance_B_after = await parseToken.balanceOf(await B.getAddress())

//     let transferred = balance_B_after.sub(balance_B_before)
//     let payedTax = balance_A_before.sub(transferred)

//     expect(transferred).to.be.eq(balance_A_before.sub(tax))
//     expect(payedTax).to.be.eq(tax)
//     expect(balance_A_after).to.be.eq(BigNumber.from('0'))
//     expect(await parseToken.allowance(await A.getAddress(),
//       await C.getAddress())).to.be.eq(BigNumber.from('0'))


//     //await printBalances()
//   })

//   it(' transfer All , raxRate=0.05 ', async function () {

//     await setTaxRate('0.05')
//     let tax = BigNumber.from('47619')

//     balance_A_before = await parseToken.balanceOf(await A.getAddress())
//     balance_B_before = await parseToken.balanceOf(await B.getAddress())

//     let approvedValue = balance_A_before
//     await parseToken.connect(A).approve(await C.getAddress(), approvedValue)


//     await parseToken.connect(C).transferAllFrom(await A.getAddress(), await B.getAddress())

//     balance_A_after = await parseToken.balanceOf(await A.getAddress())
//     balance_B_after = await parseToken.balanceOf(await B.getAddress())

//     let transferred = balance_B_after.sub(balance_B_before)
//     let payedTax = balance_A_before.sub(transferred)

//     expect(transferred).to.be.eq(balance_A_before.sub(tax))
//     expect(payedTax).to.be.eq(tax)
//     expect(balance_A_after).to.be.eq(BigNumber.from('0'))
//     expect(await parseToken.allowance(await A.getAddress(),
//       await C.getAddress())).to.be.eq(approvedValue.sub(transferred))


//     //await printBalances()
//   })

//   it(' transfer All , raxRate=0.003 ', async function () {

//     await setTaxRate('0.003')
//     let tax = BigNumber.from('2991')



//     balance_A_before = await parseToken.balanceOf(await A.getAddress())
//     balance_B_before = await parseToken.balanceOf(await B.getAddress())

//     let approvedValue = balance_A_before
//     await parseToken.connect(A).approve(await C.getAddress(), approvedValue)


//     await parseToken.connect(C).transferAllFrom(await A.getAddress(), await B.getAddress())

//     balance_A_after = await parseToken.balanceOf(await A.getAddress())
//     balance_B_after = await parseToken.balanceOf(await B.getAddress())

//     let transferred = balance_B_after.sub(balance_B_before)
//     let payedTax = balance_A_before.sub(transferred)

//     expect(transferred).to.be.eq(balance_A_before.sub(tax))
//     expect(payedTax).to.be.eq(tax)
//     expect(balance_A_after).to.be.eq(BigNumber.from('0'))
//     expect(await parseToken.allowance(await A.getAddress(),
//       await C.getAddress())).to.be.eq(approvedValue.sub(transferred))


//     //await printBalances()
//   })

//   it(' approve more than transferred ', async function () {

//     await setTaxRate('0.003')
//     let tax = BigNumber.from('2991')



//     balance_A_before = await parseToken.balanceOf(await A.getAddress())
//     balance_B_before = await parseToken.balanceOf(await B.getAddress())

//     let approvedValue = balance_A_before.add(999)
//     await parseToken.connect(A).approve(await C.getAddress(), approvedValue)


//     await parseToken.connect(C).transferAllFrom(await A.getAddress(), await B.getAddress())

//     balance_A_after = await parseToken.balanceOf(await A.getAddress())
//     balance_B_after = await parseToken.balanceOf(await B.getAddress())

//     let transferred = balance_B_after.sub(balance_B_before)
//     let payedTax = balance_A_before.sub(transferred)

//     expect(transferred).to.be.eq(balance_A_before.sub(tax))
//     expect(payedTax).to.be.eq(tax)
//     expect(balance_A_after).to.be.eq(BigNumber.from('0'))
//     expect(await parseToken.allowance(await A.getAddress(),
//       await C.getAddress())).to.be.eq(approvedValue.sub(transferred))


//     //await printBalances()
//   })

// it(' transfer more than approved  (to be reverted) ', async function () {
//   await setTaxRate('0.001')
//   await parseToken.connect(A).approve(await C.getAddress(), BigNumber.from('10000'))

//   await expect(parseToken.connect(C).transferAllFrom(await A.getAddress(),
//     await B.getAddress())).to.be.reverted

// })


// })

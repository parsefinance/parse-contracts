
/*
  In this script, we generate random cycles of fragments growth and contraction
  and test the precision of fragments transfers
  During every iteration; percentageGrowth is sampled from a unifrom distribution between [-50%,250%]
  and the fragments total supply grows/contracts.
  In each cycle we test the following guarantees:
  - If address 'A' transfers x fragments to address 'B'. A's resulting external balance will
  be decreased by precisely x fragments, and B's external balance will be precisely
  increased by x fragments.
*/

import { ethers, upgrades } from 'hardhat'
import { expect } from 'chai'
import { BigNumber, BigNumberish, Contract, Signer } from 'ethers'
import { BigNumber as BN } from 'bignumber.js'
const Stochasm = require('stochasm')

const endSupply = ethers.BigNumber.from(2).pow(128).sub(1)
const parseTokenGrowth = new Stochasm({
  min: -0.5,
  max: 2.5,
  seed: 'fragments.org',
})

const imul = (a: BigNumberish, b: BigNumberish, c: BigNumberish) => {
  return ethers.BigNumber.from(
    new BN(a.toString()).times(b.toString()).idiv(c.toString()).toString(10),
  )
}

let parseToken: Contract,
  inflation: BigNumber,
  rebaseAmt = ethers.BigNumber.from(0),
  preRebaseSupply = ethers.BigNumber.from(0),
  postRebaseSupply = ethers.BigNumber.from(0)

async function checkBalancesAfterOperation(
  users: Signer[],
  op: Function,
  chk: Function,
) {
  const _bals = []
  const bals = []
  let u
  for (u in users) {
    if (Object.prototype.hasOwnProperty.call(users, u)) {
      _bals.push(await parseToken.balanceOf(users[u].getAddress()))
    }
  }
  await op()
  for (u in users) {
    if (Object.prototype.hasOwnProperty.call(users, u)) {
      bals.push(await parseToken.balanceOf(users[u].getAddress()))
    }
  }
  chk(_bals, bals)
}

async function checkBalancesAfterTransfer(users: Signer[], tAmt: BigNumberish) {
  await checkBalancesAfterOperation(
    users,
    async function () {
      await parseToken.connect(users[0]).transfer(users[1].getAddress(), tAmt)
    },
    function ([_u0Bal, _u1Bal]: BigNumber[], [u0Bal, u1Bal]: BigNumber[]) {
      const _sum = _u0Bal.add(_u1Bal)
      const sum = u0Bal.add(u1Bal)
      expect(_sum).to.eq(sum)
      expect(_u0Bal.sub(tAmt)).to.eq(u0Bal)
      expect(_u1Bal.add(tAmt)).to.eq(u1Bal)
    },
  )
}

async function exec() {
  const [deployer, user] = await ethers.getSigners()
  const factory = await ethers.getContractFactory('ParseToken')
  parseToken = await upgrades.deployProxy(
    factory.connect(deployer),
    [],
    {
      initializer: 'initialize()',
    },
  )
  await parseToken.connect(deployer).setPolicyMaker(deployer.getAddress())
  await parseToken.connect(deployer).setTaxRate(0)
  let i = 0
  do {
    await parseToken.connect(deployer).rebase(i + 1, rebaseAmt)
    postRebaseSupply = await parseToken.totalSupply()
    i++

    console.log('Rebased iteration', i)
    console.log('Rebased by', rebaseAmt.toString(), 'PARSE')
    console.log('Total supply is now', postRebaseSupply.toString(), 'PARSE')

    console.log('Testing precision of 1c transfer')
    await checkBalancesAfterTransfer([deployer, user], 1)
    await checkBalancesAfterTransfer([user, deployer], 1)

    console.log('Testing precision of max denomination')
    const tAmt = await parseToken.balanceOf(deployer.getAddress())
    await checkBalancesAfterTransfer([deployer, user], tAmt)
    await checkBalancesAfterTransfer([user, deployer], tAmt)

    preRebaseSupply = await parseToken.totalSupply()
    inflation = parseTokenGrowth.next().toFixed(5)
    rebaseAmt = imul(preRebaseSupply, inflation, 1)
  } while ((await parseToken.totalSupply()).add(rebaseAmt).lt(endSupply))
}

describe('Transfer Precision', function () {
  it('should successfully run simulation', async function () {
    await exec()
  })
})

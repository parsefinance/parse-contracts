/*
  In this script,
  During every iteration:
  * We double the total fragments supply.
  * We test the following guarantee:
      - the difference in totalSupply() before and after the rebase(+1) should be exactly 1.
*/

import { ethers, upgrades } from 'hardhat'
import { expect } from 'chai'

async function exec() {
  const [deployer] = await ethers.getSigners()
  const factory = await ethers.getContractFactory('ParseToken')
  const parseToken = await upgrades.deployProxy(
    factory.connect(deployer),
    [],
    {
      initializer: 'initialize()',
    },
  )
  await parseToken.connect(deployer).setPolicyMaker(deployer.getAddress())


  const endSupply = ethers.BigNumber.from(2).pow(128).sub(1)
  let preRebaseSupply = ethers.BigNumber.from(0),
    postRebaseSupply = ethers.BigNumber.from(0)

  let i = 0
  do {
    console.log('Iteration', i + 1)

    preRebaseSupply = await parseToken.totalSupply()
    await parseToken.connect(deployer).rebase(2 * i, 1)
    postRebaseSupply = await parseToken.totalSupply()
    console.log('Rebased by 1 PARSE')
    console.log('Total supply is now', postRebaseSupply.toString(), 'PARSE')

    console.log('Testing precision of supply')
    expect(postRebaseSupply.sub(preRebaseSupply).toNumber()).to.eq(1)

    console.log('Doubling supply')
    await parseToken.connect(deployer).rebase(2 * i + 1, postRebaseSupply)
    i++
  } while ((await parseToken.totalSupply()).lt(endSupply))
}

describe('Supply Precision', function () {
  it('should successfully run simulation', async function () {
    await exec()
  })
})

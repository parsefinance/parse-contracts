import { ethers, upgrades } from 'hardhat'
import { Contract, Signer, BigNumber } from 'ethers'
import { expect } from 'chai'

const toFixedPoint = (ample: string): BigNumber =>
  ethers.utils.parseUnits(ample, DECIMALS)

const DECIMALS = 9
const INITIAL_SUPPLY = ethers.utils.parseUnits('50', 6 + DECIMALS)
const MAX_UINT256 = ethers.BigNumber.from(2).pow(256).sub(1)
const MAX_INT256 = ethers.BigNumber.from(2).pow(255).sub(1)
const TOTAL_SHARE = MAX_UINT256.sub(MAX_UINT256.mod(INITIAL_SUPPLY))

const transferAmount = toFixedPoint('10')
const unitTokenAmount = toFixedPoint('1')

let accounts: Signer[],
  deployer: Signer,
  parseToken: Contract,
  initialSupply: BigNumber

async function setupContracts() {
  // prepare signers
  accounts = await ethers.getSigners()
  deployer = accounts[0]
  const policy = accounts[1]
  // deploy upgradable token
  const factory = await ethers.getContractFactory('ParseToken')
  parseToken = await upgrades.deployProxy(
    factory,
    [],
    {
      initializer: 'initialize()',
    },
  )
  // fetch initial supply
  initialSupply = await parseToken.totalSupply()
  await parseToken
    .connect(deployer)
    .setPolicyMaker(await policy.getAddress())
  await parseToken
    .connect(policy)
    .setTaxRate(toFixedPoint('0'))
}

describe('ParseToken', () => {
  before('setup parseToken contract', setupContracts)

  it('should reject any ether sent to it', async function () {
    const user = accounts[1]
    await expect(user.sendTransaction({ to: parseToken.address, value: 1 })).to
      .be.reverted
  })
})

describe('ParseToken:Initialization', () => {
  before('setup parseToken contract', setupContracts)

  it('should transfer 50M parseToken to the deployer', async function () {
    expect(await parseToken.balanceOf(await deployer.getAddress())).to.eq(
      INITIAL_SUPPLY,
    )
  })

  it('should set the totalSupply to 50M', async function () {
    expect(await parseToken.totalSupply()).to.eq(INITIAL_SUPPLY)
  })

  it('should set the owner', async function () {
    expect(await parseToken.owner()).to.eq(await deployer.getAddress())
  })

  it('should set detailed ERC20 parameters', async function () {
    expect(await parseToken.name()).to.eq('Parse')
    expect(await parseToken.symbol()).to.eq('PARSE')
    expect(await parseToken.decimals()).to.eq(DECIMALS)
  })
})

describe('ParseToken:setPolicyMaker', async () => {
  let policy: Signer, policyAddress: string

  before('setup parseToken contract', async () => {
    await setupContracts()
    policy = accounts[1]
    policyAddress = await policy.getAddress()
  })

  it('should set reference to policy contract', async function () {
    await expect(parseToken.connect(deployer).setPolicyMaker(policyAddress))
      .to.emit(parseToken, 'LogPolicyMakerUpdated')
      .withArgs(policyAddress)
    expect(await parseToken.policyMaker()).to.eq(policyAddress)
  })
})

describe('ParseToken:setPolicyMaker:accessControl', async () => {
  let policy: Signer, policyAddress: string

  before('setup parseToken contract', async () => {
    await setupContracts()
    policy = accounts[1]
    policyAddress = await policy.getAddress()
  })

  it('should be callable by owner', async function () {
    await expect(parseToken.connect(deployer).setPolicyMaker(policyAddress))
      .to.not.be.reverted
  })
})

describe('ParseToken:setPolicyMaker:accessControl', async () => {
  let policy: Signer, policyAddress: string, user: Signer

  before('setup parseToken contract', async () => {
    await setupContracts()
    policy = accounts[1]
    user = accounts[2]
    policyAddress = await policy.getAddress()
  })

  it('should NOT be callable by non-owner', async function () {
    await expect(parseToken.connect(user).setPolicyMaker(policyAddress)).to
      .be.reverted
  })
})

describe('ParseToken:Rebase:accessControl', async () => {
  let user: Signer, userAddress: string

  before('setup parseToken contract', async function () {
    await setupContracts()
    user = accounts[1]
    userAddress = await user.getAddress()
    await parseToken.connect(deployer).setPolicyMaker(userAddress)
  })

  it('should be callable by monetary policy', async function () {
    await expect(parseToken.connect(user).rebase(1, transferAmount)).to.not.be
      .reverted
  })

  it('should not be callable by others', async function () {
    await expect(parseToken.connect(deployer).rebase(1, transferAmount)).to.be
      .reverted
  })
})

describe('ParseToken:Rebase:Expansion', async () => {
  // Rebase +5M (10%), with starting balances A:750 and B:250.
  let A: Signer, B: Signer, policy: Signer
  const rebaseAmt = INITIAL_SUPPLY.div(10)

  before('setup parseToken contract', async function () {
    await setupContracts()
    A = accounts[2]
    B = accounts[3]
    policy = accounts[1]
    await parseToken
      .connect(deployer)
      .setPolicyMaker(await policy.getAddress())
    // set tax rate to 0
    await parseToken
      .connect(policy)
      .setTaxRate(toFixedPoint('0'))
    await parseToken
      .connect(deployer)
      .transfer(await A.getAddress(), toFixedPoint('750'))
    await parseToken
      .connect(deployer)
      .transfer(await B.getAddress(), toFixedPoint('250'))

    expect(await parseToken.totalSupply()).to.eq(INITIAL_SUPPLY)
    expect(await parseToken.balanceOf(await A.getAddress())).to.eq(
      toFixedPoint('750'),
    )
    expect(await parseToken.balanceOf(await B.getAddress())).to.eq(
      toFixedPoint('250'),
    )

    expect(await parseToken.totalShareSupply()).to.eq(TOTAL_SHARE)
    expect(await parseToken.shareOf(await A.getAddress())).to.eq(
      '1736881338559742931353564775130318617799049769984608460591863250000000000',
    )
    expect(await parseToken.shareOf(await B.getAddress())).to.eq(
      '578960446186580977117854925043439539266349923328202820197287750000000000',
    )
  })

  it('should emit Rebase', async function () {
    await expect(parseToken.connect(policy).rebase(1, rebaseAmt))
      .to.emit(parseToken, 'LogRebase')
      .withArgs(1, initialSupply.add(rebaseAmt))
  })

  it('should increase the totalSupply', async function () {
    expect(await parseToken.totalSupply()).to.eq(initialSupply.add(rebaseAmt))
  })

  it('should NOT CHANGE the totalShareSupply', async function () {
    expect(await parseToken.totalShareSupply()).to.eq(TOTAL_SHARE)
  })

  it('should increase individual balances', async function () {
    expect(await parseToken.balanceOf(await A.getAddress())).to.eq(
      toFixedPoint('825'),
    )
    expect(await parseToken.balanceOf(await B.getAddress())).to.eq(
      toFixedPoint('275'),
    )
  })

  it('should NOT CHANGE the individual scaled balances', async function () {
    expect(await parseToken.shareOf(await A.getAddress())).to.eq(
      '1736881338559742931353564775130318617799049769984608460591863250000000000',
    )
    expect(await parseToken.shareOf(await B.getAddress())).to.eq(
      '578960446186580977117854925043439539266349923328202820197287750000000000',
    )
  })

  it('should return the new supply', async function () {
    const returnVal = await parseToken
      .connect(policy)
      .callStatic.rebase(2, rebaseAmt)
    await parseToken.connect(policy).rebase(2, rebaseAmt)
    expect(await parseToken.totalSupply()).to.eq(returnVal)
  })
})
// 

describe('ParseToken:Rebase:Expansion', async function () {
  let policy: Signer
  const MAX_SUPPLY = ethers.BigNumber.from(2).pow(128).sub(1)

  describe('when totalSupply is less than MAX_SUPPLY and expands beyond', function () {
    before('setup parseToken contract', async function () {
      await setupContracts()
      policy = accounts[1]
      await parseToken
        .connect(deployer)
        .setPolicyMaker(await policy.getAddress())
      const totalSupply = await parseToken.totalSupply.call()
      await parseToken
        .connect(policy)
        .rebase(1, MAX_SUPPLY.sub(totalSupply).sub(toFixedPoint('1')))
    })

    it('should emit Rebase', async function () {
      await expect(
        parseToken.connect(policy).rebase(2, toFixedPoint('2')),
      )
        .to.emit(parseToken, 'LogRebase')
        .withArgs(2, MAX_SUPPLY)
    })

    it('should increase the totalSupply to MAX_SUPPLY', async function () {
      expect(await parseToken.totalSupply()).to.eq(MAX_SUPPLY)
    })
  })

  describe('when totalSupply is MAX_SUPPLY and expands', function () {
    before(async function () {
      expect(await parseToken.totalSupply()).to.eq(MAX_SUPPLY)
    })

    it('should emit Rebase', async function () {
      await expect(
        parseToken.connect(policy).rebase(3, toFixedPoint('2')),
      )
        .to.emit(parseToken, 'LogRebase')
        .withArgs(3, MAX_SUPPLY)
    })

    it('should NOT change the totalSupply', async function () {
      expect(await parseToken.totalSupply()).to.eq(MAX_SUPPLY)
    })
  })
})


describe('ParseToken:Rebase:NoChange', function () {
  // Rebase (0%), with starting balances A:750 and B:250.
  let A: Signer, B: Signer, policy: Signer

  before('setup parseToken contract', async function () {
    await setupContracts()
    A = accounts[2]
    B = accounts[3]
    policy = accounts[1]
    await parseToken
      .connect(deployer)
      .setPolicyMaker(await policy.getAddress())
    await parseToken
      .connect(deployer)
      .transfer(await A.getAddress(), toFixedPoint('750'))
    await parseToken
      .connect(deployer)
      .transfer(await B.getAddress(), toFixedPoint('250'))

    expect(await parseToken.totalSupply()).to.eq(INITIAL_SUPPLY)
    expect(await parseToken.balanceOf(await A.getAddress())).to.eq(
      toFixedPoint('750'),
    )
    expect(await parseToken.balanceOf(await B.getAddress())).to.eq(
      toFixedPoint('250'),
    )

    expect(await parseToken.totalShareSupply()).to.eq(TOTAL_SHARE)
    expect(await parseToken.shareOf(await A.getAddress())).to.eq(
      '1736881338559742931353564775130318617799049769984608460591863250000000000',
    )
    expect(await parseToken.shareOf(await B.getAddress())).to.eq(
      '578960446186580977117854925043439539266349923328202820197287750000000000',
    )
  })

  it('should emit Rebase', async function () {
    await expect(parseToken.connect(policy).rebase(1, 0))
      .to.emit(parseToken, 'LogRebase')
      .withArgs(1, initialSupply)
  })

  it('should NOT CHANGE the totalSupply', async function () {
    expect(await parseToken.totalSupply()).to.eq(initialSupply)
  })

  it('should NOT CHANGE the totalShareSupply', async function () {
    expect(await parseToken.totalShareSupply()).to.eq(TOTAL_SHARE)
  })

  it('should NOT CHANGE individual balances', async function () {
    expect(await parseToken.balanceOf(await A.getAddress())).to.eq(
      toFixedPoint('750'),
    )
    expect(await parseToken.balanceOf(await B.getAddress())).to.eq(
      toFixedPoint('250'),
    )
  })

  it('should NOT CHANGE the individual scaled balances', async function () {
    expect(await parseToken.shareOf(await A.getAddress())).to.eq(
      '1736881338559742931353564775130318617799049769984608460591863250000000000',
    )
    expect(await parseToken.shareOf(await B.getAddress())).to.eq(
      '578960446186580977117854925043439539266349923328202820197287750000000000',
    )
  })
})

describe('ParseToken:Rebase:Contraction', function () {
  // Rebase -5M (-10%), with starting balances A:750 and B:250.
  let A: Signer, B: Signer, policy: Signer
  const rebaseAmt = INITIAL_SUPPLY.div(10)

  before('setup parseToken contract', async function () {
    await setupContracts()
    A = accounts[2]
    B = accounts[3]
    policy = accounts[1]
    await parseToken
      .connect(deployer)
      .setPolicyMaker(await policy.getAddress())
    await parseToken
      .connect(deployer)
      .transfer(await A.getAddress(), toFixedPoint('750'))
    await parseToken
      .connect(deployer)
      .transfer(await B.getAddress(), toFixedPoint('250'))

    expect(await parseToken.totalSupply()).to.eq(INITIAL_SUPPLY)
    expect(await parseToken.balanceOf(await A.getAddress())).to.eq(
      toFixedPoint('750'),
    )
    expect(await parseToken.balanceOf(await B.getAddress())).to.eq(
      toFixedPoint('250'),
    )

    expect(await parseToken.totalShareSupply()).to.eq(TOTAL_SHARE)
    expect(await parseToken.shareOf(await A.getAddress())).to.eq(
      '1736881338559742931353564775130318617799049769984608460591863250000000000',
    )
    expect(await parseToken.shareOf(await B.getAddress())).to.eq(
      '578960446186580977117854925043439539266349923328202820197287750000000000',
    )
  })

  it('should emit Rebase', async function () {
    await expect(parseToken.connect(policy).rebase(1, -rebaseAmt))
      .to.emit(parseToken, 'LogRebase')
      .withArgs(1, initialSupply.sub(rebaseAmt))
  })

  it('should decrease the totalSupply', async function () {
    expect(await parseToken.totalSupply()).to.eq(initialSupply.sub(rebaseAmt))
  })

  it('should NOT. CHANGE the totalShareSupply', async function () {
    expect(await parseToken.totalShareSupply()).to.eq(TOTAL_SHARE)
  })

  it('should decrease individual balances', async function () {
    expect(await parseToken.balanceOf(await A.getAddress())).to.eq(
      toFixedPoint('675'),
    )
    expect(await parseToken.balanceOf(await B.getAddress())).to.eq(
      toFixedPoint('225'),
    )
  })

  it('should NOT CHANGE the individual scaled balances', async function () {
    expect(await parseToken.shareOf(await A.getAddress())).to.eq(
      '1736881338559742931353564775130318617799049769984608460591863250000000000',
    )
    expect(await parseToken.shareOf(await B.getAddress())).to.eq(
      '578960446186580977117854925043439539266349923328202820197287750000000000',
    )
  })
})

// TODO add tests for when taxRate > 0
describe('ParseToken:Transfer', function () {
  let A: Signer, B: Signer, C: Signer

  before('setup parseToken contract', async () => {
    await setupContracts()
    A = accounts[2]
    B = accounts[3]
    C = accounts[4]
  })

  describe('deployer transfers 12 to A', function () {
    it('should have correct balances', async function () {
      const deployerBefore = await parseToken.balanceOf(
        await deployer.getAddress(),
      )
      await parseToken
        .connect(deployer)
        .transfer(await A.getAddress(), toFixedPoint('12'))
      expect(await parseToken.balanceOf(await deployer.getAddress())).to.eq(
        deployerBefore.sub(toFixedPoint('12')),
      )
      expect(await parseToken.balanceOf(await A.getAddress())).to.eq(
        toFixedPoint('12'),
      )
    })
  })

  describe('deployer transfers 15 to B', async function () {
    it('should have balances [973,15]', async function () {
      const deployerBefore = await parseToken.balanceOf(
        await deployer.getAddress(),
      )
      await parseToken
        .connect(deployer)
        .transfer(await B.getAddress(), toFixedPoint('15'))
      expect(await parseToken.balanceOf(await deployer.getAddress())).to.eq(
        deployerBefore.sub(toFixedPoint('15')),
      )
      expect(await parseToken.balanceOf(await B.getAddress())).to.eq(
        toFixedPoint('15'),
      )
    })
  })

  describe('deployer transfers the rest to C', async function () {
    it('should have balances [0,973]', async function () {
      const deployerBefore = await parseToken.balanceOf(
        await deployer.getAddress(),
      )
      await parseToken
        .connect(deployer)
        .transfer(await C.getAddress(), deployerBefore)
      expect(await parseToken.balanceOf(await deployer.getAddress())).to.eq(0)
      expect(await parseToken.balanceOf(await C.getAddress())).to.eq(
        deployerBefore,
      )
    })
  })


})

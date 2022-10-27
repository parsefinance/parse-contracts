import { ethers, upgrades } from 'hardhat';
import { BigNumber, Contract } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';

const BASE_CPI = ethers.utils.parseUnits('123.53', 18);
const RATE_REPORT_EXPIRATION_SEC = BigNumber.from(86400);
const RATE_REPORT_DELAY_SEC = BigNumber.from(0);
const RATE_MIN_PROVIDERS = BigNumber.from(1);
let DEPLOYER: SignerWithAddress;

const deploy_contract = async (
    contractName: string,
    initializer: string,
    params: Array<string | BigNumber>
) => {
    const Contract = await ethers.getContractFactory(contractName);
    const contract = await upgrades.deployProxy(
        Contract.connect(DEPLOYER),
        params,
        { initializer: initializer, }
    );
    await contract.deployed();
    return contract;
}

const config_contracts = async (
    parseToken: Contract,
    policyMaker: Contract,
    cpiOracle: Contract,
    marketOracle: Contract,
    orchestrator: Contract
) => {
    await parseToken.connect(DEPLOYER).setPolicyMaker(policyMaker.address);
    await parseToken.connect(DEPLOYER).setTreasuryAddress(DEPLOYER.address);
    await policyMaker.connect(DEPLOYER).setCpiOracle(cpiOracle.address);
    await cpiOracle.connect(DEPLOYER).addProvider(DEPLOYER.address);
    await marketOracle.connect(DEPLOYER).addProvider(DEPLOYER.address);
    await policyMaker.connect(DEPLOYER).setMarketOracle(marketOracle.address);
    await policyMaker.connect(DEPLOYER).setOrchestrator(orchestrator.address);

}

const deploy = async () => {

    let accounts = await ethers.getSigners();
    DEPLOYER = accounts[0];

    process.stdout.write("Deploying ParseToken ");
    let parseToken = await deploy_contract('ParseToken', 'initialize()', []);
    console.log(`\x1b[32m Done \x1b[0m`);

    process.stdout.write("Deploying PolicyMaker ");
    let policyMaker = await deploy_contract('PolicyMaker', 'initialize(address,uint256)', [parseToken.address, BASE_CPI]);
    console.log(`\x1b[32m Done \x1b[0m`);

    process.stdout.write("Deploying MarketOracle ");
    let marketOracle = await deploy_contract('MedianOracle', 'initialize(uint256,uint256,uint256)', [RATE_REPORT_EXPIRATION_SEC, RATE_REPORT_DELAY_SEC, RATE_MIN_PROVIDERS]);
    console.log(`\x1b[32m Done \x1b[0m`);

    process.stdout.write("Deploying CpiOracle ");
    let cpiOracle = await deploy_contract('MedianOracle', 'initialize(uint256,uint256,uint256)', [RATE_REPORT_EXPIRATION_SEC, RATE_REPORT_DELAY_SEC, RATE_MIN_PROVIDERS]);
    console.log(`\x1b[32m Done \x1b[0m`);

    process.stdout.write("Deploying Orchestrator ");
    let orchestrator = await deploy_contract('Orchestrator', 'initialize(address)', [policyMaker.address]);
    console.log(`\x1b[32m Done \x1b[0m`);

    process.stdout.write("Configuring contracts  ");
    await config_contracts(parseToken, policyMaker, cpiOracle, marketOracle, orchestrator);
    console.log(`\x1b[32m Done \x1b[0m`);

    let json = {
        "ParseToken": parseToken.address,
        "PolicyMaker": policyMaker.address,
        "Orchestrator": orchestrator.address,
        "MarketOracle": marketOracle.address,
        "CPIOracle": cpiOracle.address
    }
    console.log('\n', JSON.stringify(json, null, 4));

    return [parseToken,
        policyMaker,
        orchestrator,
        marketOracle,
        cpiOracle];
}

async function main() {
    await deploy();
}

if (require.main === module) {
    main().catch((error) => {
        console.log(error);
        process.exitCode = 1;
    });
}

export { deploy };

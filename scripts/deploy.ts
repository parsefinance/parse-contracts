import { ethers, upgrades } from 'hardhat';
import { ContractFactory, Signer, BigNumber, Contract } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { contracts } from '../typechain-types';
import { parse } from 'path';
import { stdout } from 'process';
const BASE_CPI = ethers.utils.parseUnits('1', 20);
const TAX_THETA = ethers.utils.parseUnits('0.01', 18);
const TAX_STEP = ethers.utils.parseUnits('0.01', 18);
const TAX_VALUE = ethers.utils.parseUnits('0.01', 18);
const RATE_REPORT_EXPIRATION_SEC = BigNumber.from(86400);
const RATE_REPORT_DELAY_SEC = BigNumber.from(0);
const RATE_MIN_PROVIDERS = BigNumber.from(1);
let DEPLOYER:SignerWithAddress;

async function deploy_contract(contractName: string, initializer: string, params: Array<string | BigNumber>) {
    const Contract = await ethers.getContractFactory(contractName);
    // console.log(`deploying ${contractName}...`);
    const contract = await upgrades.deployProxy(Contract.connect(DEPLOYER), params, {
        initializer: initializer,
    });
    await contract.deployed();
    // console.log('ParseToken deployed to:', box.address);
    return contract;
}
async function config_contracts(parseToken:Contract,policyMaker:Contract,cpiOracle:Contract,marketOracle:Contract,orchestrator:Contract){
    let tx = await parseToken.connect(DEPLOYER).setPolicyMaker(policyMaker.address);
    console.log(tx);
    await parseToken.connect(DEPLOYER).setTreasuryAddress(DEPLOYER.address);
    await policyMaker.connect(DEPLOYER).setCpiOracle(cpiOracle.address);
    await cpiOracle.connect(DEPLOYER).addProvider(DEPLOYER.address);
    await marketOracle.connect(DEPLOYER).addProvider(DEPLOYER.address);
    await policyMaker.connect(DEPLOYER).setMarketOracle(marketOracle.address);
    await policyMaker.connect(DEPLOYER).setOrchestrator(orchestrator.address);

}
async function main() {
    let accounts = await ethers.getSigners();
    DEPLOYER = accounts[0];
    // deploy ParseToken
    process.stdout.write("Deploying ParseToken ");
    let parseToken = await deploy_contract('ParseToken', 'initialize()',[]);
    console.log(`\x1b[32m Done \x1b[0m`);
    // deploy PolicyMaker
    process.stdout.write("Deploying PolicyMaker ");
    let policyMaker = await deploy_contract('PolicyMaker','initialize(address,uint256)',[parseToken.address,BASE_CPI]);
    console.log(`\x1b[32m Done \x1b[0m`);
    // deploy marketOracle
    process.stdout.write("Deploying MarketOracle ");
    let marketOracle = await deploy_contract('MedianOracle','initialize(uint256,uint256,uint256)',[RATE_REPORT_EXPIRATION_SEC,RATE_REPORT_DELAY_SEC,RATE_MIN_PROVIDERS]);
    console.log(`\x1b[32m Done \x1b[0m`);
    process.stdout.write("Deploying CpiOracle ");
    let cpiOracle = await deploy_contract('MedianOracle','initialize(uint256,uint256,uint256)',[RATE_REPORT_EXPIRATION_SEC,RATE_REPORT_DELAY_SEC,RATE_MIN_PROVIDERS]);
    console.log(`\x1b[32m Done \x1b[0m`);
    //deploy Orchestrator
    process.stdout.write("Deploying Orchestrator ");
    let orchestrator = await deploy_contract('Orchestrator','initialize(address)',[policyMaker.address]);
    console.log(`\x1b[32m Done \x1b[0m`);

    // config contracts
    process.stdout.write("Configuring contracts ... ");
    await config_contracts(parseToken,policyMaker,marketOracle,cpiOracle,orchestrator);
    console.log(`\x1b[32m Done \x1b[0m`);
    console.log(`ParseToken: ${parseToken.address}\nPolicyMaker: ${policyMaker.address}\nmarketOracle: ${marketOracle.address}\ncpiOracle: ${cpiOracle.address}\nOrchestrator: ${orchestrator.address}`)
    

}
main().catch((error) => {
    console.log(error);
    process.exitCode = 1;
});
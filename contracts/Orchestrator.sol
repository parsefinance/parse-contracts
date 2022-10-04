// SPDX-License-Identifier: SEE LICENSE IN LICENSE
pragma solidity ^0.8.0;

import "./interface/IPolicyMaker.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";

contract Orchestrator is Initializable, OwnableUpgradeable {
    struct Transaction {
        bool enabled;
        address destination;
        bytes data;
    }

    uint256 public constant DECIMALS = 18;
    Transaction[] public transactions;
    IPolicyMaker public policyMaker;

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address policyMaker_) public initializer {
        __Ownable_init();
        policyMaker = IPolicyMaker(policyMaker_);
    }

    function rebaseOrTax() external {
        require(msg.sender == tx.origin);
        policyMaker.rebaseOrTax();
        for (uint256 i = 0; i < transactions.length; i++) {
            Transaction storage t = transactions[i];
            if (t.enabled) {
                (bool result, ) = t.destination.call(t.data);
                if (!result) {
                    revert("Transaction Failed");
                }
            }
        }
    }

    function addTransaction(address destination, bytes memory data)
        external
        onlyOwner
    {
        transactions.push(
            Transaction({enabled: true, destination: destination, data: data})
        );
    }

    function removeTransaction(uint256 index) external onlyOwner {
        require(index < transactions.length, "index out of bounds");

        if (index < transactions.length - 1) {
            transactions[index] = transactions[transactions.length - 1];
        }

        transactions.pop();
    }

    function setTransactionEnabled(uint256 index, bool enabled)
        external
        onlyOwner
    {
        require(
            index < transactions.length,
            "index must be in range of stored tx list"
        );
        transactions[index].enabled = enabled;
    }

    function transactionsSize() external view returns (uint256) {
        return transactions.length;
    }
}

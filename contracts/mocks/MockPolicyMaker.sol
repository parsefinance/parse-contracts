// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.0;
import "./Mock.sol";

contract MockPolicyMaker is Mock {
    // function rebase() external {
    //     emit FunctionCalled("PolicyMaker", "rebase", msg.sender);
    // }

    // function reportTax() external {
    //     emit FunctionCalled("PolicyMaker", "reportTax", msg.sender);
    // }

    function rebaseOrTax() external {
        emit FunctionCalled("PolicyMaker", "rebaseOrTax", msg.sender);
    }
}

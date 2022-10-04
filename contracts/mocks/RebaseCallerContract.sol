// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.0;

import "../Orchestrator.sol";

contract RebaseOrTaxCallerContract {
    function callRebaseOrTax(address orchestrator) public returns (bool) {
        // Take out a flash loan.
        // Do something funky...
        Orchestrator(orchestrator).rebaseOrTax(); // should fail
        // pay back flash loan.
        return true;
    }
}

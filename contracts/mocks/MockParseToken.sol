// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.0;
import "./Mock.sol";

contract MockParseToken is Mock {
    uint256 private _supply;

    function decimals() public view virtual returns (uint8) {
        return uint8(9);
    }

    // Methods to mock data on the chain
    function storeSupply(uint256 supply) public {
        _supply = supply;
    }

    // Mock methods
    function rebase(uint256 epoch, int256 supplyDelta)
        public
        returns (uint256)
    {
        emit FunctionCalled("UFragments", "rebase", msg.sender);
        uint256[] memory uintVals = new uint256[](1);
        uintVals[0] = epoch;
        int256[] memory intVals = new int256[](1);
        intVals[0] = supplyDelta;
        emit FunctionArguments(uintVals, intVals);
        return uint256(int256(_supply) + int256(supplyDelta));
    }

    function totalSupply() public view returns (uint256) {
        return _supply;
    }

    ///////////////////////tax////////////////////

    function setTaxRate(uint256 epoch, uint256 _taxRate) external {
        emit FunctionCalled("UFragments", "setTaxRate", msg.sender);
        uint256[] memory uintVals = new uint256[](2);
        uintVals[0] = _taxRate;
        uintVals[1] = epoch;
        int256[] memory intVals = new int256[](0);
        emit FunctionArguments(uintVals, intVals);
    }
}

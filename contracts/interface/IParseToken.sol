// SPDX-License-Identifier: SEE LICENSE IN LICENSE
pragma solidity ^0.8.0;

interface IParseToken {
    function totalSupply() external view returns (uint256);

    function rebase(uint256 epoch, int256 supplyDelta)
        external
        returns (uint256);

    function setTaxRate(uint256 epoch, uint256 taxRate) external;

    function DECIMALS() external returns (uint256);
}

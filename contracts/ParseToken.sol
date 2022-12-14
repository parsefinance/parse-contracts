// SPDX-License-Identifier: SEE LICENSE IN LICENSE
pragma solidity ^0.8.0;

import "./lib/ERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";

contract ParseToken is Initializable, ERC20Upgradeable, OwnableUpgradeable {
    address public policyMaker;
    address public treasury;

    uint256 private constant DECIMALS = 9;
    uint256 private constant INITIAL_PARSE_SUPPLY = 10 * 10**6 * 10**DECIMALS;

    uint256 private constant TOTAL_SHARE =
        type(uint256).max - (type(uint256).max % INITIAL_PARSE_SUPPLY);

    uint256 private constant MAX_SUPPLY = type(uint128).max;
    uint256 private _sharePerPARSE;
    uint256 private _totalPARSESupply;

    uint256 public taxRate;

    event rebased(uint256 indexed epoch, uint256 totalSupply);
    event taxRateUpdated(uint256 indexed epoch, uint256 taxRate);
    event policyMakerUpdated(address policyMaker);
    event treasuryUpdated(address oldTreasury, address newTreasury);
    event taxDeducted(address indexed from, address indexed to, uint256 value);

    modifier onlyPolicyMaker() {
        require(
            msg.sender == policyMaker,
            "only the PolicyMaker should call this."
        );
        _;
    }

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize() public initializer {
        __ERC20_init("Parse", "PARSE");
        __Ownable_init();
        _mint(owner(), TOTAL_SHARE);
        _totalPARSESupply = INITIAL_PARSE_SUPPLY;
        _sharePerPARSE = TOTAL_SHARE / _totalPARSESupply;
        emit Transfer(address(0), owner(), _totalPARSESupply);

        taxRate = 0;
    }

    function decimals() public view virtual override returns (uint8) {
        return uint8(DECIMALS);
    }

    function setTaxRate(uint256 epoch, uint256 taxRate_)
        external
        onlyPolicyMaker
    {
        taxRate = taxRate_;
        emit taxRateUpdated(epoch, taxRate_);
    }

    function setPolicyMaker(address policyMaker_) external onlyOwner {
        policyMaker = policyMaker_;
        emit policyMakerUpdated(policyMaker_);
    }

    function setTreasuryAddress(address _treasury) external onlyOwner {
        require(
            treasury != _treasury,
            "a new address for treasury should be provided."
        );

        treasury = _treasury;
        emit treasuryUpdated(treasury, _treasury);
    }

    function rebase(uint256 epoch, int256 supplyDelta)
        external
        onlyPolicyMaker
        returns (uint256)
    {
        if (supplyDelta == 0) {
            emit rebased(epoch, _totalPARSESupply);
            return _totalPARSESupply;
        }

        if (supplyDelta < 0) {
            _totalPARSESupply = _totalPARSESupply - uint256(-supplyDelta);
        } else {
            _totalPARSESupply = _totalPARSESupply + (uint256(supplyDelta));
        }

        if (_totalPARSESupply > MAX_SUPPLY) {
            _totalPARSESupply = MAX_SUPPLY;
        }

        _sharePerPARSE = TOTAL_SHARE / _totalPARSESupply;

        emit rebased(epoch, _totalPARSESupply);
        return _totalPARSESupply;
    }

    function balanceOf(address account) public view override returns (uint256) {
        return ERC20Upgradeable.balanceOf(account) / _sharePerPARSE;
    }

    function shareOf(address account) public view returns (uint256) {
        return ERC20Upgradeable.balanceOf(account);
    }

    function totalShareSupply() external pure returns (uint256) {
        return TOTAL_SHARE;
    }

    function totalSupply() public view override returns (uint256) {
        return _totalPARSESupply;
    }

    function _payTax(address seller, uint256 amount) private {
        if (taxRate > 0) {
            uint256 taxInPARSE = (amount * taxRate) / (10**DECIMALS);
            uint256 taxInShare = taxInPARSE * _sharePerPARSE;
            _transfer(seller, treasury, taxInShare);
            emit taxDeducted(seller, treasury, taxInPARSE);
        }
    }

    function transfer(address to, uint256 amount)
        public
        virtual
        override
        returns (bool)
    {
        address from = _msgSender();
        uint256 share = amount * _sharePerPARSE;
        _payTax(from, amount);
        _transfer(from, to, share);
        emit Transfer(from, to, amount);

        return true;
    }

    function transferFrom(
        address from,
        address to,
        uint256 amount
    ) public virtual override returns (bool) {
        address spender = _msgSender();
        _spendAllowance(from, spender, amount);

        uint256 share = amount * _sharePerPARSE;
        _payTax(from, amount);
        _transfer(from, to, share);
        emit Transfer(from, to, amount);

        return true;
    }
}

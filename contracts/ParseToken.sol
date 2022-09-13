// SPDX-License-Identifier: SEE LICENSE IN LICENSE
pragma solidity ^0.8.0;

import "./lib/ERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";

contract ParseToken is Initializable, ERC20Upgradeable, OwnableUpgradeable {
    address public policyMaker;
    address public treasury;

    uint256 private constant DECIMALS = 9;
    uint256 private constant INITIAL_PARSE_SUPPLY = 50 * 10**6 * 10**DECIMALS;

    uint256 private constant TOTAL_SHARE =
        type(uint256).max - (type(uint256).max % INITIAL_PARSE_SUPPLY);

    uint256 private constant MAX_SUPPLY = type(uint128).max;
    uint256 private _sharePerPARSE;
    uint256 private _totalPARSESupply;

    uint256 public taxRate;
    uint256 public taxExpirationTime;
    uint256 public lastTimeTaxUpdated;

    event LogRebase(uint256 indexed epoch, uint256 totalSupply);
    event LogPolicyMakerUpdated(address policyMaker);
    event treasuryUpdated(address oldTreasury, address newTreasury);

    modifier onlyPolicyMaker() {
        require(msg.sender == policyMaker);
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
        taxExpirationTime = 26 * 60 * 60; //26 hours in sec
        lastTimeTaxUpdated = block.timestamp;
    }

    function decimals() public view virtual override returns (uint8) {
        return uint8(DECIMALS);
    }

    function taxExpired() private view returns (bool) {
        return (block.timestamp >= (lastTimeTaxUpdated + taxExpirationTime));
    }

    function getTaxRate() external view returns (uint256) {
        return taxRate;
    }

    function setTaxRate(uint256 taxRate_) external onlyPolicyMaker {
        taxRate = taxRate_;
        lastTimeTaxUpdated = block.timestamp;
    }

    function setTaxExpirationTime(uint256 taxExpirationTime_)
        external
        onlyOwner
    {
        require(taxExpirationTime_ > 0);
        taxExpirationTime = taxExpirationTime_;
    }

    function setPolicyMaker(address policyMaker_) external onlyOwner {
        policyMaker = policyMaker_;
        emit LogPolicyMakerUpdated(policyMaker_);
    }

    function setTreasuryAddress(address _treasury) external onlyOwner {
        require(treasury != _treasury);

        treasury = _treasury;
        //emit treasuryUpdated(treasury, _treasury); LOG
    }

    function rebase(uint256 epoch, int256 supplyDelta)
        external
        onlyPolicyMaker
        returns (uint256)
    {
        if (supplyDelta == 0) {
            emit LogRebase(epoch, _totalPARSESupply);
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

        emit LogRebase(epoch, _totalPARSESupply);
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
        require(!taxExpired());
        if (taxRate > 0) {
            uint256 share = amount * _sharePerPARSE;
            uint256 taxValue = (share * taxRate) / (10**DECIMALS);
            _transfer(seller, treasury, taxValue);
            emit Transfer(seller, treasury, amount);
        }
    }

    function transfer(address to, uint256 amount)
        public
        virtual
        override
        returns (bool)
    {
        address owner = _msgSender();
        uint256 share = amount * _sharePerPARSE;
        _payTax(owner, amount);
        _transfer(owner, to, share);
        emit Transfer(owner, to, amount);

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

// SPDX-License-Identifier: SEE LICENSE IN LICENSE
pragma solidity ^0.8.0;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "./lib/SafeMathInt.sol";
import "./interface/IParseToken.sol";
import "./interface/IOracle.sol";

contract PolicyMaker is Initializable, OwnableUpgradeable {
    event LogRebase(
        uint256 indexed epoch,
        uint256 exchangeRate,
        uint256 cpi,
        int256 requestedSupplyAdjustment,
        uint256 timestampSec
    );
    event LogTaxChanged(
        uint256 indexed epoch,
        uint256 exchangeRate,
        uint256 taxRate,
        uint256 timeStampSec
    );

    IParseToken public parseToken;
    IOracle public cpiOracle;
    IOracle public marketOracle;
    address public orchestrator;

    uint256 public rebaseUpperThreshold;
    uint256 public rebaseLowerThreshold;
    uint256 public minRebaseOrTaxTimeIntervalSec;
    uint256 public lastRebaseOrTaxTimestampSec;
    uint256 public rebaseOrTaxWindowOffsetSec;
    uint256 public rebaseOrTaxWindowLengthSec;
    uint256 public epoch;
    uint256 public baseCpi;
    uint256 public taxStepThreshold;
    uint256 public taxThetaThreshold;
    uint256 public taxValue;
    int256 public rebaseFunctionLowerPercentage;
    int256 public rebaseFunctionUpperPercentage;
    int256 public rebaseFunctionGrowth;

    uint256 public constant DECIMALS = 18;
    uint256 private constant MAX_RATE = 10**6 * 10**DECIMALS;
    uint256 private constant MAX_SUPPLY = uint256(type(int256).max) / MAX_RATE;
    uint256 private constant dayINsec = 24 * 60 * 60;
    int256 private constant ONE = int256(10**DECIMALS);

    modifier onlyOrchestrator() {
        require(msg.sender == orchestrator, "only orchestrator");
        _;
    }

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(IParseToken parseToken_, uint256 baseCpi_)
        public
        initializer
    {
        __Ownable_init();

        // positiveDeviationThreshold = 0.05e18 = 5e16 negativeDeviationThreshold = 0.15e18 = 15e16
        rebaseUpperThreshold = 5 * 10**(DECIMALS - 2);
        rebaseLowerThreshold = 15 * 10**(DECIMALS - 2);

        rebaseFunctionGrowth = int256(3 * (10**DECIMALS));
        rebaseFunctionUpperPercentage = int256(10 * (10**(DECIMALS - 2))); // 0.1
        rebaseFunctionLowerPercentage = int256(
            (-10) * int256(10**(DECIMALS - 2))
        ); // -0.1

        minRebaseOrTaxTimeIntervalSec = 1 days;
        rebaseOrTaxWindowOffsetSec = 7200; // 2AM UTC
        rebaseOrTaxWindowLengthSec = 20 minutes;

        lastRebaseOrTaxTimestampSec = 0;
        epoch = 0;
        epoch = 0;

        parseToken = parseToken_;
        baseCpi = baseCpi_;
    }

    function decimals() public pure returns (uint8) {
        return uint8(DECIMALS);
    }

    function inRebaseOrTaxWindow() public view returns (bool) {
        return (((block.timestamp % minRebaseOrTaxTimeIntervalSec) >=
            rebaseOrTaxWindowOffsetSec) &&
            ((block.timestamp % minRebaseOrTaxTimeIntervalSec) <
                (rebaseOrTaxWindowOffsetSec + rebaseOrTaxWindowLengthSec)));
    }

    function computeTaxRate(
        uint256 normalizedRate,
        uint256 taxStepThreshold_,
        uint256 taxThetaThreshold_,
        uint256 taxValue_
    ) public pure returns (uint256 taxRate) {
        taxRate = 0;
        if (
            normalizedRate <
            (10**DECIMALS - taxStepThreshold_ - taxThetaThreshold_)
        ) {
            uint256 k = 10**DECIMALS;
            k = k - normalizedRate - taxThetaThreshold_;

            k = (k * (10**DECIMALS)) / taxStepThreshold_;

            k = (k / (10**DECIMALS)) * (10**DECIMALS); // The floor of k

            taxRate = (k * taxValue_) / (10**DECIMALS);
        }
    }

    function imposeTax(uint256 exchangeRate, uint256 targetRate) private {
        // This comparison also ensures there is no reentrancy.
        require(
            (lastRebaseOrTaxTimestampSec + minRebaseOrTaxTimeIntervalSec) <
                block.timestamp
        );

        lastRebaseOrTaxTimestampSec =
            block.timestamp -
            (block.timestamp % minRebaseOrTaxTimeIntervalSec) +
            rebaseOrTaxWindowOffsetSec;

        uint256 normalizedRate = (exchangeRate * (10**DECIMALS)) / (targetRate);
        uint256 taxRate = computeTaxRate(
            normalizedRate,
            taxStepThreshold,
            taxThetaThreshold,
            taxValue
        );

        // converting 18-decimals to 9-decimals
        uint256 decimal_dif = DECIMALS - parseToken.DECIMALS();
        taxRate = taxRate / (10**decimal_dif);

        parseToken.setTaxRate(taxRate);
        emit LogTaxChanged(epoch, exchangeRate, taxRate, block.timestamp); // exchangeRate is divided by targetRate
    }

    function computeRebasePercentage(
        int256 normalizedRate,
        int256 lower,
        int256 upper,
        int256 growth
    ) public pure returns (int256) {
        int256 delta;

        delta = normalizedRate - ONE;

        // Compute: (Upper-Lower)/(1-(Upper/Lower)/2^(Growth*delta))) + Lower

        int256 exponent = (growth * delta) / (ONE);
        // Cap exponent to guarantee it is not too big for twoPower
        if (exponent > ONE * 100) {
            exponent = ONE * 100;
        }
        if (exponent < ONE * -100) {
            exponent = ONE * -100;
        }

        int256 pow = SafeMathInt.twoPower(exponent, ONE); // 2^(Growth*Delta)
        if (pow == 0) {
            return lower;
        }
        int256 numerator = upper - lower; //(Upper-Lower)
        int256 intermediate = (upper * ONE) / lower;
        intermediate = (intermediate * ONE) / pow;
        int256 denominator = ONE - intermediate; // (1-(Upper/Lower)/2^(Growth*delta)))

        int256 rebasePercentage = ((numerator * ONE) / denominator) + lower;
        return rebasePercentage;
    }

    function computeSupplyDelta(uint256 rate, uint256 targetRate)
        internal
        view
        returns (int256)
    {
        // if (withinDeviationThreshold(rate, targetRate)) {
        //     return 0;
        // }
        int256 targetRateSigned = int256(targetRate);
        int256 normalizedRate = (int256(rate) * ONE) / targetRateSigned;
        int256 rebasePercentage = computeRebasePercentage(
            normalizedRate,
            rebaseFunctionLowerPercentage,
            rebaseFunctionUpperPercentage,
            rebaseFunctionGrowth
        );

        return (int256(parseToken.totalSupply()) * rebasePercentage) / ONE;
    }

    function rebase(
        uint256 exchangeRate,
        uint256 targetRate,
        uint256 cpi
    ) private {
        // require(inRebaseOrTaxWindow());

        // This comparison also ensures there is no reentrancy.
        require(
            (lastRebaseOrTaxTimestampSec + minRebaseOrTaxTimeIntervalSec) <
                block.timestamp
        );

        lastRebaseOrTaxTimestampSec =
            block.timestamp -
            (block.timestamp % minRebaseOrTaxTimeIntervalSec) +
            rebaseOrTaxWindowOffsetSec;

        if (exchangeRate > MAX_RATE) {
            exchangeRate = MAX_RATE;
        }

        int256 supplyDelta = computeSupplyDelta(exchangeRate, targetRate);

        if (
            supplyDelta > 0 &&
            (parseToken.totalSupply() + uint256(supplyDelta)) > MAX_SUPPLY
        ) {
            supplyDelta = int256(MAX_SUPPLY - parseToken.totalSupply());
        }

        uint256 supplyAfterRebase = parseToken.rebase(epoch, supplyDelta);
        assert(supplyAfterRebase <= MAX_SUPPLY);
        emit LogRebase(epoch, exchangeRate, cpi, supplyDelta, block.timestamp);
    }

    function rebaseOrTax() external onlyOrchestrator {
        require(inRebaseOrTaxWindow(), "not in rebaseOrTax window");

        uint256 cpi;
        bool cpiValid;
        (cpi, cpiValid) = cpiOracle.getData();
        require(cpiValid, "cpi not valid");
        uint256 tmp = baseCpi;
        uint256 targetRate = (cpi * (10**DECIMALS)) / tmp;

        uint256 exchangeRate;
        bool rateValid;
        (exchangeRate, rateValid) = marketOracle.getData();
        require(rateValid, "exchangeRate not valid");

        epoch++;

        uint256 absoluterebaseUpperThreshold = (targetRate *
            rebaseUpperThreshold) / (10**DECIMALS);

        uint256 absoluterebaseLowerThreshold = (targetRate *
            rebaseLowerThreshold) / (10**DECIMALS);
        if (
            (exchangeRate > targetRate) &&
            (exchangeRate > (targetRate + absoluterebaseUpperThreshold))
        ) {
            // rebase
            rebase(exchangeRate, targetRate, cpi);
            return;
        } else if (
            (exchangeRate < targetRate) &&
            (exchangeRate <= (targetRate - taxThetaThreshold)) &&
            (exchangeRate >= (targetRate - absoluterebaseLowerThreshold))
        ) {
            // tax
            imposeTax(exchangeRate, targetRate);
            return;
        } else if (
            (exchangeRate < targetRate) &&
            (exchangeRate < targetRate - absoluterebaseLowerThreshold)
        ) {
            // rebase
            rebase(exchangeRate, targetRate, cpi);
            return;
        } else {
            // tax zero
            parseToken.setTaxRate(0);
            emit LogTaxChanged(epoch, exchangeRate, 0, block.timestamp);
            return;
        }
    }

    function setTaxParameters(
        uint256 _taxThetaThreshold,
        uint256 _taxStepThreshold,
        uint256 _taxValue
    ) external onlyOwner {
        require(_taxStepThreshold > 0);
        require(_taxThetaThreshold > 0);
        taxThetaThreshold = _taxThetaThreshold;
        taxStepThreshold = _taxStepThreshold;
        taxValue = _taxValue;
    }

    function setTaxStepThreshold(uint256 _taxStepThreshold) external onlyOwner {
        require(_taxStepThreshold > 0);

        taxStepThreshold = _taxStepThreshold;
    }

    function setTaxThetaThreshold(uint256 _taxThetaThreshold)
        external
        onlyOwner
    {
        require(_taxThetaThreshold > 0);
        taxThetaThreshold = _taxThetaThreshold;
    }

    function setTaxValue(uint256 _taxValue) external onlyOwner {
        taxValue = _taxValue;
    }

    /**
     * @notice Sets the reference to the CPI oracle.
     * @param cpiOracle_ The address of the cpi oracle contract.
     */
    function setCpiOracle(IOracle cpiOracle_) external onlyOwner {
        cpiOracle = cpiOracle_;
    }

    /**
     * @notice Sets the reference to the market oracle.
     * @param marketOracle_ The address of the market oracle contract.
     */
    function setMarketOracle(IOracle marketOracle_) external onlyOwner {
        marketOracle = marketOracle_;
    }

    /**
     * @notice Sets the reference to the orchestrator.
     * @param orchestrator_ The address of the orchestrator contract.
     */
    function setOrchestrator(address orchestrator_) external onlyOwner {
        orchestrator = orchestrator_;
    }

    function setRebaseFunctionGrowth(int256 rebaseFunctionGrowth_)
        external
        onlyOwner
    {
        require(rebaseFunctionGrowth_ >= 0);
        rebaseFunctionGrowth = rebaseFunctionGrowth_;
    }

    function setRebaseFunctionLowerPercentage(
        int256 rebaseFunctionLowerPercentage_
    ) external onlyOwner {
        require(rebaseFunctionLowerPercentage_ <= 0);
        rebaseFunctionLowerPercentage = rebaseFunctionLowerPercentage_;
    }

    function setRebaseFunctionUpperPercentage(
        int256 rebaseFunctionUpperPercentage_
    ) external onlyOwner {
        require(rebaseFunctionUpperPercentage_ >= 0);
        rebaseFunctionUpperPercentage = rebaseFunctionUpperPercentage_;
    }

    /**
     * @notice Sets the deviation threshold fraction. If the exchange rate given by the market
     *         oracle is within this fractional distance from the targetRate, then no supply
     *         modifications are made. DECIMALS fixed point number.
     * @param rebaseLowerThreshold_ The new exchange rate threshold fraction.
     * @param rebaseUpperThreshold_ The new exchange rate threshold fraction.

     */
    function setDeviationThresholds(
        uint256 rebaseLowerThreshold_,
        uint256 rebaseUpperThreshold_
    ) external onlyOwner {
        rebaseLowerThreshold = rebaseLowerThreshold_;
        rebaseUpperThreshold = rebaseUpperThreshold_;
    }

    /**
     * @notice Sets the parameters which control the timing and frequency of
     *         rebase operations.
     *         a) the minimum time period that must elapse between rebase cycles.
     *         b) the rebase window offset parameter.
     *         c) the rebase window length parameter.
     * @param minRebaseOrTaxTimeIntervalSec_ More than this much time must pass between rebase
     *        operations, in seconds.
     * @param rebaseOrTaxWindowOffsetSec_ The number of seconds from the beginning of
              the rebase interval, where the rebase window begins.
     * @param rebaseOrTaxWindowLengthSec_ The length of the rebase window in seconds.
     */
    function setTimingParameters(
        uint256 minRebaseOrTaxTimeIntervalSec_,
        uint256 rebaseOrTaxWindowOffsetSec_,
        uint256 rebaseOrTaxWindowLengthSec_
    ) external onlyOwner {
        require(minRebaseOrTaxTimeIntervalSec_ > 0);
        require(rebaseOrTaxWindowOffsetSec_ < minRebaseOrTaxTimeIntervalSec_);

        minRebaseOrTaxTimeIntervalSec = minRebaseOrTaxTimeIntervalSec_;
        rebaseOrTaxWindowOffsetSec = rebaseOrTaxWindowOffsetSec_;
        rebaseOrTaxWindowLengthSec = rebaseOrTaxWindowLengthSec_;
    }
}

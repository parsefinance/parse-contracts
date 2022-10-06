// SPDX-License-Identifier: SEE LICENSE IN LICENSE
pragma solidity ^0.8.0;

import "./lib/Select.sol";
import "./interface/IOracle.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";

contract MedianOracle is Initializable, OwnableUpgradeable, IOracle {
    struct Report {
        uint256 timestamp;
        uint256 payload;
    }

    address[] public providers;
    mapping(address => Report[2]) public providerReports;

    event ProviderAdded(address provider);
    event ProviderRemoved(address provider);
    event ReportTimestampOutOfRange(address provider);
    event ProviderReportPushed(
        address indexed provider,
        uint256 payload,
        uint256 timestamp
    );

    uint256 public reportExpirationTimeSec;
    uint256 public reportDelaySec;
    uint256 public minimumProviders;
    uint256 private constant MAX_REPORT_EXPIRATION_TIME = 520 weeks;

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        uint256 reportExpirationTimeSec_,
        uint256 reportDelaySec_,
        uint256 minimumProviders_
    ) public initializer {
        __Ownable_init();
        require(reportExpirationTimeSec_ <= MAX_REPORT_EXPIRATION_TIME);
        require(minimumProviders_ > 0);
        reportExpirationTimeSec = reportExpirationTimeSec_;
        reportDelaySec = reportDelaySec_;
        minimumProviders = minimumProviders_;
        minimumProviders = 1;
    }

    function setReportExpirationTimeSec(uint256 reportExpirationTimeSec_)
        external
        onlyOwner
    {
        require(reportExpirationTimeSec_ <= MAX_REPORT_EXPIRATION_TIME);
        reportExpirationTimeSec = reportExpirationTimeSec_;
    }

    function setReportDelaySec(uint256 reportDelaySec_) external onlyOwner {
        reportDelaySec = reportDelaySec_;
    }

    function setMinimumProviders(uint256 minimumProviders_) external onlyOwner {
        require(minimumProviders_ > 0);
        minimumProviders = minimumProviders_;
    }

    function pushReport(uint256 payload) external {
        address providerAddress = msg.sender;
        Report[2] storage reports = providerReports[providerAddress];
        uint256[2] memory timestamps = [
            reports[0].timestamp,
            reports[1].timestamp
        ];

        require(timestamps[0] > 0);

        uint8 index_recent = timestamps[0] >= timestamps[1] ? 0 : 1;
        uint8 index_past = 1 - index_recent;

        // Check that the push is not too soon after the last one.
        require((timestamps[index_recent] + reportDelaySec) <= block.timestamp);

        reports[index_past].timestamp = block.timestamp;
        reports[index_past].payload = payload;

        emit ProviderReportPushed(providerAddress, payload, block.timestamp);
    }

    function purgeReports() external {
        address providerAddress = msg.sender;
        require(providerReports[providerAddress][0].timestamp > 0);
        providerReports[providerAddress][0].timestamp = 1;
        providerReports[providerAddress][1].timestamp = 1;
    }

    function getData() external override returns (uint256, bool) {
        uint256 reportsCount = providers.length;
        uint256[] memory validReports = new uint256[](reportsCount);
        uint256 size = 0;
        uint256 minValidTimestamp = block.timestamp - reportExpirationTimeSec;
        uint256 maxValidTimestamp = block.timestamp - reportDelaySec;

        for (uint256 i = 0; i < reportsCount; i++) {
            address providerAddress = providers[i];
            Report[2] memory reports = providerReports[providerAddress];

            uint8 index_recent = reports[0].timestamp >= reports[1].timestamp
                ? 0
                : 1;
            uint8 index_past = 1 - index_recent;
            uint256 reportTimestampRecent = reports[index_recent].timestamp;
            if (reportTimestampRecent > maxValidTimestamp) {
                // Recent report is too recent.
                uint256 reportTimestampPast = providerReports[providerAddress][
                    index_past
                ].timestamp;
                if (reportTimestampPast < minValidTimestamp) {
                    // Past report is too old.
                    emit ReportTimestampOutOfRange(providerAddress);
                } else if (reportTimestampPast > maxValidTimestamp) {
                    // Past report is too recent.
                    emit ReportTimestampOutOfRange(providerAddress);
                } else {
                    // Using past report.
                    validReports[size++] = providerReports[providerAddress][
                        index_past
                    ].payload;
                }
            } else {
                // Recent report is not too recent.
                if (reportTimestampRecent < minValidTimestamp) {
                    // Recent report is too old.
                    emit ReportTimestampOutOfRange(providerAddress);
                } else {
                    // Using recent report.
                    validReports[size++] = providerReports[providerAddress][
                        index_recent
                    ].payload;
                }
            }
        }

        if (size < minimumProviders) {
            return (0, false);
        }

        return (Select.computeMedian(validReports, size), true);
    }

    function addProvider(address provider) external onlyOwner {
        require(
            providerReports[provider][0].timestamp == 0,
            "providerReports[provider][0].timestamp == 0"
        );
        providers.push(provider);
        providerReports[provider][0].timestamp = 1;
        emit ProviderAdded(provider);
    }

    // TODO: rewrite removeProvider such that it doesn't change providers.length
    // function removeProvider(address provider) external onlyOwner {
    //     delete providerReports[provider];
    //     for (uint256 i = 0; i < providers.length; i++) {
    //         if (providers[i] == provider) {
    //             if (i + 1 != providers.length) {
    //                 providers[i] = providers[providers.length - 1];
    //             }
    //             delete providers[providers.length];
    //             emit ProviderRemoved(provider);
    //             break;
    //         }
    //     }
    // }

    function providersSize() external view returns (uint256) {
        return providers.length;
    }
}

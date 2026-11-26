// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract RevenueGate {
    address public oracle;
    address public owner;
    uint256 public graduationThreshold;
    uint256 public totalWeightedScore;
    uint256 public totalPayments;
    uint256 public eligiblePayments;
    uint256 public flaggedPayments;
    bool public graduated;

    struct Payment {
        address payer;
        uint256 confidence;
        uint256 amount;
        uint256 timestamp;
        bytes32 paymentId;
        bool eligible;
    }

    Payment[] public payments;
    mapping(bytes32 => bool) public processedPayments;

    event PaymentRecorded(
        bytes32 indexed paymentId,
        address indexed payer,
        uint256 confidence,
        uint256 amount,
        bool eligible
    );
    event GraduationReached(uint256 totalWeightedScore, uint256 totalPayments);
    event OracleUpdated(address indexed oldOracle, address indexed newOracle);
    event ThresholdUpdated(uint256 oldThreshold, uint256 newThreshold);

    modifier onlyOracle() {
        require(msg.sender == oracle, "Only oracle");
        _;
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "Only owner");
        _;
    }

    constructor(address _oracle, uint256 _graduationThreshold) {
        owner = msg.sender;
        oracle = _oracle;
        graduationThreshold = _graduationThreshold;
    }

    function recordPayment(
        bytes32 paymentId,
        address payer,
        uint256 confidence,
        uint256 amount
    ) external onlyOracle {
        require(!processedPayments[paymentId], "Already processed");
        require(confidence <= 100, "Confidence 0-100");
        require(payer != address(0), "Invalid payer");

        processedPayments[paymentId] = true;

        bool eligible = confidence >= 60;
        payments.push(Payment({
            payer: payer,
            confidence: confidence,
            amount: amount,
            timestamp: block.timestamp,
            paymentId: paymentId,
            eligible: eligible
        }));

        totalPayments++;
        if (eligible) {
            eligiblePayments++;
            totalWeightedScore += confidence;
        } else {
            flaggedPayments++;
        }

        emit PaymentRecorded(paymentId, payer, confidence, amount, eligible);

        if (!graduated && totalWeightedScore >= graduationThreshold) {
            graduated = true;
            emit GraduationReached(totalWeightedScore, totalPayments);
        }
    }

    function getPaymentCount() external view returns (uint256) {
        return payments.length;
    }

    function getGraduationProgress() external view returns (
        uint256 _totalWeightedScore,
        uint256 _graduationThreshold,
        uint256 _totalPayments,
        uint256 _eligiblePayments,
        uint256 _flaggedPayments,
        bool _graduated,
        uint256 _progressPercent
    ) {
        uint256 progress = graduationThreshold > 0
            ? (totalWeightedScore * 100) / graduationThreshold
            : 0;
        if (progress > 100) progress = 100;

        return (
            totalWeightedScore,
            graduationThreshold,
            totalPayments,
            eligiblePayments,
            flaggedPayments,
            graduated,
            progress
        );
    }

    function setOracle(address _oracle) external onlyOwner {
        emit OracleUpdated(oracle, _oracle);
        oracle = _oracle;
    }

    function setThreshold(uint256 _threshold) external onlyOwner {
        emit ThresholdUpdated(graduationThreshold, _threshold);
        graduationThreshold = _threshold;
    }
}

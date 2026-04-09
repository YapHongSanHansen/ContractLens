// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract ContractLensRegistry {
    struct Audit {
        address auditor;
        uint8 riskScore;
        string verdict;
        string reportCID;
        uint8 confirmedExploits;
        uint256 timestamp;
    }

    mapping(address => Audit[]) public auditHistory;
    mapping(address => bool) public registeredAuditors;

    address public owner;

    event AuditPublished(
        address indexed target,
        address indexed auditor,
        uint8 riskScore,
        string verdict,
        string reportCID,
        uint256 timestamp
    );

    event AuditRequested(address indexed target, address indexed requester, uint256 fee);

    modifier onlyRegistered() {
        require(registeredAuditors[msg.sender], "Not a registered auditor");
        _;
    }

    constructor() {
        owner = msg.sender;
        registeredAuditors[msg.sender] = true;
    }

    function registerAuditor(address auditor) external {
        require(msg.sender == owner, "Only owner");
        registeredAuditors[auditor] = true;
    }

    function publishAudit(
        address target,
        uint8 riskScore,
        string calldata verdict,
        string calldata reportCID,
        uint8 confirmedExploits
    ) external onlyRegistered {
        Audit memory a = Audit({
            auditor: msg.sender,
            riskScore: riskScore,
            verdict: verdict,
            reportCID: reportCID,
            confirmedExploits: confirmedExploits,
            timestamp: block.timestamp
        });
        auditHistory[target].push(a);
        emit AuditPublished(target, msg.sender, riskScore, verdict, reportCID, block.timestamp);
    }

    function getLatestAudit(address target) external view returns (Audit memory) {
        require(auditHistory[target].length > 0, "No audits found");
        return auditHistory[target][auditHistory[target].length - 1];
    }

    function getAuditCount(address target) external view returns (uint256) {
        return auditHistory[target].length;
    }

    function requestAudit(address target) external payable {
        require(msg.value >= 0.001 ether, "Minimum fee required");
        emit AuditRequested(target, msg.sender, msg.value);
    }

    function withdraw() external {
        require(msg.sender == owner, "Only owner");
        payable(owner).transfer(address(this).balance);
    }
}

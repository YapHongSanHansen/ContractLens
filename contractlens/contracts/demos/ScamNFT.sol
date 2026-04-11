// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// DEMO: Scam NFT. Looks like a normal mint, but:
//   1. owner can mint unlimited free NFTs (rug the floor)
//   2. owner can change baseURI to a rick-roll after sellout
//   3. transfers can be paused arbitrarily (honeypot exits)
//   4. royalty receiver can be swapped to drain secondary sales
// ContractLens should flag: mutable baseURI, owner mint, pausable transfers.

contract ScamNFT {
    string public name = "RareApeClub";
    string public symbol = "RAC";
    uint256 public constant PRICE = 0.05 ether;
    uint256 public constant ADVERTISED_MAX = 5000;

    string public baseURI;
    address public owner;
    address public royaltyReceiver;
    bool public transfersPaused;
    uint256 public totalMinted;

    mapping(uint256 => address) public ownerOf;
    mapping(address => uint256) public balanceOf;

    event Transfer(address indexed from, address indexed to, uint256 indexed tokenId);

    constructor(string memory _uri) {
        owner = msg.sender;
        royaltyReceiver = msg.sender;
        baseURI = _uri;
    }

    function mint() external payable {
        require(msg.value == PRICE, "wrong price");
        require(totalMinted < ADVERTISED_MAX, "sold out");
        _mint(msg.sender);
    }

    // RUG 1: unlimited owner mint, ignores ADVERTISED_MAX
    function ownerMint(address to, uint256 count) external {
        require(msg.sender == owner, "only owner");
        for (uint256 i = 0; i < count; i++) _mint(to);
    }

    // RUG 2: baseURI can be swapped any time
    function setBaseURI(string calldata _uri) external {
        require(msg.sender == owner, "only owner");
        baseURI = _uri;
    }

    // RUG 3: transfers can be frozen
    function setPaused(bool p) external {
        require(msg.sender == owner, "only owner");
        transfersPaused = p;
    }

    // RUG 4: redirect secondary-sale royalties
    function setRoyaltyReceiver(address r) external {
        require(msg.sender == owner, "only owner");
        royaltyReceiver = r;
    }

    function transferFrom(address from, address to, uint256 tokenId) external {
        require(!transfersPaused, "paused");
        require(ownerOf[tokenId] == from, "wrong from");
        require(msg.sender == from, "not authorized");
        balanceOf[from] -= 1;
        balanceOf[to] += 1;
        ownerOf[tokenId] = to;
        emit Transfer(from, to, tokenId);
    }

    function withdraw() external {
        require(msg.sender == owner, "only owner");
        payable(owner).transfer(address(this).balance);
    }

    function _mint(address to) internal {
        uint256 tokenId = ++totalMinted;
        ownerOf[tokenId] = to;
        balanceOf[to] += 1;
        emit Transfer(address(0), to, tokenId);
    }
}

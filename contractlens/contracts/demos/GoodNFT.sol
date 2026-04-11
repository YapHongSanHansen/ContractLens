// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// DEMO: Minimal, well-behaved ERC721-style NFT.
// Fixed max supply, immutable base URI, no owner mint backdoor, no royalty
// rug. Used as the "safe NFT" baseline for ContractLens scans.

contract GoodNFT {
    string public constant name = "GoodArt";
    string public constant symbol = "GART";
    uint256 public constant MAX_SUPPLY = 5000;
    uint256 public constant PRICE = 0.01 ether;
    string public baseURI;
    uint256 public totalMinted;

    mapping(uint256 => address) public ownerOf;
    mapping(address => uint256) public balanceOf;
    mapping(uint256 => address) public getApproved;
    mapping(address => mapping(address => bool)) public isApprovedForAll;

    event Transfer(address indexed from, address indexed to, uint256 indexed tokenId);
    event Approval(address indexed owner, address indexed approved, uint256 indexed tokenId);

    constructor(string memory _baseURI) {
        baseURI = _baseURI; // set once at deploy
    }

    function mint() external payable {
        require(msg.value == PRICE, "wrong price");
        require(totalMinted < MAX_SUPPLY, "sold out");
        uint256 tokenId = ++totalMinted;
        ownerOf[tokenId] = msg.sender;
        balanceOf[msg.sender] += 1;
        emit Transfer(address(0), msg.sender, tokenId);
    }

    function tokenURI(uint256 tokenId) external view returns (string memory) {
        require(ownerOf[tokenId] != address(0), "nonexistent");
        return string(abi.encodePacked(baseURI, _toString(tokenId)));
    }

    function approve(address to, uint256 tokenId) external {
        address o = ownerOf[tokenId];
        require(msg.sender == o || isApprovedForAll[o][msg.sender], "not authorized");
        getApproved[tokenId] = to;
        emit Approval(o, to, tokenId);
    }

    function transferFrom(address from, address to, uint256 tokenId) public {
        require(ownerOf[tokenId] == from, "wrong from");
        require(to != address(0), "zero");
        require(
            msg.sender == from ||
                getApproved[tokenId] == msg.sender ||
                isApprovedForAll[from][msg.sender],
            "not authorized"
        );
        delete getApproved[tokenId];
        balanceOf[from] -= 1;
        balanceOf[to] += 1;
        ownerOf[tokenId] = to;
        emit Transfer(from, to, tokenId);
    }

    function _toString(uint256 v) internal pure returns (string memory) {
        if (v == 0) return "0";
        uint256 j = v;
        uint256 len;
        while (j != 0) { len++; j /= 10; }
        bytes memory b = new bytes(len);
        while (v != 0) { b[--len] = bytes1(uint8(48 + v % 10)); v /= 10; }
        return string(b);
    }
}

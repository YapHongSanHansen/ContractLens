// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/// @title GoodNFT — safe ERC-721 with fixed max supply and lockable metadata.
/// @notice Built to pass an audit: no admin burn/seize, two-step ownership,
/// metadata freeze after reveal, fixed mint price, capped supply.
contract GoodNFT {
    string public constant name = "Good Collection";
    string public constant symbol = "GOOD";
    uint256 public constant MAX_SUPPLY = 5000;
    uint256 public constant MINT_PRICE = 0.05 ether;

    address public owner;
    address public pendingOwner;
    uint256 public totalMinted;
    string private _baseURI;
    bool public metadataLocked;

    mapping(uint256 => address) public ownerOf;
    mapping(address => uint256) public balanceOf;
    mapping(uint256 => address) public getApproved;
    mapping(address => mapping(address => bool)) public isApprovedForAll;

    event Transfer(address indexed from, address indexed to, uint256 indexed tokenId);
    event Approval(address indexed owner, address indexed approved, uint256 indexed tokenId);
    event ApprovalForAll(address indexed owner, address indexed operator, bool approved);

    modifier onlyOwner() {
        require(msg.sender == owner, "not owner");
        _;
    }

    constructor(string memory baseURI_) {
        owner = msg.sender;
        _baseURI = baseURI_;
    }

    function mint() external payable {
        require(totalMinted < MAX_SUPPLY, "sold out");
        require(msg.value == MINT_PRICE, "wrong price");
        uint256 tokenId = ++totalMinted;
        ownerOf[tokenId] = msg.sender;
        balanceOf[msg.sender]++;
        emit Transfer(address(0), msg.sender, tokenId);
    }

    function tokenURI(uint256 tokenId) external view returns (string memory) {
        require(ownerOf[tokenId] != address(0), "nonexistent");
        return string(abi.encodePacked(_baseURI, _toString(tokenId), ".json"));
    }

    function setBaseURI(string calldata baseURI_) external onlyOwner {
        require(!metadataLocked, "metadata locked");
        _baseURI = baseURI_;
    }

    function lockMetadata() external onlyOwner {
        metadataLocked = true;
    }

    function withdraw() external onlyOwner {
        (bool ok, ) = owner.call{value: address(this).balance}("");
        require(ok, "withdraw failed");
    }

    function transferFrom(address from, address to, uint256 tokenId) public {
        require(ownerOf[tokenId] == from, "not owner of");
        require(to != address(0), "to=0");
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
        emit Approval(holder, to, tokenId);
    }

    function setApprovalForAll(address operator, bool approved) external {
        isApprovedForAll[msg.sender][operator] = approved;
        emit ApprovalForAll(msg.sender, operator, approved);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        pendingOwner = newOwner;
    }

    function acceptOwnership() external {
        require(msg.sender == pendingOwner, "not pending owner");
        owner = pendingOwner;
        pendingOwner = address(0);
    }

    function _toString(uint256 v) internal pure returns (string memory) {
        if (v == 0) return "0";
        uint256 j = v;
        uint256 len;
        while (j != 0) {
            len++;
            j /= 10;
        }
        bytes memory b = new bytes(len);
        while (v != 0) {
            len--;
            b[len] = bytes1(uint8(48 + (v % 10)));
            v /= 10;
        }
        return string(b);
    }
}

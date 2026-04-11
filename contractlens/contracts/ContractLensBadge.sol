// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title ContractLens Badge
/// @notice Soulbound ERC-721 representing a ContractLens audit verdict.
/// @dev Self-contained minimal ERC-721 (no external dependencies). Transfers revert;
///      only mint and burn (from zero / to zero) are allowed.
contract ContractLensBadge {
    string public constant name = "ContractLens Badge";
    string public constant symbol = "CLBADGE";

    struct BadgeData {
        address auditedContract;
        uint8 riskScore;
        string verdict; // "SAFE" | "CAUTION" | "CRITICAL"
        uint256 timestamp;
        address auditor;
    }

    address public owner;
    uint256 public nextTokenId = 1;

    mapping(address => bool) public registeredAuditors;
    mapping(uint256 => address) private _owners;
    mapping(address => uint256) private _balances;
    mapping(uint256 => string) private _tokenURIs;
    mapping(uint256 => BadgeData) public badgeData;

    // ERC-721 events (required for MetaMask / OpenSea indexing)
    event Transfer(address indexed from, address indexed to, uint256 indexed tokenId);
    event Approval(address indexed owner, address indexed approved, uint256 indexed tokenId);
    event ApprovalForAll(address indexed owner, address indexed operator, bool approved);

    event BadgeMinted(
        uint256 indexed tokenId,
        address indexed auditedContract,
        address indexed recipient,
        uint8 riskScore,
        string verdict,
        string tokenURI
    );

    modifier onlyOwner() {
        require(msg.sender == owner, "Only owner");
        _;
    }

    modifier onlyRegistered() {
        require(registeredAuditors[msg.sender], "Not a registered auditor");
        _;
    }

    constructor() {
        owner = msg.sender;
        registeredAuditors[msg.sender] = true;
    }

    function registerAuditor(address auditor) external onlyOwner {
        registeredAuditors[auditor] = true;
    }

    /// @notice Mint a soulbound audit badge.
    /// @param to Recipient (usually the auditor/deployer wallet for demo purposes).
    /// @param auditedContract The address that was audited.
    /// @param riskScore 0-100 score from the verdict pass.
    /// @param verdict One of "SAFE" / "CAUTION" / "CRITICAL".
    /// @param uri tokenURI — pin a JSON metadata blob to IPFS and pass ipfs://<cid>.
    function mint(
        address to,
        address auditedContract,
        uint8 riskScore,
        string calldata verdict,
        string calldata uri
    ) external onlyRegistered returns (uint256 tokenId) {
        require(to != address(0), "mint to zero");
        tokenId = nextTokenId++;

        _owners[tokenId] = to;
        _balances[to] += 1;
        _tokenURIs[tokenId] = uri;
        badgeData[tokenId] = BadgeData({
            auditedContract: auditedContract,
            riskScore: riskScore,
            verdict: verdict,
            timestamp: block.timestamp,
            auditor: msg.sender
        });

        emit Transfer(address(0), to, tokenId);
        emit BadgeMinted(tokenId, auditedContract, to, riskScore, verdict, uri);
    }

    // --- ERC-721 read surface ---

    function ownerOf(uint256 tokenId) external view returns (address) {
        address o = _owners[tokenId];
        require(o != address(0), "Nonexistent token");
        return o;
    }

    function balanceOf(address a) external view returns (uint256) {
        require(a != address(0), "zero address");
        return _balances[a];
    }

    function tokenURI(uint256 tokenId) external view returns (string memory) {
        require(_owners[tokenId] != address(0), "Nonexistent token");
        return _tokenURIs[tokenId];
    }

    function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
        return
            interfaceId == 0x01ffc9a7 || // ERC165
            interfaceId == 0x80ac58cd || // ERC721
            interfaceId == 0x5b5e139f;   // ERC721Metadata
    }

    // --- Soulbound: block all transfers and approvals ---

    function transferFrom(address, address, uint256) external pure {
        revert("Soulbound: non-transferable");
    }

    function safeTransferFrom(address, address, uint256) external pure {
        revert("Soulbound: non-transferable");
    }

    function safeTransferFrom(address, address, uint256, bytes calldata) external pure {
        revert("Soulbound: non-transferable");
    }

    function approve(address, uint256) external pure {
        revert("Soulbound: non-transferable");
    }

    function setApprovalForAll(address, bool) external pure {
        revert("Soulbound: non-transferable");
    }

    function getApproved(uint256) external pure returns (address) {
        return address(0);
    }

    function isApprovedForAll(address, address) external pure returns (bool) {
        return false;
    }
}

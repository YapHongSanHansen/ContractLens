// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../ContractLensBadge.sol";

contract DeployBadge is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");

        vm.startBroadcast(deployerPrivateKey);

        ContractLensBadge badge = new ContractLensBadge();

        console.log("ContractLensBadge deployed at:", address(badge));
        console.log("Owner:", badge.owner());
        console.log("Add to .env: BADGE_ADDRESS=", address(badge));

        vm.stopBroadcast();
    }
}

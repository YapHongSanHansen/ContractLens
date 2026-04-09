// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../ContractLensRegistry.sol";

contract DeployRegistry is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");

        vm.startBroadcast(deployerPrivateKey);

        ContractLensRegistry registry = new ContractLensRegistry();

        console.log("ContractLensRegistry deployed at:", address(registry));
        console.log("Owner:", registry.owner());

        vm.stopBroadcast();
    }
}

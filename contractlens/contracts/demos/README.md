# ContractLens demo targets

Six deliberately-crafted contracts for demonstrating ContractLens scans.
Each is a standalone `.sol` file — deploy any of them to a local/fork chain
and point the pipeline at the resulting address.

| File | Expected verdict | Risk score | Key red flags |
|---|---|---|---|
| [GoodToken.sol](GoodToken.sol) | SAFE | low | immutable supply, no owner, standard ERC20 flows |
| [GoodNFT.sol](GoodNFT.sol) | SAFE | low | fixed max supply, baseURI set once, no owner mint |
| [ScamToken.sol](ScamToken.sol) | HONEYPOT | high | hidden whitelist-sell, 99% transfer tax, blacklist |
| [ScamNFT.sol](ScamNFT.sol) | SCAM | high | unlimited owner mint, mutable baseURI, pausable transfers, royalty swap |
| [Rugpull.sol](Rugpull.sol) | RUGPULL | critical | `emergencyMigrate` + `sweep` drain vault, fake yield |
| [Drainer.sol](Drainer.sol) | MALICIOUS | critical | fake `claim()`, batched `transferFrom` of victim assets |

## Demo script

1. Deploy all six to the same local chain (see `../script/Deploy.s.sol`).
2. Run the ContractLens pipeline against each address in turn.
3. For the "good" pair you should see low risk scores and clean verdicts
   from `publishAudit`. For the other four, the pipeline should flag the
   specific patterns listed above and publish a high risk score to
   [ContractLensRegistry.sol](../ContractLensRegistry.sol).

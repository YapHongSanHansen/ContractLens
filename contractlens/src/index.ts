#!/usr/bin/env node

import "dotenv/config";
import { Command } from "commander";
import chalk from "chalk";
import { fetchSource } from "./pipeline/fetchSource.js";
import { runStaticAnalysis } from "./pipeline/staticAnalysis.js";
import { analyzeStructure } from "./pipeline/structuralAnalysis.js";
import { adversarialAudit } from "./pipeline/adversarialAudit.js";
import { testExploits } from "./pipeline/exploitTesting.js";
import { publishAudit } from "./pipeline/publish.js";
import { probeDcai } from "./utils/dcai.js";

const program = new Command();

program
  .name("contractlens")
  .description("AI-powered smart contract security auditor")
  .version("1.0.0");

program
  .command("audit")
  .description("Run a full security audit on a smart contract")
  .argument("[address]", "Contract address to audit (omit when using --file)")
  .option("--chain <chain>", "Chain to audit on", "ethereum")
  .option("--file <path>", "Audit a local .sol file instead of fetching from Etherscan")
  .option("--skip-publish", "Skip IPFS upload and on-chain publication")
  .option("--verbose", "Enable verbose output")
  .action(async (addressArg: string | undefined, options) => {
    const { verbose, skipPublish, file } = options;
    const chain = String(options.chain || "ethereum");

    if (!addressArg && !file) {
      console.error(chalk.red("✗ Provide a contract address or --file <path>"));
      process.exit(1);
    }
    const address: string =
      addressArg || "0x0000000000000000000000000000000000000000";

    console.log(
      chalk.bold.cyan("\n  ContractLens — AI Smart Contract Auditor\n")
    );
    console.log(chalk.gray(`  Target: ${address}`));
    console.log(chalk.gray(`  Chain:  ${chain}`));

    // Read-only sidecar probe of the dcai RPC service. Isolated from the
    // mint/registry flow — this can never block or fail the audit.
    const dcai = await probeDcai();
    if (dcai.ok) {
      console.log(
        chalk.gray(
          `  dcai:   chain ${dcai.chainId} @ block ${dcai.blockNumber.toLocaleString()}\n`
        )
      );
    } else {
      console.log(chalk.gray(`  dcai:   unreachable (${dcai.error})\n`));
    }

    try {
      // ═══ PHASE 1: Source Retrieval ═══
      console.log(chalk.yellow("▶ Phase 1: Fetching contract source..."));
      const sourceResult = await fetchSource(address, chain, file);
      console.log(
        chalk.green(
          `  ✓ Source retrieved: ${sourceResult.name}${sourceResult.isDecompiled ? " (decompiled)" : " (verified)"}`
        )
      );
      if (sourceResult.isDecompiled) {
        console.log(
          chalk.yellow(
            "  ⚠ Contract is UNVERIFIED. Source was reconstructed from bytecode by AI and is unreliable — verdict will be forced to CAUTION with low confidence."
          )
        );
      }
      if (verbose) {
        console.log(
          chalk.gray(
            `    Source length: ${sourceResult.source.length} characters`
          )
        );
      }

      // ═══ PHASE 2: Static Analysis (Slither) ═══
      console.log(
        chalk.yellow("\n▶ Phase 2: Running static analysis (Slither)...")
      );
      const staticResult = await runStaticAnalysis(sourceResult);
      if (!staticResult.slither.available) {
        console.log(
          chalk.gray(
            sourceResult.isDecompiled
              ? "  ⊘ Skipped: contract is unverified (Slither needs real Solidity)"
              : "  ⊘ Skipped: Slither not installed — continuing without SAST ground truth"
          )
        );
      } else if (staticResult.slither.error) {
        console.log(
          chalk.yellow(
            `  ⚠ Slither error: ${staticResult.slither.error} — continuing without SAST findings`
          )
        );
      } else {
        const bySeverity: Record<string, number> = {};
        for (const f of staticResult.slither.findings) {
          bySeverity[f.severity] = (bySeverity[f.severity] || 0) + 1;
        }
        const breakdown =
          Object.entries(bySeverity)
            .map(([k, v]) => `${v} ${k.toLowerCase()}`)
            .join(", ") || "none";
        console.log(
          chalk.green(
            `  ✓ Slither findings: ${staticResult.slither.findings.length} (${breakdown})`
          )
        );
        if (verbose) {
          for (const f of staticResult.slither.findings.slice(0, 10)) {
            console.log(
              chalk.gray(`    [${f.severity}] ${f.detector}: ${f.description.split("\n")[0].slice(0, 120)}`)
            );
          }
        }
      }

      // ═══ PHASE 3: Structural Analysis ═══
      console.log(chalk.yellow("\n▶ Phase 3: Analyzing contract structure..."));
      const inventory = await analyzeStructure(
        sourceResult.source,
        sourceResult.name
      );
      console.log(chalk.green(`  ✓ Type: ${inventory.type}`));
      console.log(
        chalk.green(`  ✓ Functions: ${inventory.functions.length} found`)
      );
      console.log(
        chalk.green(
          `  ✓ Owner controls: ${inventory.ownerControls.length} privileged functions`
        )
      );
      console.log(
        chalk.green(
          `  ✓ Upgradeable: ${inventory.isUpgradeable ? "YES" : "No"}`
        )
      );
      if (verbose) {
        console.log(
          chalk.gray(
            `    Proxy: ${inventory.proxyPattern || "none"}`
          )
        );
        console.log(
          chalk.gray(
            `    External calls: ${inventory.externalCalls.length}`
          )
        );
      }

      // ═══ PHASE 4: Adversarial Audit ═══
      console.log(
        chalk.yellow("\n▶ Phase 4: Running adversarial audit (3 AI passes)...")
      );
      console.log(chalk.gray("    Pass 1: Attacker analysis..."));
      console.log(chalk.gray("    Pass 2: Defender analysis..."));
      console.log(chalk.gray("    Pass 3: Final verdict..."));
      const auditResult = await adversarialAudit(
        sourceResult.source,
        inventory,
        sourceResult.isDecompiled,
        staticResult.slither.findings
      );
      console.log(
        chalk.green(
          `  ✓ Exploits found: ${auditResult.exploits.length}`
        )
      );
      console.log(
        chalk.green(
          `  ✓ Risk score: ${auditResult.riskScore}/100`
        )
      );
      console.log(
        chalk.green(
          `  ✓ Verdict: ${colorVerdict(auditResult.verdict)}`
        )
      );

      if (verbose && auditResult.exploits.length > 0) {
        console.log(chalk.gray("    ─── Exploit details ───"));
        for (const e of auditResult.exploits) {
          console.log(
            chalk.gray(
              `    [${e.id}] ${e.severity} — ${e.description}`
            )
          );
        }
        console.log(chalk.gray(`    Summary: ${auditResult.summary}`));
      }

      // ═══ PHASE 5: Exploit Testing ═══
      console.log(
        chalk.yellow("\n▶ Phase 5: Testing exploits in Foundry sandbox...")
      );
      const critHighCount = auditResult.exploits.filter(
        (e) => e.severity === "CRITICAL" || e.severity === "HIGH"
      ).length;
      console.log(
        chalk.gray(
          `    Testing ${critHighCount} CRITICAL/HIGH exploits...`
        )
      );

      let testResults = await testExploits(
        address,
        auditResult.exploits,
        sourceResult.source
      );
      const confirmedCount = testResults.filter((t) => t.passed).length;
      const theoreticalCount = testResults.filter(
        (t) => t.compiled && !t.passed
      ).length;
      console.log(
        chalk.green(
          `  ✓ Confirmed: ${confirmedCount}, Theoretical: ${theoreticalCount}`
        )
      );

      // ═══ PHASE 6: Publication ═══
      let ipfsCid = "N/A";
      let txHash = "N/A";

      if (!skipPublish) {
        console.log(
          chalk.yellow("\n▶ Phase 6: Publishing audit results...")
        );
        try {
          const publishResult = await publishAudit(
            address,
            sourceResult.name,
            auditResult,
            testResults,
            chain,
            inventory.type
          );
          ipfsCid = publishResult.ipfsCid;
          txHash = publishResult.txHash;
          console.log(chalk.green(`  ✓ IPFS CID: ${ipfsCid}`));
          console.log(chalk.green(`  ✓ TX Hash: ${txHash}`));
          if (publishResult.badge) {
            const b = publishResult.badge;
            const artLabel =
              b.imageMethod === "custom-file"
                ? "Custom file (BADGE_CUSTOM_IMAGE_PATH)"
                : b.imageMethod === "ai-dalle3"
                  ? "AI (DALL·E 3)"
                  : b.imageMethod === "svg-level2"
                    ? "SVG fallback"
                    : "unknown";
            console.log(chalk.green(`  ✓ Badge minted: token #${b.tokenId}`));
            console.log(chalk.green(`    • Art:       ${artLabel}`));
            console.log(chalk.green(`    • Recipient: ${b.recipient}`));
            console.log(chalk.green(`    • Mint tx:   ${b.mintTxHash}`));
            console.log(chalk.green(`    • tokenURI:  ${b.tokenURI}`));
            if (b.openseaUrl) {
              console.log(chalk.green(`    • View:      ${b.openseaUrl}`));
            }
          }
        } catch (err) {
          console.log(
            chalk.red(
              `  ✗ Publication failed: ${err instanceof Error ? err.message : err}`
            )
          );
        }
      } else {
        console.log(
          chalk.gray("\n▶ Phase 6: Skipped (--skip-publish)")
        );
      }

      // ═══ FINAL REPORT ═══
      printFinalReport(
        address,
        sourceResult.name,
        auditResult.verdict,
        auditResult.riskScore,
        confirmedCount,
        theoreticalCount,
        ipfsCid,
        txHash
      );
    } catch (err) {
      console.error(
        chalk.red(
          `\n✗ Audit failed: ${err instanceof Error ? err.message : err}`
        )
      );
      if (verbose && err instanceof Error) {
        console.error(chalk.gray(err.stack));
      }
      process.exit(1);
    }
  });

function colorVerdict(verdict: string): string {
  switch (verdict) {
    case "SAFE":
      return chalk.green.bold("SAFE ✅");
    case "CAUTION":
      return chalk.yellow.bold("CAUTION ⚠️");
    case "CRITICAL":
      return chalk.red.bold("CRITICAL ❌");
    default:
      return verdict;
  }
}

function printFinalReport(
  address: string,
  name: string,
  verdict: string,
  riskScore: number,
  confirmed: number,
  theoretical: number,
  ipfsCid: string,
  txHash: string
): void {
  const shortAddr = `${address.slice(0, 6)}...${address.slice(-4)}`;
  const shortCid =
    ipfsCid.length > 20 ? `ipfs://${ipfsCid.slice(0, 12)}...` : ipfsCid;
  const shortTx =
    txHash.length > 20 ? `${txHash.slice(0, 10)}...` : txHash;

  const verdictIcon =
    verdict === "SAFE" ? "✅" : verdict === "CAUTION" ? "⚠️" : "❌";

  console.log(chalk.bold.cyan(`
╔══════════════════════════════════════════════╗
║           ContractLens Audit Report          ║
╠══════════════════════════════════════════════╣
║ Contract:    ${shortAddr.padEnd(31)}║
║ Name:        ${name.padEnd(31).slice(0, 31)}║
║ Verdict:     ${(verdict + " " + verdictIcon).padEnd(31).slice(0, 31)}║
║ Risk Score:  ${(riskScore + "/100").padEnd(31)}║
║ Exploits:    ${(confirmed + " confirmed, " + theoretical + " theoretical").padEnd(31).slice(0, 31)}║
║ IPFS:        ${shortCid.padEnd(31).slice(0, 31)}║
║ TX:          ${shortTx.padEnd(31).slice(0, 31)}║
╚══════════════════════════════════════════════╝
`));
}

program.parse();

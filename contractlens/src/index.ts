#!/usr/bin/env node

import "dotenv/config";
import { Command } from "commander";
import chalk from "chalk";
import { fetchSource } from "./pipeline/fetchSource.js";
import { analyzeStructure } from "./pipeline/structuralAnalysis.js";
import { adversarialAudit } from "./pipeline/adversarialAudit.js";
import { testExploits } from "./pipeline/exploitTesting.js";
import { publishAudit } from "./pipeline/publish.js";

const program = new Command();

program
  .name("contractlens")
  .description("AI-powered smart contract security auditor")
  .version("1.0.0");

program
  .command("audit")
  .description("Run a full security audit on a smart contract")
  .argument("<address>", "Contract address to audit")
  .option("--chain <chain>", "Chain to audit on", "ethereum")
  .option("--skip-publish", "Skip IPFS upload and on-chain publication")
  .option("--verbose", "Enable verbose output")
  .action(async (address: string, options) => {
    const { verbose, skipPublish } = options;

    console.log(
      chalk.bold.cyan("\n  ContractLens — AI Smart Contract Auditor\n")
    );
    console.log(chalk.gray(`  Target: ${address}`));
    console.log(chalk.gray(`  Chain:  ${options.chain}\n`));

    try {
      // ═══ PHASE 1: Source Retrieval ═══
      console.log(chalk.yellow("▶ Phase 1: Fetching contract source..."));
      const sourceResult = await fetchSource(address);
      console.log(
        chalk.green(
          `  ✓ Source retrieved: ${sourceResult.name}${sourceResult.isDecompiled ? " (decompiled)" : " (verified)"}`
        )
      );
      if (verbose) {
        console.log(
          chalk.gray(
            `    Source length: ${sourceResult.source.length} characters`
          )
        );
      }

      // ═══ PHASE 2: Structural Analysis ═══
      console.log(chalk.yellow("\n▶ Phase 2: Analyzing contract structure..."));
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

      // ═══ PHASE 3: Adversarial Audit ═══
      console.log(
        chalk.yellow("\n▶ Phase 3: Running adversarial audit (3 AI passes)...")
      );
      console.log(chalk.gray("    Pass 1: Attacker analysis..."));
      console.log(chalk.gray("    Pass 2: Defender analysis..."));
      console.log(chalk.gray("    Pass 3: Final verdict..."));
      const auditResult = await adversarialAudit(
        sourceResult.source,
        inventory
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

      // ═══ PHASE 4: Exploit Testing ═══
      console.log(
        chalk.yellow("\n▶ Phase 4: Testing exploits in Foundry sandbox...")
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

      // ═══ PHASE 5: Publication ═══
      let ipfsCid = "N/A";
      let txHash = "N/A";

      if (!skipPublish) {
        console.log(
          chalk.yellow("\n▶ Phase 5: Publishing audit results...")
        );
        try {
          const publishResult = await publishAudit(
            address,
            sourceResult.name,
            auditResult,
            testResults
          );
          ipfsCid = publishResult.ipfsCid;
          txHash = publishResult.txHash;
          console.log(chalk.green(`  ✓ IPFS CID: ${ipfsCid}`));
          console.log(chalk.green(`  ✓ TX Hash: ${txHash}`));
        } catch (err) {
          console.log(
            chalk.red(
              `  ✗ Publication failed: ${err instanceof Error ? err.message : err}`
            )
          );
        }
      } else {
        console.log(
          chalk.gray("\n▶ Phase 5: Skipped (--skip-publish)")
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

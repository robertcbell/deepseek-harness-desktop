#!/usr/bin/env bun
/**
 * DSH Universal AI Gateway & Credit Hunter CLI
 * Usage:
 *   dsh-router list [--healthy]
 *   dsh-router add <url> <apiKey> [--name <name>]
 *   dsh-router probe <gatewayId>
 *   dsh-router sync
 *   dsh-router remove <gatewayId>
 */
import path from "path";
import fs from "fs";

// Import built plugin bundle or source
const PLUGIN_DIR = path.join(process.env.HOME || "", ".dsh/plugins/dsh-router-hunter");
const { GatewayProber, GatewayRegistry, DshSync } = await import(path.join(PLUGIN_DIR, "dist/index.js"));

const args = process.argv.slice(2);
const command = args[0] || "list";

function formatUsd(amount) {
  if (amount === undefined || amount === null) return "N/A";
  if (amount > 100000) return "∞ (Unlimited/Uncapped)";
  return `$${Number(amount).toFixed(2)}`;
}

async function main() {
  switch (command) {
    case "list":
    case "ls": {
      const healthyOnly = args.includes("--healthy");
      const list = GatewayRegistry.load();
      const filtered = healthyOnly ? list.filter(g => g.status === "ONLINE") : list;

      console.log(`\n📡 Registered AI Gateways (${filtered.length}/${list.length}):\n`);
      if (filtered.length === 0) {
        console.log("  No gateways registered yet. Use: dsh-router add <url> <apiKey>");
        return;
      }

      for (const gw of filtered) {
        const healthyModels = gw.models.filter(m => m.status === "HEALTHY");
        const silentFailures = gw.models.filter(m => m.status === "SILENT_FAILURE_LONG_CONTEXT");
        const statusEmoji = gw.status === "ONLINE" ? "🟢" : "🔴";

        console.log(`${statusEmoji} \x1b[1m${gw.name}\x1b[0m (${gw.id})`);
        console.log(`   URL:      ${gw.baseUrl}`);
        console.log(`   Engine:   ${gw.engine} | Status: ${gw.status}`);
        console.log(`   Credits:  Balance: ${formatUsd(gw.credits?.remainingUsd)} (Used: ${formatUsd(gw.credits?.totalUsedUsd)}, Limit: ${formatUsd(gw.credits?.quotaUsd)})`);
        console.log(`   Models:   ${healthyModels.length} Healthy | ${silentFailures.length} Silent Failure (>400w) | ${gw.models.length} Total`);
        
        if (healthyModels.length > 0) {
          const sample = healthyModels.slice(0, 8).map(m => m.id).join(", ");
          console.log(`   Working:  \x1b[32m${sample}${healthyModels.length > 8 ? ` ... (+${healthyModels.length - 8} more)` : ""}\x1b[0m`);
        }
        if (silentFailures.length > 0) {
          const sampleSf = silentFailures.slice(0, 5).map(m => m.id).join(", ");
          console.log(`   ⚠️ Flaky:  \x1b[33m${sampleSf}\x1b[0m (Drops long-context >400 words)`);
        }
        console.log("");
      }
      break;
    }

    case "add": {
      const url = args[1];
      const apiKey = args[2];
      if (!url || !apiKey) {
        console.error("❌ Usage: dsh-router add <url> <apiKey> [--name <name>]");
        process.exit(1);
      }

      let name = undefined;
      const nameIdx = args.indexOf("--name");
      if (nameIdx !== -1 && args[nameIdx + 1]) {
        name = args[nameIdx + 1];
      }

      const testLong = !args.includes("--no-test-long");

      console.log(`🔍 Probing & benchmarking AI Gateway: ${url} ...`);
      const probeRes = await GatewayProber.probeGateway(url, apiKey, { testLongContext: testLong });

      const gateway = {
        id: probeRes.gatewayId,
        name: name || probeRes.statusInfo?.data?.system_name || probeRes.gatewayId,
        baseUrl: probeRes.baseUrl,
        apiKey,
        engine: probeRes.engine,
        status: probeRes.online ? "ONLINE" : "WAF_PROTECTED",
        credits: probeRes.credits,
        models: probeRes.models,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      GatewayRegistry.upsert(gateway);
      const syncRes = DshSync.syncGatewaysToDsh(GatewayRegistry.load());

      console.log(`\n✅ Gateway "${gateway.name}" registered successfully!`);
      console.log(`   Engine:     ${gateway.engine}`);
      console.log(`   Status:     ${gateway.status}`);
      console.log(`   Credits:    ${formatUsd(gateway.credits?.remainingUsd)}`);
      console.log(`   Models:     ${gateway.models.length} discovered`);
      console.log(`   Healthy:    ${gateway.models.filter(m => m.status === "HEALTHY").length} verified working`);
      console.log(`   DSH Synced: ${syncRes.updatedProviders.length} providers updated in settings.yaml`);
      console.log(`\n⚠️  Notice: Avoid passing confidential secrets or proprietary production code to public third-party proxies.\n`);
      break;
    }

    case "probe": {
      const gatewayId = args[1];
      if (!gatewayId) {
        console.error("❌ Usage: dsh-router probe <gatewayId>");
        process.exit(1);
      }

      const gw = GatewayRegistry.get(gatewayId);
      if (!gw) {
        console.error(`❌ Gateway "${gatewayId}" not found in ~/.dsh/gateways.json`);
        process.exit(1);
      }

      console.log(`🔍 Re-probing gateway: ${gw.name} (${gw.baseUrl}) ...`);
      const probeRes = await GatewayProber.probeGateway(gw.baseUrl, gw.apiKey, { testLongContext: true });

      gw.status = probeRes.online ? "ONLINE" : "WAF_PROTECTED";
      gw.credits = probeRes.credits;
      gw.models = probeRes.models;
      gw.updatedAt = new Date().toISOString();

      GatewayRegistry.upsert(gw);
      DshSync.syncGatewaysToDsh(GatewayRegistry.load());

      console.log(`\n✅ Probe completed! Status: ${gw.status}, Remaining Credits: ${formatUsd(gw.credits?.remainingUsd)}`);
      break;
    }

    case "sync": {
      console.log("🔄 Syncing registered gateways with DSH configuration...");
      const gateways = GatewayRegistry.load();
      const res = DshSync.syncGatewaysToDsh(gateways);
      console.log(`✅ Synced ${gateways.length} gateways. Updated providers:`, res.updatedProviders);
      break;
    }

    case "remove":
    case "rm": {
      const gatewayId = args[1];
      if (!gatewayId) {
        console.error("❌ Usage: dsh-router remove <gatewayId>");
        process.exit(1);
      }

      const remaining = GatewayRegistry.remove(gatewayId);
      const res = DshSync.syncGatewaysToDsh(remaining);
      console.log(`🗑️ Removed "${gatewayId}". Remaining: ${remaining.length} gateways. Synced DSH providers:`, res.updatedProviders);
      break;
    }

    default:
      console.log(`
DSH Universal AI Gateway & Credit Hunter

Commands:
  dsh-router list [--healthy]          List all registered gateways and credit balances
  dsh-router add <url> <apiKey>        Probe, benchmark, and register an AI Gateway
  dsh-router probe <gatewayId>         Re-run latency & anti-silent-failure benchmarks
  dsh-router sync                      Re-sync gateways.json to DSH settings.yaml & credentials
  dsh-router remove <gatewayId>        Remove a gateway from registry and DSH configuration
`);
      break;
  }
}

main().catch(err => {
  console.error("❌ Fatal error:", err);
  process.exit(1);
});

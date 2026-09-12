import fs from "fs";
import path from "path";
import type { RouterGateway } from "./types.js";

const DSH_HOME = process.env.DSH_HOME || path.join(process.env.HOME || "", ".dsh");
const REGISTRY_FILE = path.join(DSH_HOME, "gateways.json");

export class GatewayRegistry {
  static getRegistryPath(): string {
    return REGISTRY_FILE;
  }

  static load(): RouterGateway[] {
    try {
      if (fs.existsSync(REGISTRY_FILE)) {
        const raw = fs.readFileSync(REGISTRY_FILE, "utf8");
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed?.gateways) ? parsed.gateways : [];
      }
    } catch (e) {
      console.warn("[dsh-router-hunter] Failed to load gateways.json:", e);
    }
    return [];
  }

  static save(gateways: RouterGateway[]): void {
    try {
      fs.mkdirSync(path.dirname(REGISTRY_FILE), { recursive: true });
      fs.writeFileSync(REGISTRY_FILE, JSON.stringify({ version: 1, gateways, updatedAt: new Date().toISOString() }, null, 2), "utf8");
    } catch (e) {
      console.error("[dsh-router-hunter] Failed to write gateways.json:", e);
    }
  }

  static upsert(gateway: RouterGateway): RouterGateway[] {
    const list = this.load();
    const idx = list.findIndex(g => g.id === gateway.id || (g.baseUrl === gateway.baseUrl && g.apiKey === gateway.apiKey));
    if (idx >= 0) {
      list[idx] = { ...list[idx], ...gateway, updatedAt: new Date().toISOString() };
    } else {
      list.push(gateway);
    }
    this.save(list);
    return list;
  }

  static remove(idOrUrl: string): RouterGateway[] {
    const list = this.load();
    const filtered = list.filter(g => g.id !== idOrUrl);
    this.save(filtered);
    return filtered;
  }

  static get(idOrUrl: string): RouterGateway | undefined {
    return this.load().find(g => g.id === idOrUrl || g.baseUrl === idOrUrl);
  }
}

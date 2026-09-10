import crypto from "node:crypto";

export type LedgerType = "CREDIT" | "DEBIT" | "REFUND" | "BONUS" | "ADJUSTMENT";

export type LedgerEntry = {
  id: string;
  type: LedgerType;
  units: number;
  description: string;
  createdAt: string;
};

type WalletState = {
  balance: number;
  entries: LedgerEntry[];
};

const wallets = new Map<string, WalletState>();

function stateFor(userId: string): WalletState {
  const existing = wallets.get(userId);
  if (existing) return existing;
  const state: WalletState = {
    balance: 1000,
    entries: [
      {
        id: crypto.randomUUID(),
        type: "BONUS",
        units: 1000,
        description: "Free plan welcome allocation",
        createdAt: new Date().toISOString(),
      },
    ],
  };
  wallets.set(userId, state);
  return state;
}

export function getWalletState(userId: string): WalletState {
  return stateFor(userId);
}

export function chargeWallet(userId: string, units: number, description: string): LedgerEntry {
  const state = stateFor(userId);
  if (units > state.balance) throw new Error("INSUFFICIENT_UNITS");
  state.balance -= units;
  const entry: LedgerEntry = {
    id: crypto.randomUUID(),
    type: "DEBIT",
    units: -units,
    description,
    createdAt: new Date().toISOString(),
  };
  state.entries.unshift(entry);
  return entry;
}

export function refundWallet(userId: string, units: number, description: string): LedgerEntry {
  const state = stateFor(userId);
  state.balance += units;
  const entry: LedgerEntry = {
    id: crypto.randomUUID(),
    type: "REFUND",
    units,
    description,
    createdAt: new Date().toISOString(),
  };
  state.entries.unshift(entry);
  return entry;
}

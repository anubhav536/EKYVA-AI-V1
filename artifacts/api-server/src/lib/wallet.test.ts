import assert from "node:assert/strict";
import test from "node:test";
import { chargeWallet, getWalletState, refundWallet } from "./wallet";

test("wallet balance is derived from immutable ledger events", () => {
  const userId = `wallet-test-${crypto.randomUUID()}`;
  const initial = getWalletState(userId);
  assert.equal(initial.balance, 1000);
  const debit = chargeWallet(userId, 25, "test generation");
  assert.equal(debit.type, "DEBIT");
  assert.equal(getWalletState(userId).balance, 975);
  const refund = refundWallet(userId, 10, "test refund");
  assert.equal(refund.type, "REFUND");
  assert.equal(getWalletState(userId).balance, 985);
  assert.equal(getWalletState(userId).entries.length, 3);
});

test("wallet rejects charges larger than available balance", () => {
  const userId = `wallet-test-${crypto.randomUUID()}`;
  assert.throws(() => chargeWallet(userId, 1001, "too expensive"), /INSUFFICIENT_UNITS/);
});

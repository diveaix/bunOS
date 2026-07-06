export function prepareCircleTransfer({ sender, recipient, amount, asset, settlementRail = "arc-testnet" }) {
  const senderWallet = walletForRail(sender, settlementRail);
  const recipientWallet = walletForRail(recipient, settlementRail);

  return {
    provider: "circle-wallets",
    from: senderWallet?.address || sender.walletAddress,
    to: recipientWallet?.address || recipient.walletAddress,
    fromWalletId: senderWallet?.id || null,
    toWalletId: recipientWallet?.id || null,
    amount,
    asset,
    settlementRail,
    signingMode: "policy-gated"
  };
}

export function prepareCircleEscrow({ sender, recipient, amount, asset, paymentId, settlementRail = "arc-testnet" }) {
  const senderWallet = walletForRail(sender, settlementRail);

  return {
    provider: "circle-wallets",
    from: senderWallet?.address || sender.walletAddress,
    fromWalletId: senderWallet?.id || null,
    escrowAccount: `escrow:${paymentId}`,
    claimantXUserId: recipient.xUserId,
    amount,
    asset,
    settlementRail,
    signingMode: "policy-gated"
  };
}

function walletForRail(user, settlementRail) {
  return user.chainWallets?.find((wallet) => wallet.rail === settlementRail);
}

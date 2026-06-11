export function settleUp(balances) {
  const creditors = balances.filter(item => item.amount > .009).map(item => ({ ...item })).sort((a, b) => b.amount - a.amount)
  const debtors = balances.filter(item => item.amount < -.009).map(item => ({ ...item, amount:-item.amount })).sort((a, b) => b.amount - a.amount)
  const transfers = []
  let creditorIndex = 0
  let debtorIndex = 0
  while (creditorIndex < creditors.length && debtorIndex < debtors.length) {
    const creditor = creditors[creditorIndex]
    const debtor = debtors[debtorIndex]
    const amount = Math.min(creditor.amount, debtor.amount)
    transfers.push({ from:debtor.id, to:creditor.id, amount })
    creditor.amount -= amount
    debtor.amount -= amount
    if (creditor.amount < .01) creditorIndex++
    if (debtor.amount < .01) debtorIndex++
  }
  return transfers
}

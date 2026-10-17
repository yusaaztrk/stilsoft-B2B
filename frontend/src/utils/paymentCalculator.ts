export interface PaymentCalculationInput {
  debtAmount: number
  debtCurrencyTypeId: number // 1: TRY, 2: EUR, 3: USD, 4: GBP
  receivedAmount: number
  paymentCurrencyTypeId: number
  exchangeRate: number // 1 PaymentCurrency = X TRY
  changeCurrencyTypeId: number
  changeExchangeRate: number // 1 ChangeCurrency = X TRY
  /**
   * Borcun KENDİ kuru (1 DebtCurrency = X TRY). Verilmezse ödeme kuruna düşülür — borç ile
   * ödeme aynı paradayken ikisi zaten eşit olduğu için eski davranış birebir korunur.
   * Çapraz dövizde (100 EUR borç, USD ödeme) tek kur kullanmak borcu yanlış kapatıyordu:
   * 3.800 ₺ tahsilat USD kuruna bölünüp "100 EUR ödendi" sayılıyor, doğrusu 95 EUR.
   * Backend karşılığı: PaymentCalculationRequest.DebtExchangeRate.
   */
  debtExchangeRate?: number
}

export interface PaymentCalculationOutput {
  debtAmount: number
  debtCurrencyTypeId: number
  receivedAmount: number
  paymentCurrencyTypeId: number
  exchangeRate: number

  receivedAmountInDebtCurrency: number
  receivedAmountInTry: number

  appliedToDebtAmount: number
  appliedToDebtAmountInTry: number

  overpaymentAmountInDebtCurrency: number
  overpaymentAmountInTry: number

  changeAmount: number
  changeCurrencyTypeId: number
  changeExchangeRate: number
  changeAmountInTry: number

  isFullPayment: boolean
  remainingDebtAmount: number
}

function round2(val: number): number {
  return Math.round((val + Number.EPSILON) * 100) / 100
}

function normalizeCurrencyTypeId(typeId: number): number {
  return typeId <= 0 ? 1 : typeId
}

export function calculatePaymentSummary(input: PaymentCalculationInput): PaymentCalculationOutput {
  const debtCurr = normalizeCurrencyTypeId(input.debtCurrencyTypeId)
  const payCurr = normalizeCurrencyTypeId(input.paymentCurrencyTypeId)
  const changeCurr = normalizeCurrencyTypeId(input.changeCurrencyTypeId)

  const debtAmount = Math.max(0, input.debtAmount)
  const receivedAmount = Math.max(0, input.receivedAmount)
  const rate = input.exchangeRate > 0 ? input.exchangeRate : 1
  const changeRate = input.changeExchangeRate > 0 ? input.changeExchangeRate : 1
  // Borcun kendi kuru; verilmezse ödeme kuru (eski davranış).
  const debtRate = (input.debtExchangeRate ?? 0) > 0 ? (input.debtExchangeRate as number) : rate

  // 1. Received Amount in TRY
  let receivedAmountInTry = 0
  if (payCurr === 1) {
    receivedAmountInTry = round2(receivedAmount)
  } else {
    receivedAmountInTry = round2(receivedAmount * rate)
  }

  // 2. Debt Amount in TRY
  let debtAmountInTry = 0
  if (debtCurr === 1) {
    debtAmountInTry = round2(debtAmount)
  } else {
    debtAmountInTry = round2(debtAmount * debtRate)
  }

  // 3. Received Amount in Debt Currency
  let receivedInDebtCurr = 0
  if (debtCurr === payCurr) {
    receivedInDebtCurr = round2(receivedAmount)
  } else if (debtCurr === 1 && payCurr !== 1) {
    receivedInDebtCurr = receivedAmountInTry
  } else if (debtCurr !== 1 && payCurr === 1) {
    receivedInDebtCurr = debtRate > 0 ? round2(receivedAmount / debtRate) : receivedAmount
  } else {
    receivedInDebtCurr = debtRate > 0 ? round2(receivedAmountInTry / debtRate) : receivedAmount
  }

  // 4. Applied to Debt Amount (Capped to Debt Amount)
  const appliedToDebtAmount = Math.min(debtAmount, receivedInDebtCurr)
  let appliedToDebtAmountInTry = 0
  if (debtCurr === 1) {
    appliedToDebtAmountInTry = round2(appliedToDebtAmount)
  } else {
    appliedToDebtAmountInTry = round2(appliedToDebtAmount * debtRate)
  }

  // 5. Overpayment Amount
  const overpaymentInDebtCurr = Math.max(0, receivedInDebtCurr - debtAmount)
  const overpaymentInTry = Math.max(0, receivedAmountInTry - appliedToDebtAmountInTry)

  // 6. Change Amount (Para Üstü) in Change Currency
  const changeAmountInTry = round2(overpaymentInTry)
  let changeAmount = 0

  if (changeCurr === 1) {
    changeAmount = changeAmountInTry
  } else if (changeCurr === payCurr && payCurr !== 1) {
    changeAmount = rate > 0 ? round2(changeAmountInTry / rate) : 0
  } else {
    changeAmount = changeRate > 0 ? round2(changeAmountInTry / changeRate) : 0
  }

  // 7. Remaining Debt
  const remainingDebt = Math.max(0, debtAmount - appliedToDebtAmount)
  const isFullPayment = remainingDebt <= 0.001

  return {
    debtAmount: round2(debtAmount),
    debtCurrencyTypeId: debtCurr,
    receivedAmount: round2(receivedAmount),
    paymentCurrencyTypeId: payCurr,
    exchangeRate: rate,
    receivedAmountInDebtCurrency: round2(receivedInDebtCurr),
    receivedAmountInTry: round2(receivedAmountInTry),
    appliedToDebtAmount: round2(appliedToDebtAmount),
    appliedToDebtAmountInTry: round2(appliedToDebtAmountInTry),
    overpaymentAmountInDebtCurrency: round2(overpaymentInDebtCurr),
    overpaymentAmountInTry: round2(overpaymentInTry),
    changeAmount: round2(changeAmount),
    changeCurrencyTypeId: changeCurr,
    changeExchangeRate: changeRate,
    changeAmountInTry: round2(changeAmountInTry),
    isFullPayment,
    remainingDebtAmount: round2(remainingDebt)
  }
}

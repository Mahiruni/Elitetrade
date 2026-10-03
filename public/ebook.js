export function ebookCover() {
  return `<div class="ebook-cover" role="img" aria-label="EliteBot Strategy Rulebook ebook cover"><span class="ebook-cover-brand">EliteBot <span>FIELD GUIDE / 01</span></span><div class="ebook-cover-title">Strategy<br><em>Rulebook.</em></div><div class="ebook-cover-lines" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></div><div class="ebook-cover-bottom"><span>TREND · SCALPING · BREAKOUT</span><small>Current presets &amp; proposed refinements</small><b>8 PAGES / PDF EDITION</b></div></div>`;
}

export function ebookOffer() {
  return `<section id="ebook" class="marketing-section ebook-section" aria-labelledby="ebook-heading"><div class="ebook-art">${ebookCover()}<span class="ebook-edition">THE ELITEBOT READING ROOM</span></div><div class="ebook-copy"><div class="marketing-kicker"><span></span> The strategy, written down</div><h2 id="ebook-heading">Know the rules.<br><em>Understand the trade.</em></h2><p>Go inside EliteBot’s Trend, Scalping, and Breakout strategies. A practical rulebook covering signals, entries, exits, position sizing, and a structured plan for testing refinements.</p><ul class="ebook-includes"><li>Three strategy playbooks, explained in detail</li><li>Shared risk controls and trading examples</li><li>Current code rules clearly separated from proposed changes</li></ul><div class="ebook-buy-row"><div class="ebook-price">$50 <span>USD · one-time purchase</span></div><a href="/ebook" class="marketing-cta">Buy the ebook <span aria-hidden="true">↗</span></a></div><a class="ebook-preview-link" href="/ebooks/elitebot-strategy-preview.pdf" target="_blank" rel="noopener">Read the free preview <span aria-hidden="true">↗</span></a><p class="ebook-fine">8-page PDF. Download after payment approval. Educational content; proposed refinements have not been backtested.</p></div></section>`;
}

export async function ebookPage({ state, api, esc, money, date, badge, form, field, btn }) {
  let checkout = `<div class="ebook-checkout-intro"><span class="card-label">YOUR COPY</span><h2>One rulebook. Three strategies.</h2><div class="ebook-checkout-price">$50 <small>USD</small></div><p>One-time payment for the complete 8-page PDF. Sign in to purchase and keep your download attached to your account.</p><div class="actions"><a class="marketing-cta" href="/login?next=/ebook">Sign in to buy</a><a class="marketing-secondary" href="/signup?next=/ebook">Create an account</a></div></div>`;
  if (state.user) {
    const data = await api('/ebook');
    state.data.ebook = data;
    const approved = data.orders.find(order => order.status === 'approved');
    const pending = data.orders.find(order => order.status === 'pending');
    const last = data.orders[0];
    if (approved) {
      checkout = `<span class="card-label">YOUR EBOOK IS READY</span><h2>You’re ready to read.</h2><p>Your ${money(approved.amount_cents)} purchase was approved. Download the complete PDF and return here whenever you need another copy.</p>${btn('Download the full PDF', 'ebook-download', '', 'class="primary ebook-download"')}<p class="meta">Approved purchase · ${date(approved.created_at)}</p>`;
    } else if (pending) {
      checkout = `<span class="card-label">PAYMENT SUBMITTED</span><h2>Your copy is awaiting approval.</h2><p>The administrator will verify your ${money(pending.amount_cents)} payment. Once approved, the full PDF download appears here.</p><div class="ebook-order-reference"><small>Transaction reference</small><span>${esc(pending.reference)}</span></div><div class="actions">${badge('pending')}${btn('Check payment status', 'refresh', '', 'class="ghost"')}</div><p class="meta">Submitted ${date(pending.created_at)}. Please wait for review before sending another payment.</p>`;
    } else {
      const methodCards = data.methods.map((method, index) => `<label class="ebook-method"><span class="ebook-method-head"><input type="radio" name="methodId" value="${esc(method.id)}" ${index === 0 ? 'checked' : ''} required><strong>${esc(method.name)}</strong></span><span class="ebook-method-amount">${method.kind === 'crypto' ? 'Send exactly 50 USDT · TRC20 network' : 'Pay $50 USD'}</span><span class="ebook-method-address">${esc(method.details)}</span>${method.instructions ? `<span class="meta">${esc(method.instructions)}</span>` : ''}</label>`).join('');
      checkout = `<span class="card-label">COMPLETE YOUR PURCHASE</span><h2>Get the full rulebook.</h2><div class="ebook-checkout-price">${money(data.product.priceCents)} <small>one time</small></div><p>Pay using a method below, then submit the transaction reference. The administrator verifies receipt before unlocking your PDF.</p>${last?.status === 'rejected' ? `<div class="notice" role="status"><strong>Previous payment rejected.</strong> ${esc(last.note || 'Contact support if you believe your payment should have been approved.')}</div>` : ''}${data.methods.length ? form('ebook-payment', `<fieldset class="ebook-payment-methods"><legend>Payment destination</legend>${methodCards}</fieldset>` + field('Transaction hash or payment reference', 'reference', '', 'text', 'required minlength="6" maxlength="200" autocomplete="off" placeholder="Paste the reference from your completed payment"') + '<p class="meta">Ebook payments are reviewed manually. Do not use a subscription invoice for this purchase. Your PDF will be available here after approval.</p>', 'Submit $50 payment for review') : '<div class="notice">Ebook payments are currently unavailable. Contact support before sending funds.</div>'}`;
    }
  }
  return `<section class="ebook-page-hero"><div class="ebook-page-details"><div class="marketing-kicker"><span></span> EliteBot / Digital edition</div><h1>EliteBot Strategy<br><em>Rulebook.</em></h1><p class="ebook-page-lede">The logic behind the bot, in a guide you can keep.</p><div class="ebook-page-art">${ebookCover()}</div><div class="ebook-content-list"><h2>Inside the 8-page guide</h2><div><b>01</b><span><strong>Trend, Scalping &amp; Breakout</strong><small>Timeframes, indicators, closed-candle signals, and entry conditions.</small></span></div><div><b>02</b><span><strong>Exits &amp; risk controls</strong><small>Stops, targets, position sizing, daily loss limits, and drawdown.</small></span></div><div><b>03</b><span><strong>A refinement &amp; testing plan</strong><small>Proposed filters, examples, and validation steps before implementation.</small></span></div></div><a class="ebook-preview-link" href="/ebooks/elitebot-strategy-preview.pdf" target="_blank" rel="noopener">Open the free one-page preview <span aria-hidden="true">↗</span></a></div><aside class="ebook-checkout" aria-label="Ebook purchase">${checkout}<div class="ebook-checkout-footer"><span>8-page PDF · personal digital copy</span><p>Educational content. Current bot execution is demo-only. Proposed refinements require implementation and testing; no trading performance is guaranteed.</p><div><a href="/support">Need help?</a><a href="/refund-policy">Refund policy</a></div></div></aside></section>`;
}

export async function downloadEbook(accessToken) {
  const response = await fetch('/api/ebook/download', {
    credentials: 'same-origin',
    headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {}
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || 'The PDF could not be downloaded. Please try again.');
  }
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement('a');
  link.href = url;
  link.download = 'EliteBot_Strategy_Rulebook.pdf';
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

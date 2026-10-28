# Trace pricing: researched starting assumptions

Research checked on **October 25, 2026**. Currency below is **USD**. This is a local product-planning model. It does not establish a licensing contract, promise a payout, or demonstrate demand for Agent-Me data. The existing review-and-offer flow remains the place where an actual offer is made.

## What comparable services publish

| Primary source | Published information | What it supports |
| --- | --- | --- |
| [DataOffer agent traces](https://getdataoffer.com/traces/) and its [pricing explanation](https://getdataoffer.com/guides/how-coding-agent-trace-data-is-priced/) | Its illustrative estimator uses $0.00002 per approximate token and a 2× coding multiplier: 10,000 coding tokens imply $0.40 gross; 100,000 imply $4.00 gross, before any split. It explicitly says it has no trace rate card. | A weak reference for the scale of another estimator, **not a buyer transaction or a payout rate**. The site's footer also describes a placeholder entity. Do not present these figures as validated market prices. |
| [Sell Traces contributor terms, version 1.3.0](https://app.selltraces.com/legal/sell-traces), effective October 22, 2026 | Contributors receive 70% of attributable platform receipts for raw-material products, or 20% for substantive task products. A partner can retain part of the end-customer price before platform receipts. No minimum sale or payment is assured. | A published revenue-sharing structure. A 70% share of platform receipts is not necessarily 70% of the buyer's spend. These terms do not reveal a price per trace or prove a closed sale. |
| [WeBuyData](https://webuydata.io/) | Advertises $5–$50 per dataset and gift-card rewards, including AI-assistant histories alongside other consumer data. | A consumer contribution benchmark with an unspecified dataset unit. It cannot be converted into a per-conversation coding-trace rate. The amounts are the provider's advertising claims. |

None of these sources establishes a settled per-trace market price. Do not average unlike units or describe their published figures as measured clearing prices. The sourced facts above are separate from the Agent-Me assumptions below.

## Recommended Agent-Me draft

Start with an **experimental conditional estimate**, calculated locally over the reviewed selection. Display a range alongside the eligible/excluded counts, the rate-card version, and the statement that actual payout can be zero. Do not label this “your earnings” or “an offer.”

| Observable selected material | Draft contributor estimate per unique conversation |
| --- | --- |
| At least one human request followed by an assistant response | $0.05–$0.25 |
| The same pair, plus a selected tool result between the human request and a later assistant response | $0.25–$2.00 |
| Unpaired selection or exact normalized duplicate conversation | $0.00 in this estimate |

These ranges are **our planning assumptions**, chosen conservatively within the broad scale suggested by the illustrative competitor examples. They are not inferred statistical confidence intervals. We have no observed acceptance rate, conversion rate, buyer budgets or willingness-to-pay data; an expected cash payout cannot yet be calculated.

The estimator counts each source/conversation group once. It deduplicates matching normalized sequences of human, assistant and tool content across sources, ignoring identifiers, whitespace differences and adjacent message chunking. It does not solve semantic near-duplicate detection. A hash detects matching content; it does not prove authorship or permission to sell.

“Paired” describes the selected records, not a guarantee that the original conversation is complete. A tool record is evidence of a tool interaction, not proof that a test, fix or task succeeded. No verification premium is awarded automatically. Long pasted content, more assistant chunks, source brand and broader training permissions do not increase the per-conversation rate. This avoids incentives to submit bloated logs or surrender more rights.

The editable policy is [`mcp/rate-card.json`](../mcp/rate-card.json). All amounts are integer currency minor units. `planning_contributor_share_bps: 7000` represents a proposed 70% share for calibrating the gross receipts needed to support these estimates. It **does not add a revenue-share contract or royalty payout system** to the current product. An actual offer can have a different basis, clearly disclosed to the contributor.

## Arithmetic and operating limits

The default estimate for 100 eligible tool-evidence conversations is:

- Conditional contributor estimate: `100 × $0.25` to `100 × $2.00` = **$25–$200**.
- At a proposed 70% share, the gross attributable licensing receipts required are approximately **$35.72–$285.72** (rounded up to cents).
- Guaranteed amount: **$0**. Rejected, unlicensed or unsold material can earn nothing. The range is neither a floor nor a cap on a later negotiated offer.

Mixed worked example: 80 paired conversations plus 20 tool-evidence conversations gives `80 × $0.05 + 20 × $0.25 = $9` at the low end and `80 × $0.25 + 20 × $2.00 = $60` at the high end. If another 10 selections are duplicates or unpaired, they add zero to that estimate.

A **hypothetical direct sale** of 100 accepted tool-evidence conversations at $2 each would produce:

| Item | Assumed calculation | Amount |
| --- | --- | --- |
| Gross attributable receipts | 100 × $2 | $200 |
| Contributor allocation | 70% × $200 | $140 |
| Automated screening / processing | Assumed $0.10 × 100 | $10 |
| Human batch QA | Assumed 30 minutes × $40/hour | $20 |
| Contribution after these variable costs | $200 − $140 − $10 − $20 | **$30 (15%)** |

This is an assumption-driven unit-economics scenario, not a forecast. It excludes acquisition, storage over time, engineering, disputes, payment fees, taxes and fixed overhead. Screening must measure its actual cost; the $0.10 assumption is not a provider quote. Batch QA is not a substitute for required privacy/rights review.

At those costs, break-even gross receipts are `($10 + $20) ÷ (1 − 0.70) = $100`, or $1 per accepted conversation. If human review instead averages three minutes **per conversation**, it costs $200 per batch, and break-even rises to `($10 + $200) ÷ 0.30 = $700`, or $7 each. At the $200 sale price that batch would lose **$150** before fixed overhead. Such submissions need a higher buyer quote, lower measured processing cost, or rejection; the estimator must not conceal that loss.

For the first paid pilots, quote a bounded batch against a specific buyer need. Log offered amount, accepted amount, rights allowed, unique accepted conversation count, review minutes, actual receipts and rejection reasons. Recalibrate the versioned rate card from those measurements. Keep individually verified harness-ready tasks on a separate review path with their own economics; raw log length is not evidence of a runnable benchmark.

## Boundaries in the current product

Estimating is local and sends no content. Preparing an export does not submit it. Submission requires explicit confirmation of the reviewed selection and expected file hash. Requested uses remain the contributor's selected uses. A local estimate does not grant a broader license, accept an offer, execute payment, or replace rights review. The buyer's current offer is retrieved separately through the existing receipt flow.

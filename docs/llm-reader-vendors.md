# Language-model reader: vendor terms

> **Vendor defaults, may change, not legal advice.** Each row is what the
> vendor's own pages said on the date read. A contract can change any of it.
> Read the current terms again before any decision.

Research only. No reader is built, no vendor is chosen, and no real document
has been sent anywhere. All pages were read on **2026-10-09**.

## What each vendor says

| Vendor | Trains on API data? | How long it keeps prompts and outputs | Zero retention | Where it's processed |
|---|---|---|---|---|
| **Anthropic, Claude API** | No, unless the customer gives express permission | Deleted within 30 days. If flagged by safety systems: inputs and outputs up to 2 years, safety scores up to 7 years. Files API and batch keep data longer. | For eligible customers, by agreement. Not available for some models (Fable 5 and 5.1, Mythos 5 and 5.1 require 30-day retention). Flagged content can still be kept. | Processing either anywhere ("global") or US-only (costs 1.1×). Stored data is US-only. **No EU option.** |
| **OpenAI API** | No, unless the customer opts in | Abuse-monitoring logs up to 30 days. Uploaded files up to 30 days. | For eligible customers. Some endpoints (assistants, threads, conversations, vector stores) are never covered. | EU processing at `eu.api.openai.com`, but only with zero retention or modified abuse monitoring approved |
| **Google, Gemini on Vertex AI** | No, without the customer's permission | Inputs cached in memory for up to 24 h (can be turned off). Prompts flagged by classifiers can be logged for up to 90 days, with possible human review. Some "Advanced AI" models log everything for 30 days, and opting out may not be possible. | Possible: turn off caching and logging, and avoid Google Search grounding, which keeps logs for 3 days. | The project's chosen region, EU included |
| **AWS Bedrock** | No | Not stored by default; model providers have no access. Exceptions: flagged traffic on some OpenAI models kept up to 30 days; **all** traffic on Claude Fable 5 and 5.1 kept up to 30 days, with flagged traffic open to human review by AWS. | Default for most models | Our chosen region, or an EU-only cross-region profile. A "global" profile can route anywhere. |
| **Azure OpenAI (Microsoft Foundry)** | No, and OpenAI doesn't see the data | Flagged prompts are stored for human review by Microsoft staff, inside the EEA for EEA deployments | By application ("modified abuse monitoring"), and it can be checked in the portal | The chosen geography. An "EU Data Zone" deployment keeps processing in EU countries. A "Global" deployment can run anywhere. |
| **Mistral** | **UNCONFIRMED.** The help centre says the free tier may train on data and pay-as-you-go customers "have the right to opt out", which suggests it's on by default. The legal pages that could be opened don't say. | **UNCONFIRMED:** 30 rolling days for abuse monitoring, per a secondary source. The privacy policy page came back cut off. | On written request, which Mistral can refuse | EU by default; a US endpoint exists |

## What this means, without choosing

- **If EU processing is required,** Anthropic's own API rules itself out
  today: it has no EU option.
- **Only AWS Bedrock doesn't store prompts by default,** except for the models
  listed above. Azure's no-storage mode needs approval. OpenAI's EU option
  needs zero retention or modified abuse monitoring approved.
- **Every vendor except Mistral says no training by default.** Mistral would
  need its terms confirmed in writing before it's considered.

## Still to read before choosing

- Each vendor's data-processing agreement and list of sub-processors.
- What "flagged" means in practice, and whether a freight document could
  trigger it.
- Each vendor's SOC 2 and ISO reports.
- **The brokers' confidentiality clauses on rate confirmations.** They may
  rule out sending even redacted text, whichever vendor is picked.

## Sources (all read 2026-10-09)

- Anthropic, API and data retention: https://platform.claude.com/docs/en/manage-claude/api-and-data-retention
- Anthropic, how long organisation data is stored: https://privacy.claude.com/en/articles/7996866-how-long-do-you-store-my-organization-s-data
- Anthropic, data residency: https://platform.claude.com/docs/en/manage-claude/data-residency
- OpenAI, your data: https://developers.openai.com/api/docs/guides/your-data
- Google, Vertex AI data governance: https://docs.cloud.google.com/vertex-ai/generative-ai/docs/data-governance
- Google, abuse monitoring: https://docs.cloud.google.com/vertex-ai/generative-ai/docs/learn/abuse-monitoring
- AWS Bedrock, data protection: https://docs.aws.amazon.com/bedrock/latest/userguide/data-protection.html
- AWS Bedrock, abuse detection: https://docs.aws.amazon.com/bedrock/latest/userguide/abuse-detection.html
- AWS Bedrock, cross-region inference: https://docs.aws.amazon.com/bedrock/latest/userguide/cross-region-inference.html
- Microsoft, Foundry data privacy (page dated 2026-05-18, updated 2026-06-05): https://learn.microsoft.com/en-us/azure/ai-foundry/responsible-ai/openai/data-privacy
- Mistral, training on user data: https://help.mistral.ai/en/articles/347617-do-you-use-my-user-data-to-train-your-artificial-intelligence-models
- Mistral, additional terms: https://legal.mistral.ai/terms/additional-terms
- Mistral, privacy policy (came back cut off): https://legal.mistral.ai/terms/privacy-policy
- Open Terms Archive, Mistral retains API data for 30 days (secondary): https://opentermsarchive.org/en/memos/mistral-ai-retains-api-prompts-and-outputs-for-30-days/

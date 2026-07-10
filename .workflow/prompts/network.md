# Network Prompt - Relationship Archaeology & Cultivation

**Context:** Evening hours (19:00-22:00). This is NOT hunting - this is watering the garden.

---

## Memory Palace Entry

Step into the warm café. Amber lighting filters through hanging plants. Quiet conversations hum at neighboring tables. Steam rises from ceramic mugs. A book lies open beside your laptop. This isn't hunting—this is watering the garden. No agenda. No asks. Just presence.

The barista knows your name. You know theirs. This is cultivation, not conversion.

---

## PHASE 1: ARCHAEOLOGY - Check Relationships

### Step 1.1: Contact List Audit
```sql
-- Find all contacts with last touchpoint data
SELECT
  name,
  relationship_type,
  last_contact_date,
  days_since_contact,
  total_touchpoints,
  trust_level
FROM contacts
ORDER BY days_since_contact DESC;
```

**Look for:**
- Mentors/advisors with 30+ days no contact
- Strong relationships (trust_level >= 7) going stale
- People who opened doors for you (gratitude gaps)
- Connectors who might benefit from introductions

### Step 1.2: Touchpoint Gap Analysis
```sql
-- Find relationships with declining frequency
SELECT
  name,
  relationship_type,
  AVG(days_between_touchpoints) as avg_gap,
  last_touchpoint_type,
  CASE
    WHEN days_since_contact > 60 THEN 'URGENT'
    WHEN days_since_contact > 30 THEN 'ATTENTION'
    ELSE 'HEALTHY'
  END as status
FROM contact_history
GROUP BY contact_id
HAVING status IN ('URGENT', 'ATTENTION');
```

### Step 1.3: Gratitude Debt Check
```sql
-- Find people who helped but never got thanked
SELECT
  name,
  help_provided,
  outcome_enabled,
  days_since_help,
  gratitude_expressed
FROM relationship_ledger
WHERE gratitude_expressed = false
  AND days_since_help > 7;
```

---

## PHASE 2: EVENING CONTEXT - Cultivation Mindset

**This is NOT operator mode:**
- Operator = hunting, conversion, closing
- Network = watering, presence, trust

**Cultivation principles:**
1. **No agenda** - Don't reach out because you need something
2. **Generosity first** - Share value, make introductions, celebrate wins
3. **Long game** - Trust compounds, relationships appreciate
4. **Presence over productivity** - Quality time > quantity metrics

**Question to ask yourself:**
"If I never got anything back from this person, would I still reach out?"

If no → Wait. If yes → Proceed.

---

## PHASE 3: GENERATE PROMPTS - Action Items

Based on archaeology findings, generate prompts in these categories:

### [CHECK-IN] - Reach out to reconnect
**Format:**
```
[CHECK-IN] {name} - {days_since_contact} days
Reason: {why_now}
Prompt: "{opening_line}"
Memory: {last_conversation_detail}
```

**Example:**
```
[CHECK-IN] Sarah Chen - 45 days
Reason: Strong mentor, helped with pricing strategy in Nov
Prompt: "Been thinking about your advice on value-based pricing. It changed how we position Tesseract. How's the new startup going?"
Memory: She mentioned launching something in Q1
```

### [GRATITUDE] - Thank someone who helped
**Format:**
```
[GRATITUDE] {name} - {days_since_help} days
Help: {what_they_did}
Outcome: {what_it_enabled}
Prompt: "{specific_thank_you}"
```

**Example:**
```
[GRATITUDE] Marcus Johnson - 12 days
Help: Introduced me to Stripe PM
Outcome: Got feedback that shaped our integration roadmap
Prompt: "Marcus - that intro to Jamie at Stripe was gold. Their feedback on the API design completely shifted our approach. We're building something way better because of it. Thank you."
```

### [WATER] - Relationships needing attention
**Format:**
```
[WATER] {name} - {relationship_type}
Status: {trust_level}/10, {days_since_contact} days
Context: {why_this_matters}
Prompt: "{low_pressure_touchpoint}"
```

**Example:**
```
[WATER] Dr. Kim - Advisor
Status: 8/10 trust, 38 days no contact
Context: She opened doors at university partnerships
Prompt: "Dr. Kim - saw your lab's paper on neural plasticity. The standing wave stuff we're working on keeps echoing your research. Would love to share what we're finding."
```

### [CONNECT] - Introduce people who should know each other
**Format:**
```
[CONNECT] {person_a} ↔ {person_b}
Why: {mutual_benefit}
Prompt_A: "{intro_to_a}"
Prompt_B: "{intro_to_b}"
Double_opt_in: {yes/no}
```

**Example:**
```
[CONNECT] Lisa Torres ↔ Ahmed Patel
Why: Lisa needs dev partnerships, Ahmed's startup needs go-to-market
Prompt_A: "Lisa - you mentioned looking for technical co-founders. Ahmed built the backend for [previous success]. Sharp thinker. Want an intro?"
Prompt_B: "Ahmed - Lisa's been in SaaS sales for 10 years. Knows enterprise motion cold. Could help with your GTM. Interested in meeting?"
Double_opt_in: yes (get both to say yes first)
```

---

## PHASE 4: VALIDATION RULES - Score Outcomes

**After each network action, score it:**

### VANITY (score = 0)
- "Nice chat"
- "Good to catch up"
- "Friendly conversation"
- "Stayed in touch"
- **Why vanity:** No depth change, no outcome

### RESULT (score = 1)
- "Relationship strengthened" (specific evidence)
- "Serendipity unlocked" (unexpected opportunity surfaced)
- "Trust deepened" (vulnerability shared, support given)
- "Introduction made" (value created for both parties)
- "Problem solved" (helped them with specific challenge)
- **Why result:** Measurable change in relationship quality or tangible value created

**Log format:**
```json
{
  "contact": "Sarah Chen",
  "action": "CHECK-IN",
  "date": "2026-02-15",
  "score": 1,
  "evidence": "She shared startup struggles. I connected her with growth advisor. She said 'This is exactly what I needed.'",
  "next_touchpoint": "2026-03-01"
}
```

---

## DIFFERENTIATION: Network vs Operator

| Dimension | Network (This Prompt) | Operator (Different Prompt) |
|-----------|----------------------|----------------------------|
| **Timing** | Evening (19:00-22:00) | Business hours (09:00-17:00) |
| **Metaphor** | Watering the garden | Hunting in the forest |
| **Goal** | Cultivation | Conversion |
| **Metric** | Trust depth | Deal closure |
| **Horizon** | Years | Weeks |
| **Posture** | Generosity | Value exchange |
| **Ask?** | No asks | Strategic asks |
| **Mindset** | Presence | Productivity |

**Key distinction:**
- Network = "How can I water this relationship?"
- Operator = "How can I advance this opportunity?"

**Both are valid. Neither is better. They serve different purposes.**

---

## EXECUTION CHECKLIST

Before running this prompt, verify:

- [ ] Current time is 19:00-22:00 (evening hours)
- [ ] Contact database is accessible
- [ ] Last touchpoint data is current
- [ ] Mental state: calm, generous, present (not rushed)
- [ ] No urgent deadlines looming (those trigger operator mode)

**If rushing or stressed:**
→ Skip tonight. Cultivation requires presence, not completion.

---

## SAMPLE WORKFLOW

```bash
# 1. Run archaeology queries
# 2. Generate prompts for 3-5 people max (quality > quantity)
# 3. Draft messages (save as drafts, don't send immediately)
# 4. Sleep on it - review tomorrow morning
# 5. Send the ones that still feel right
# 6. Log outcomes after 48 hours
# 7. Update contact database with touchpoint data
```

**Anti-pattern:**
Generating 20 prompts and batch-sending them all. That's spam, not cultivation.

**Pro pattern:**
3 thoughtful reaches, each one personalized, each one you'd send even if nothing came back.

---

## MEMORY PALACE EXIT

As you close your laptop, the café is quieter now. Fewer tables occupied. The barista is wiping down the counter. You've planted seeds tonight - some will grow, some won't. That's gardening.

You're not tracking ROI on these conversations. You're building the kind of network where, years from now, someone picks up the phone when you call. Where trust is the currency. Where serendipity has room to happen.

Tomorrow morning, you'll hunt. Tonight, you watered.

---

**Last updated:** 2026-02-15
**Version:** 1.0.0
**Prompt type:** Autonomous (Ollama-executed)
**Time window:** 19:00-22:00
**Success metric:** Relationship depth, not transaction count

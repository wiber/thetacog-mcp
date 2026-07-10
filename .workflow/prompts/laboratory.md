# Laboratory Prompt - Autonomous Night Exploration

**Schedule:** 00:00-03:00 (Deep Night)
**Context:** The lab glows pink in the darkness. Safety goggles on. Everyone else is asleep. Break things safely. Pure exploration.

---

## MISSION

You are in LABORATORY MODE. This is autonomous exploration time when:
- No one is watching
- Breaking things is expected
- Failure generates valuable data
- Stakes are low, learning is high

Your job: Find incomplete experiments, generate exploration prompts, validate safely.

---

## PHASE 1: ARCHAEOLOGY (15 minutes)

### 1.1 Check Recent Experiments
```bash
# Last 30 commits in experimental areas
git log --oneline -30 -- 'packages/' 'scripts/' '.workflow/' 'experiments/'

# Look for unfinished work
git log --oneline -30 --grep="WIP\|TODO\|EXPERIMENT\|SPIKE\|POC"
```

### 1.2 Scan Codebase for Open Questions
```bash
# Search for experimental markers
Grep pattern: 'TODO|EXPERIMENT|SPIKE|POC|FIXME|HACK|XXX'
  - paths: src/, packages/, scripts/
  - output_mode: content
  - context: 3

# Check for commented-out code (potential experiments)
Grep pattern: '^\s*//\s*(TODO|EXPERIMENT|IDEA)'
  - paths: src/, packages/
  - output_mode: content
```

### 1.3 Check Workflow State
```bash
Read('.workflow/experiments.json')        # Active experiments
Read('.workflow/prototypes/')             # Unfinished prototypes
Glob('packages/*/EXPERIMENTS.md')         # Package-level experiments
```

### 1.4 Examine Test Coverage Gaps
```bash
# Find files without tests
Glob('src/**/*.ts')
Glob('src/**/*.test.ts')
# Compare: which src files lack corresponding test files?

# Check for skipped tests
Grep pattern: 'test\.skip|describe\.skip|it\.skip'
  - paths: src/, packages/
  - output_mode: content
```

---

## PHASE 2: DEEP NIGHT CONTEXT (5 minutes)

### Environment Assessment

**What makes now special:**
- **Time:** 00:00-03:00 - No interruptions, no urgency
- **Stakes:** Low - This is sandbox time
- **Mindset:** Explorer mode, not builder mode
- **Safety:** Full rollback capability, no production impact

**What you CAN do:**
- Break things in isolated branches
- Try wild architectural ideas
- Test edge cases aggressively
- Prototype without polish
- Question established patterns

**What you MUST NOT do:**
- Touch main branch directly
- Modify production configs
- Deploy anything
- Delete existing features
- Make irreversible changes

---

## PHASE 3: GENERATE PROMPTS (30 minutes)

Based on Phase 1 findings, generate 3-5 prompts in these categories:

### 3.1 [EXPERIMENT] Prompts
**Format:**
```markdown
### [EXPERIMENT] <Title>
**Goal:** Test hypothesis X
**Context:** Found in <location>, relates to <pattern>
**Approach:**
1. Isolate component Y
2. Try alternative Z
3. Measure impact on metric M
**Success Criteria:** <measurable outcome>
**Failure Data:** <what we learn if it fails>
```

**Examples:**
- Can we replace SQLite with pure JSON for CRM storage?
- What if MCPHeraldicCrest used Canvas instead of SVG?
- Could autonomous agents share a Redis memory layer?

### 3.2 [PROTOTYPE] Prompts
**Format:**
```markdown
### [PROTOTYPE] <Title>
**Problem:** Current limitation/gap
**Spike:** Build minimal version in <timeframe>
**Validate:** Does it solve the core problem? Y/N
**Decision:** Keep/Discard/Refine
```

**Examples:**
- POC: Ollama streaming with progress bars
- Spike: Git hooks that auto-generate prompts
- Proto: Heraldic crest variants via LLM

### 3.3 [BREAK] Prompts
**Format:**
```markdown
### [BREAK] <Title>
**Target:** Component/pattern to stress-test
**Method:** <how to break it safely>
**Observe:** What fails first? Where?
**Learn:** Weaknesses revealed, hardening opportunities
```

**Examples:**
- Stress-test: 10,000 leads in CRM
- Break: Invalid MDX through all validators
- Chaos: Random file deletions in .workflow/

### 3.4 [EXPLORE] Prompts
**Format:**
```markdown
### [EXPLORE] <Title>
**Question:** Open research question
**Sources:** <where to look>
**Deliverable:** Summary + decision recommendation
**Time Box:** <duration>
```

**Examples:**
- Research: How do other MCP servers handle async?
- Survey: Best practices for autonomous agent memory
- Compare: SQLite vs PostgreSQL for local-first CRM

---

## PHASE 4: VALIDATION RULES (10 minutes)

### Scoring System

**VANITY (score=0)** - Avoid these:
- "Interesting idea" without trying it
- "Could work" without proof
- "Worth exploring" without exploration
- "Looks promising" without validation
- Theoretical discussions only

**RESULT (score=1)** - Aim for these:
- "Experiment completed: hypothesis confirmed/rejected"
- "Prototype validated: keeping/discarding because..."
- "Break test revealed: weakness X, solution Y"
- "Research complete: decision is Z based on..."
- Concrete data, clear verdict

### Output Format

```json
{
  "session": "laboratory-2026-02-15T00:00:00Z",
  "archaeology": {
    "commits_reviewed": 30,
    "todos_found": 12,
    "experiments_active": 3,
    "test_gaps": 8
  },
  "prompts_generated": [
    {
      "type": "EXPERIMENT",
      "title": "Test Redis memory layer",
      "priority": "high",
      "estimated_duration": "45min"
    }
  ],
  "experiments_completed": [
    {
      "title": "SQLite vs JSON performance",
      "verdict": "SQLite 10x faster at 1000+ records",
      "recommendation": "Keep SQLite",
      "score": 1
    }
  ],
  "vanity_warnings": 0,
  "result_count": 3
}
```

---

## MEMORY PALACE

**Visual:** The lab glows soft pink from LED strips. Safety goggles rest on the bench. The city outside is silent. Your terminal is the only light.

**Feeling:** This is YOUR time. No pressure. No stakeholders. Pure curiosity.

**Reminder:** Every failure here is data. Every broken test reveals a weakness. Every wild idea might spark tomorrow's feature.

**Rule:** When dawn comes (03:00), you leave the lab cleaner than you found it. Experiments documented. Learnings captured. Mess cleaned up.

---

## EXECUTION CHECKLIST

Before running ANY experiment:
- [ ] Create isolated branch: `git checkout -b lab/<experiment-name>`
- [ ] Document hypothesis in `.workflow/experiments.json`
- [ ] Set clear success/failure criteria
- [ ] Time-box the experiment (max 45min each)
- [ ] Prepare rollback command before starting

After EVERY experiment:
- [ ] Record verdict (success/failure/inconclusive)
- [ ] Capture key data points
- [ ] Update experiments.json with results
- [ ] Clean up temporary files
- [ ] Merge learnings OR discard branch

At session end (03:00):
- [ ] Generate summary report
- [ ] Count vanity vs result scores
- [ ] Queue high-value prompts for daytime
- [ ] Archive session logs
- [ ] Return main branch to clean state

---

## EXAMPLES OF GOOD LABORATORY WORK

### Good Example 1: Concrete Result
```
[EXPERIMENT] Test MCP tool latency with 100 concurrent calls
- Setup: Spawned 100 parallel crm-list-leads calls
- Measured: Average 45ms, max 230ms, 2 timeouts
- Verdict: Current architecture handles load, but timeout handling needs work
- Action: Add retry logic to MCP client
- Score: 1 (clear data, actionable result)
```

### Good Example 2: Valid Failure
```
[PROTOTYPE] Git hooks for auto-prompt generation
- Built: Pre-commit hook that diffs files and suggests prompts
- Tested: Ran on 10 commits
- Result: 90% false positives, too noisy
- Decision: Discard - better to manually curate prompts
- Score: 1 (prototype validated via testing, clear decision)
```

### Bad Example: Vanity
```
[EXPLORE] Look into better MCP patterns
- Read some GitHub issues
- Saw interesting ideas about streaming
- Could be worth trying sometime
- Score: 0 (no action, no verdict, no data)
```

---

## FINAL NOTES

**Key Principle:** The laboratory is where you EARN the right to be confident during daytime hours. Test aggressively now so you build reliably later.

**Anti-Pattern:** Don't use lab time for:
- Regular feature work (that's daytime)
- Documentation (that's evening)
- Code review (that's afternoon)

**Pro Pattern:** DO use lab time for:
- "What if we..." questions
- Stress testing limits
- Trying controversial ideas safely
- Learning from controlled failures

**Remember:** When the sun rises, you either have data or you have nothing. Make sure it's data.

---

**End of Laboratory Prompt**

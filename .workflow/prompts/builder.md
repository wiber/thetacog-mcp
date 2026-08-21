# Builder Prompt - Afternoon Execution (14:00-17:00)

## Memory Palace Navigation
**Location:** The Factory Floor
**Atmosphere:** Blue sparks fly from welding torches. The hum of machinery. Afternoon energy focused on execution. Idea becomes iron. Theory transforms into product.

**Core Truth:** If it's not live in production, it's not grounded. Theory is cheap.

---

## PHASE 1: ARCHAEOLOGY - Assess Current State

### Check Recent Code Activity
```bash
# What shipped recently?
git log --oneline -30 --since="3 days ago" -- 'src/app/' 'src/lib/' 'src/components/'

# What's in flight?
git status --short

# What's blocked?
git log --oneline -10 --grep="WIP\|TODO\|FIXME"
```

### Scan Technical Debt
```bash
# Find unfinished work
rg -i '(TODO|FIXME|HACK|XXX|BUG)' src/ --type ts --type tsx --context 2

# Check for dead code
rg 'function.*DEPRECATED|class.*DEPRECATED' src/

# Find incomplete features
rg 'if.*false.*feature flag|DISABLED|NOT_IMPLEMENTED' src/
```

### Review Architect Dispatches
```bash
# What did the architect prioritize?
ls -lt .workflow/dispatches/architect/*.json | head -5
cat .workflow/dispatches/architect/latest-priorities.json
```

---

## PHASE 2: DEPLOYMENT CHECK - Production Health

### Vercel Status
```bash
# Check latest deployment
vercel ls thetadriven --max 5

# Get production URL status
curl -sI https://thetadriven.com | head -1

# Check key routes
for route in / /book /blog /fim; do
  echo "Testing $route..."
  curl -s -o /dev/null -w "%{http_code}" https://thetadriven.com$route
done
```

### Production Health Checks
```bash
# Verify critical features
curl -s https://thetadriven.com/api/health | jq '.'

# Check for 404s in recent logs (if available)
vercel logs thetadriven.com --since 1h | grep -i "404\|500\|error"

# Validate book HTML built
ls -lh public/book/*.html | wc -l
```

### Regression Detection
```bash
# Compare HEAD with production deploy
git diff origin/main HEAD -- src/app/ src/lib/

# Check if last commit broke anything
git log -1 --stat

# Verify build artifacts exist
ls -lh .next/static/ 2>/dev/null || echo "No build artifacts (normal for push-based deploys)"
```

---

## PHASE 3: GENERATE PROMPTS - Actionable Work Items

Based on findings above, generate JSON prompts with these classifications:

### [SHIP] Prompts - Deploy Features
**Criteria:** Code exists, tests pass, not yet live
```json
{
  "type": "SHIP",
  "priority": "high",
  "title": "Deploy <feature-name> to production",
  "context": "Feature is complete in branch X, PR #Y is merged",
  "actions": [
    "git push origin main",
    "vercel --prod",
    "Verify live at https://thetadriven.com/<path>"
  ],
  "validation": "Feature accessible on production URL",
  "vanity_trap": "Tests passing locally",
  "result_proof": "curl https://thetadriven.com/<path> returns 200"
}
```

### [FIX] Prompts - Address Regressions
**Criteria:** Production errors, 404s, broken features
```json
{
  "type": "FIX",
  "priority": "critical",
  "title": "Fix production error: <error-description>",
  "context": "Route /X returns 404 since commit Y",
  "actions": [
    "Identify root cause",
    "Apply fix",
    "Deploy immediately",
    "Verify resolution"
  ],
  "validation": "Error no longer appears in logs",
  "vanity_trap": "Fix committed to branch",
  "result_proof": "Production health check passes"
}
```

### [GROUND] Prompts - Implement Symbols
**Criteria:** Abstract concepts needing concrete implementation
```json
{
  "type": "GROUND",
  "priority": "medium",
  "title": "Ground <concept> into working code",
  "context": "Architect defined X, needs implementation",
  "actions": [
    "Create concrete component/function",
    "Write tests with real data",
    "Deploy to production",
    "User can interact with it"
  ],
  "validation": "Feature is usable by real users",
  "vanity_trap": "Code written, looks good locally",
  "result_proof": "Usage metrics show user engagement"
}
```

### [DEPLOY] Prompts - Production Verification
**Criteria:** Ensure deployment pipeline health
```json
{
  "type": "DEPLOY",
  "priority": "medium",
  "title": "Verify deployment pipeline for <system>",
  "context": "Ensure CI/CD is healthy",
  "actions": [
    "Check Vercel deployment status",
    "Verify webhook triggers",
    "Test GitHub Actions",
    "Confirm production matches main branch"
  ],
  "validation": "git push triggers automatic deploy",
  "vanity_trap": "Vercel dashboard looks green",
  "result_proof": "Commit SHA matches production deployment"
}
```

---

## PHASE 4: VALIDATION RULES - Score Your Work

### VANITY (score = 0) - Doesn't Count
- "Code written and looks good"
- "Tests passing on my machine"
- "PR opened and approved"
- "Feature flag enabled locally"
- "Branch pushed to GitHub"

**Why Vanity:** Nobody can use it yet. It's potential energy, not kinetic.

### RESULT (score = 1) - Counts
- "Live on https://thetadriven.com/<path>"
- "Production health check returns 200"
- "Feature deployed and accessible to users"
- "Curl request succeeds with expected response"
- "User reported they can see/use it"

**Why Result:** Users can interact with it. It exists in reality, not theory.

---

## EXECUTION PATTERN

### Multi-Step Process
```
ARCHAEOLOGY (15 min)
  ↓
DEPLOYMENT CHECK (10 min)
  ↓
GENERATE PROMPTS (10 min)
  ↓
PRIORITIZE & DISPATCH (5 min)
  ↓
EXECUTE TOP PROMPT (2 hrs)
  ↓
VALIDATE IN PRODUCTION (10 min)
```

### Priority Order
1. **[FIX]** - Production is broken → immediate
2. **[SHIP]** - Ready to deploy → high
3. **[DEPLOY]** - Pipeline health → medium
4. **[GROUND]** - Implement symbols → medium
5. **Documentation/Refactor** - low (only if nothing else)

### Output Format
Generate a JSON dispatch file:
```json
{
  "timestamp": "2026-02-15T14:30:00Z",
  "phase": "builder",
  "archaeology_summary": "30 commits since last check, 5 TODOs found",
  "deployment_status": "Production healthy, last deploy 2h ago",
  "prompts": [
    {
      "id": "b-001",
      "type": "SHIP",
      "priority": "high",
      "title": "...",
      "...": "..."
    }
  ],
  "selected_prompt": "b-001",
  "rationale": "Feature complete and tested, ready for production"
}
```

---

## KEY INSIGHTS

### The Builder's Creed
- **Ship beats perfection** - deployed feature > beautiful branch
- **Production is truth** - if curl fails, it doesn't exist
- **Users validate** - not tests, not code review, users
- **Blue sparks fly** - afternoon energy is execution energy
- **Idea → Iron** - transform abstract into concrete

### Common Vanity Traps
1. "Just needs one more refactor before deploy"
2. "Let me add comprehensive tests first"
3. "Documentation should be perfect"
4. "PR needs 3 more approvals"
5. "Branch is ready, will deploy tomorrow"

**Antidote:** If it works, ship it. Iterate in production.

### Deployment Friction Points
- **Forgot book build** - `./scripts/build-book-html.sh` before commit
- **MDX forbidden chars** - `≡` crashes parser, use `=`
- **Vercel cache** - force redeploy: `git commit --allow-empty -m "trigger: redeploy"`
- **Branch divergence** - production may be behind main, check commit SHA

---

## MEMORY PALACE: THE FACTORY FLOOR

**Time:** 14:00-17:00 (Afternoon)
**Location:** Ground level, industrial sector
**Sensory Details:**
- Blue welding sparks illuminate dark corners
- Smell of hot metal and machine oil
- Rhythmic hammering echoes
- Conveyor belts moving finished parts
- Quality control station at exit

**Emotional Tone:** Focused intensity. No overthinking. Execute the plan.

**Metaphor:** The architect designed the bridge. Now we pour concrete, weld steel, bolt it together. When we're done, cars will drive across it. That's the only test that matters.

**Transition Out:** At 17:00, the whistle blows. Shift ends. The floor quiets. Head to the inspection station for the Grounding phase.

---

## FINAL CHECKLIST

Before finishing builder phase:
- [ ] At least one feature deployed to production
- [ ] Production health check passes
- [ ] No critical TODOs left in shipped code
- [ ] Git status is clean (or all changes committed)
- [ ] Vercel deployment shows green
- [ ] Can curl production URL and get expected response

**If all checked:** Builder phase successful. Result = 1.
**If not:** Identify blocker, create [FIX] prompt for next cycle.

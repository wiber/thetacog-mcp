# RetroAge MCP Tools Specification

## Version 1.0.0 - Content Engine for Timestamped Predictions

---

## Executive Summary

**RetroAge** is a prediction tracking system embedded into blog posts that transforms static content into living documents. When you make a prediction in a blog post, RetroAge:

1. **Records** the prediction with a deadline and confidence level
2. **Verifies** the outcome when the deadline arrives
3. **Updates** the original blog post with verification badges
4. **Tracks** your accuracy over time by category

The result: blog posts that age like wine (correct predictions) or vinegar (wrong predictions), creating a transparent track record that builds reader trust.

---

## Architecture

### Data Flow

```
Blog Post (MDX)
    |
    v
retroage-predict (MCP tool)
    |
    v
SQLite (local) ---> Supabase (optional sync)
    |
    v
retroage-verify (manual or cron)
    |
    v
retroage-update-post (inject badge into MDX)
    |
    v
Blog Post (MDX) with verification badge
```

### Storage

**Primary:** SQLite at `~/.thetacog/retroage.db`
**Optional:** Supabase sync (same pattern as CRM)
**Blog Integration:** MDX files in `src/content/blog/`

### Tables

```sql
CREATE TABLE IF NOT EXISTS predictions (
    id TEXT PRIMARY KEY,  -- UUID
    slug TEXT NOT NULL,   -- Blog post slug (e.g., "ai-will-replace-lawyers-2026")
    prediction_text TEXT NOT NULL,  -- The exact prediction statement
    category TEXT NOT NULL,  -- Category for grouping (ai, crypto, politics, tech, science, etc.)
    confidence INTEGER NOT NULL CHECK (confidence BETWEEN 1 AND 100),  -- 1-100%
    deadline DATE NOT NULL,  -- When to verify (YYYY-MM-DD)
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    verified_at DATETIME,  -- When verification happened
    outcome TEXT CHECK (outcome IN ('correct', 'incorrect', 'partial', 'pending')),
    outcome_notes TEXT,  -- Explanation of verification
    source_url TEXT,  -- Link to evidence for outcome
    blog_updated INTEGER DEFAULT 0,  -- Has the blog post been updated?
    UNIQUE(slug, prediction_text)  -- No duplicate predictions per post
);

CREATE INDEX IF NOT EXISTS idx_predictions_deadline ON predictions(deadline);
CREATE INDEX IF NOT EXISTS idx_predictions_category ON predictions(category);
CREATE INDEX IF NOT EXISTS idx_predictions_outcome ON predictions(outcome);
```

---

## MCP Tools

### 1. `retroage-predict`

**Purpose:** Record a new prediction with deadline and confidence.

**Description:**
Record a prediction made in a blog post. Extracts the key claim, assigns a confidence level, and sets a verification deadline. Claude should use this when writing blog posts that contain testable predictions about the future.

**Input Schema:**
```json
{
  "type": "object",
  "properties": {
    "slug": {
      "type": "string",
      "description": "Blog post slug (filename without .mdx). E.g., 'ai-will-replace-lawyers-2026'"
    },
    "prediction_text": {
      "type": "string",
      "description": "The exact prediction statement. Should be specific and falsifiable. E.g., 'OpenAI will release GPT-5 before December 2024'"
    },
    "category": {
      "type": "string",
      "description": "Category for grouping predictions",
      "enum": ["ai", "crypto", "politics", "tech", "science", "economics", "sports", "culture", "personal"]
    },
    "confidence": {
      "type": "number",
      "description": "Confidence level 1-100%. Use 70+ for strong predictions, 50-69 for reasonable guesses, below 50 for speculation.",
      "minimum": 1,
      "maximum": 100
    },
    "deadline": {
      "type": "string",
      "description": "Verification deadline in YYYY-MM-DD format. When should we check if this came true?",
      "pattern": "^\\d{4}-\\d{2}-\\d{2}$"
    },
    "context": {
      "type": "string",
      "description": "Optional additional context about why this prediction was made"
    }
  },
  "required": ["slug", "prediction_text", "category", "confidence", "deadline"]
}
```

**Output:**
```json
{
  "success": true,
  "id": "pred_abc123",
  "prediction": {
    "slug": "ai-will-replace-lawyers-2026",
    "prediction_text": "OpenAI will release GPT-5 before December 2024",
    "category": "ai",
    "confidence": 75,
    "deadline": "2024-12-31",
    "created_at": "2024-01-15T10:30:00Z"
  },
  "message": "Prediction recorded. Verification deadline: Dec 31, 2024 (350 days)"
}
```

**Implementation Notes:**
- Generate UUID for `id` using `crypto.randomUUID()`
- Validate deadline is in the future
- Check for duplicate predictions (same slug + text)
- Store in SQLite immediately, sync to Supabase async

---

### 2. `retroage-verify`

**Purpose:** Mark a prediction as correct, incorrect, or partial with outcome evidence.

**Description:**
Verify a prediction outcome. Use when a deadline has passed or when new evidence makes the outcome clear. Requires providing evidence/source for the verification. This is a manual process - the human or Claude reviews the outcome and marks it.

**Input Schema:**
```json
{
  "type": "object",
  "properties": {
    "id": {
      "type": "string",
      "description": "Prediction ID to verify. Use retroage-accuracy to find pending predictions."
    },
    "outcome": {
      "type": "string",
      "description": "The verification outcome",
      "enum": ["correct", "incorrect", "partial"]
    },
    "outcome_notes": {
      "type": "string",
      "description": "Explanation of the verification. What happened? Be specific."
    },
    "source_url": {
      "type": "string",
      "description": "URL to evidence supporting the verification (news article, announcement, etc.)"
    }
  },
  "required": ["id", "outcome", "outcome_notes"]
}
```

**Output:**
```json
{
  "success": true,
  "prediction": {
    "id": "pred_abc123",
    "slug": "ai-will-replace-lawyers-2026",
    "prediction_text": "OpenAI will release GPT-5 before December 2024",
    "outcome": "incorrect",
    "outcome_notes": "As of December 31, 2024, OpenAI has not released GPT-5. They released o1 and o3 instead.",
    "source_url": "https://openai.com/blog/...",
    "verified_at": "2024-12-31T23:59:59Z"
  },
  "blog_needs_update": true,
  "message": "Prediction marked as INCORRECT. Run retroage-update-post to inject badge into blog post."
}
```

**Implementation Notes:**
- Set `verified_at` to current timestamp
- Set `blog_updated` to 0 (needs update)
- Validate the prediction exists and is in "pending" state
- Return helpful message about next step (update post)

---

### 3. `retroage-update-post`

**Purpose:** Inject verification results back into the original blog post MDX.

**Description:**
Updates the blog post MDX file to include a RetroAge verification badge for a prediction. The badge shows the prediction, confidence, outcome, and verification date. Creates a visible track record in the blog post itself.

**Input Schema:**
```json
{
  "type": "object",
  "properties": {
    "id": {
      "type": "string",
      "description": "Prediction ID to inject badge for"
    },
    "badge_style": {
      "type": "string",
      "description": "Badge style to inject",
      "enum": ["inline", "callout", "sidebar"],
      "default": "callout"
    },
    "position": {
      "type": "string",
      "description": "Where to inject the badge",
      "enum": ["after-prediction", "end-of-post", "custom"],
      "default": "end-of-post"
    },
    "custom_position_marker": {
      "type": "string",
      "description": "If position is 'custom', look for this marker in the MDX. E.g., '<!-- RETROAGE-BADGE-HERE -->'"
    }
  },
  "required": ["id"]
}
```

**Output:**
```json
{
  "success": true,
  "file_updated": "src/content/blog/ai-will-replace-lawyers-2026.mdx",
  "badge_injected": {
    "type": "callout",
    "position": "end-of-post",
    "html_preview": "<BlogCallout type=\"retroage-incorrect\">..."
  },
  "message": "Badge injected into blog post. Commit and deploy to publish."
}
```

**Badge Component Examples:**

**Correct Prediction (Green):**
```jsx
<BlogCallout type="retroage-correct">
  <div className="retroage-badge">
    <span className="retroage-icon">✅</span>
    <span className="retroage-title">Prediction Verified: CORRECT</span>
    <div className="retroage-details">
      <p><strong>Prediction:</strong> "OpenAI will release GPT-5 before December 2024"</p>
      <p><strong>Confidence:</strong> 75%</p>
      <p><strong>Made:</strong> January 15, 2024</p>
      <p><strong>Verified:</strong> December 1, 2024</p>
      <p><strong>Outcome:</strong> GPT-5 was announced November 15, 2024.</p>
      <a href="https://source.url">Source</a>
    </div>
  </div>
</BlogCallout>
```

**Incorrect Prediction (Red):**
```jsx
<BlogCallout type="retroage-incorrect">
  <div className="retroage-badge">
    <span className="retroage-icon">❌</span>
    <span className="retroage-title">Prediction Verified: INCORRECT</span>
    ...
  </div>
</BlogCallout>
```

**Partial Prediction (Yellow):**
```jsx
<BlogCallout type="retroage-partial">
  <div className="retroage-badge">
    <span className="retroage-icon">⚠️</span>
    <span className="retroage-title">Prediction Verified: PARTIAL</span>
    ...
  </div>
</BlogCallout>
```

**Implementation Notes:**
- Read the MDX file from `src/content/blog/{slug}.mdx`
- Find injection point based on `position`
- Generate badge JSX with proper escaping
- Write updated MDX back to file
- Set `blog_updated = 1` in database
- Validate MDX doesn't contain forbidden characters (per CLAUDE.md rules)

---

### 4. `retroage-accuracy`

**Purpose:** Get accuracy statistics for predictions by category and timeframe.

**Description:**
Returns accuracy statistics across all predictions. Useful for building a public track record page, finding pending predictions that need verification, and analyzing prediction performance by category.

**Input Schema:**
```json
{
  "type": "object",
  "properties": {
    "category": {
      "type": "string",
      "description": "Filter by category (optional). Use 'all' for aggregate stats.",
      "enum": ["all", "ai", "crypto", "politics", "tech", "science", "economics", "sports", "culture", "personal"]
    },
    "timeframe": {
      "type": "string",
      "description": "Filter by timeframe (optional)",
      "enum": ["all", "30d", "90d", "1y", "ytd"]
    },
    "include_pending": {
      "type": "boolean",
      "description": "Include pending predictions in output (default: false)",
      "default": false
    },
    "format": {
      "type": "string",
      "description": "Output format",
      "enum": ["summary", "detailed", "markdown"],
      "default": "summary"
    }
  }
}
```

**Output (summary format):**
```json
{
  "total_predictions": 47,
  "verified": 32,
  "pending": 15,
  "accuracy": {
    "overall": 68.75,
    "by_category": {
      "ai": { "correct": 12, "incorrect": 5, "partial": 2, "accuracy": 63.2 },
      "crypto": { "correct": 3, "incorrect": 8, "partial": 1, "accuracy": 29.2 },
      "tech": { "correct": 6, "incorrect": 2, "partial": 1, "accuracy": 72.2 }
    },
    "by_confidence_tier": {
      "high_confidence_70_plus": { "total": 18, "correct": 14, "accuracy": 77.8 },
      "medium_confidence_50_69": { "total": 10, "correct": 6, "accuracy": 60.0 },
      "low_confidence_below_50": { "total": 4, "correct": 1, "accuracy": 25.0 }
    }
  },
  "upcoming_verifications": [
    { "id": "pred_xyz", "slug": "ai-agents-2025", "deadline": "2025-03-15", "days_until": 51 },
    { "id": "pred_abc", "slug": "bitcoin-100k", "deadline": "2025-06-01", "days_until": 129 }
  ],
  "needs_blog_update": [
    { "id": "pred_123", "slug": "gpt5-release", "verified_at": "2024-12-31" }
  ]
}
```

**Output (markdown format):**
```markdown
# Prediction Track Record

## Overall Accuracy: 68.75%

| Category | Correct | Incorrect | Partial | Accuracy |
|----------|---------|-----------|---------|----------|
| AI       | 12      | 5         | 2       | 63.2%    |
| Crypto   | 3       | 8         | 1       | 29.2%    |
| Tech     | 6       | 2         | 1       | 72.2%    |

## Calibration Analysis

High confidence predictions (70%+) hit rate: 77.8%
Medium confidence (50-69%) hit rate: 60.0%
Low confidence (below 50%) hit rate: 25.0%

*Good calibration: high confidence should hit more often than low confidence.*

## Pending Verifications (15)

- **ai-agents-2025**: "Autonomous AI agents will handle 50% of customer service" - Due Mar 15, 2025
- **bitcoin-100k**: "Bitcoin will reach $100k by mid-2025" - Due Jun 1, 2025
```

**Implementation Notes:**
- Calculate accuracy as: `(correct + 0.5*partial) / (correct + incorrect + partial) * 100`
- Include calibration analysis (do high-confidence predictions perform better?)
- Surface predictions needing verification (deadline passed, still pending)
- Surface predictions needing blog updates (verified but not injected)

---

## Integration with Blog Posts

### Recording Predictions While Writing

When Claude writes a blog post with predictions, it should automatically call `retroage-predict` for each testable prediction:

```markdown
## My Prediction

I predict that **OpenAI will release GPT-5 before December 2024**. I'm giving this a 75% confidence level.

<!-- RETROAGE: slug=ai-predictions-2024, confidence=75, deadline=2024-12-31, category=ai -->
```

The comment marker is optional - Claude can also just call the MCP tool directly.

### Automatic Badge Injection

When a prediction is verified, the `retroage-update-post` tool injects a badge:

```markdown
## My Prediction

I predict that **OpenAI will release GPT-5 before December 2024**. I'm giving this a 75% confidence level.

<BlogCallout type="retroage-incorrect">
**Prediction Verified: INCORRECT** (Verified Dec 31, 2024)

GPT-5 was not released. OpenAI focused on o1/o3 reasoning models instead.
[Source](https://openai.com/blog/...)
</BlogCallout>
```

### Track Record Page

Use `retroage-accuracy` with `format=markdown` to generate a public track record page:

```
/predictions - All predictions with outcomes
/predictions/ai - AI category only
/predictions/pending - Upcoming verifications
```

---

## Database Migrations

### Initial Setup (v1.0.0)

```sql
-- Run this once to create the predictions table
CREATE TABLE IF NOT EXISTS predictions (
    id TEXT PRIMARY KEY,
    slug TEXT NOT NULL,
    prediction_text TEXT NOT NULL,
    category TEXT NOT NULL,
    confidence INTEGER NOT NULL CHECK (confidence BETWEEN 1 AND 100),
    deadline DATE NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    verified_at DATETIME,
    outcome TEXT CHECK (outcome IN ('correct', 'incorrect', 'partial', 'pending')),
    outcome_notes TEXT,
    source_url TEXT,
    blog_updated INTEGER DEFAULT 0,
    UNIQUE(slug, prediction_text)
);

CREATE INDEX IF NOT EXISTS idx_predictions_deadline ON predictions(deadline);
CREATE INDEX IF NOT EXISTS idx_predictions_category ON predictions(category);
CREATE INDEX IF NOT EXISTS idx_predictions_outcome ON predictions(outcome);
```

---

## CLI Subcommands

Following the pattern from CRM and ThetaCog:

```bash
# Install and register with Claude Code
thetacog-mcp install

# Manual commands for testing
thetacog-mcp retroage-list          # List all predictions
thetacog-mcp retroage-pending       # List pending verifications
thetacog-mcp retroage-overdue       # List overdue predictions
```

---

## Error Handling

| Error | Cause | Response |
|-------|-------|----------|
| `PREDICTION_EXISTS` | Duplicate slug + text | Return existing prediction ID |
| `INVALID_DEADLINE` | Deadline in the past | "Deadline must be in the future" |
| `PREDICTION_NOT_FOUND` | Invalid ID | "Prediction not found: {id}" |
| `ALREADY_VERIFIED` | Trying to verify twice | "Already verified on {date}" |
| `BLOG_NOT_FOUND` | MDX file missing | "Blog post not found: {slug}.mdx" |
| `MDX_PARSE_ERROR` | Invalid MDX after injection | Rollback, report error |

---

## Supabase Sync (Optional)

Same pattern as CRM:

1. Write to SQLite first (0-1ms)
2. Background sync to Supabase
3. Pull from Supabase at start of each MCP call

Supabase table matches SQLite schema with additional columns:

```sql
-- Additional columns for Supabase
user_id UUID REFERENCES auth.users,
_sync_status TEXT DEFAULT 'synced',
_last_synced_at TIMESTAMP WITH TIME ZONE
```

---

## Future Enhancements (v2.0)

1. **Automated Verification** - Integration with news APIs to auto-check outcomes
2. **Prediction Markets** - Compare your confidence to market odds
3. **Collaborative Verification** - Allow readers to vote on outcomes
4. **RSS Feed** - Notify subscribers when predictions are verified
5. **Brier Score** - More sophisticated accuracy metric for calibration
6. **Prediction Chains** - Link related predictions (if A then B)

---

## Usage Examples

### Example 1: Recording a Prediction

```
User: "Write a blog post predicting AI trends for 2025"

Claude: [writes post with predictions]

Claude: [calls retroage-predict for each prediction]
- "GPT-5 will be released" -> 70% confidence, deadline 2025-12-31
- "AI agents will handle 50% of customer service" -> 55% confidence, deadline 2025-06-30
- "OpenAI will IPO" -> 40% confidence, deadline 2025-12-31
```

### Example 2: Verifying a Prediction

```
User: "Check if my GPT-5 prediction came true"

Claude: [calls retroage-accuracy to find the prediction]
Claude: [researches the outcome]
Claude: [calls retroage-verify with outcome and source]
Claude: [calls retroage-update-post to inject badge]
Claude: "Done! Your prediction was marked as [CORRECT/INCORRECT]. Badge injected into the blog post."
```

### Example 3: Getting Track Record

```
User: "Show me my prediction accuracy"

Claude: [calls retroage-accuracy with format=markdown]
Claude: "Here's your track record:

Overall: 68.75% accuracy across 32 verified predictions.
Best category: Tech (72.2%)
Worst category: Crypto (29.2%)

You have 15 pending predictions. The next one due is 'AI agents will handle 50% of customer service' on March 15, 2025."
```

---

## Implementation Checklist

- [ ] Add predictions table to SQLite init in `server.js`
- [ ] Implement `retroage-predict` tool handler
- [ ] Implement `retroage-verify` tool handler
- [ ] Implement `retroage-update-post` tool handler
- [ ] Implement `retroage-accuracy` tool handler
- [ ] Create `BlogCallout` variants for retroage badges
- [ ] Add badge CSS styles (green/red/yellow)
- [ ] Test MDX injection without breaking parser
- [ ] Add to ListToolsRequestSchema
- [ ] Update CHANGELOG.md
- [ ] Update README.md with retroage documentation

---

## References

- CRM MCP Pattern: `/packages/thetacoach-crm-mcp/server.js`
- ThetaCog MCP Pattern: `/packages/thetacog-mcp/server.js`
- BlogCallout Component: `/src/components/BlogCallout.tsx`
- MDX Rules: `/CLAUDE.md` (forbidden characters section)

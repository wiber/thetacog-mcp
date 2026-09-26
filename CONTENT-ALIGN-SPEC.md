# Content Alignment MCP Tools Specification

## Version 1.0.0 - SEO Surfer-Equivalent Trend Alignment Engine

---

## Executive Summary

**Content Alignment** is a writing alignment system for the ThetaCoach content engine. This is NOT an AI voice generator - it's a tool that helps human writers align their drafts with:

1. **Current trends/news** relevant to ThetaCoach topics
2. **Brand voice guidelines** (technical depth, Challenger Sales, tesseract physics, contrarian insights)
3. **SEO best practices** based on real-time competitive analysis
4. **Keyword density and readability** thresholds

The result: A Surfer SEO-equivalent "Content Score" (0-100) that tells you how well your draft aligns with what Google expects AND what ThetaCoach's brand voice demands.

---

## Brand Voice Definition

### Core Identity

ThetaCoach content has a distinct voice characterized by:

| Dimension | Description | Examples |
|-----------|-------------|----------|
| **Technical Depth** | Uses precise terminology, cites research, shows mathematical rigor | "S=P=H Unity Principle", "Flesch-Kincaid Grade 11+", citations |
| **Challenger Sales Methodology** | Teaches, tailors, takes control; reframes assumptions | "What you think you know is wrong", "The liability angle you missed" |
| **Tesseract Physics Concepts** | FIM, Trust Debt, Drift, Grounding, Normalization | "Database normalization as physics", "Cache misses as diagnostic windows" |
| **Contrarian Insights** | Challenges conventional wisdom with evidence | "Schneier says it's impossible. He's right. Here's the fix." |

### Voice Markers (for alignment scoring)

```javascript
const VOICE_MARKERS = {
  technical_depth: [
    'O(1)', 'O(n)', 'quantum', 'entropy', 'normalization', 'semantic',
    'hash', 'cache', 'latency', 'microseconds', 'milliseconds',
    'correlation', 'coefficient', 'standard deviation', 'p-value'
  ],
  challenger_sales: [
    'reframe', 'assumption', 'what you think', 'conventional wisdom',
    'the real problem', 'not what you expected', 'counterintuitive',
    'the liability', 'who owns the errors', 'accountability'
  ],
  tesseract_physics: [
    'FIM', 'Trust Debt', 'S=P=H', 'Unity Principle', 'grounding',
    'drift', 'semantic drift', 'goal drift', 'context drift',
    'tesseract', 'normalization', 'Codd', 'Hebbian'
  ],
  contrarian_insight: [
    'impossible', 'wrong', 'broken', 'fundamentally', 'the fix',
    'what they missed', 'the industry ignores', 'hidden assumption'
  ]
};
```

### Target Personas (from existing SEO optimizer)

| Persona | Role | Liability Fear | Keywords |
|---------|------|----------------|----------|
| Technical Lead | Engineering Manager | Agent failures breaking production | AI ops, production AI, agent reliability |
| Product Owner | PM / Founder | Shipping broken AI features | AI product, AI features, user trust |
| Enterprise Buyer | VP Eng / CTO | Legal exposure, compliance gaps | AI governance, AI compliance, AI audit |
| Individual Builder | Developer | Wasting time on AI that doesn't work | AI coding, LLM development, AI tools |

---

## Architecture

### Data Flow

```
                              +------------------+
                              |   News APIs      |
                              | (HackerNews,     |
                              |  Google Trends)  |
                              +--------+---------+
                                       |
                                       v
+----------------+            +------------------+            +------------------+
|  User Draft    |  ------>   |  content-align   |  ------>   |  Alignment       |
|  (MDX file)    |            |  (MCP Tool)      |            |  Report + Score  |
+----------------+            +--------+---------+            +------------------+
                                       |
                              +--------v---------+
                              |   Brand Voice    |
                              |   Guidelines     |
                              |   (this spec)    |
                              +------------------+
```

### Storage

**Primary:** SQLite at `~/.thetacog/content-align.db`
**Cache:** `~/.thetacog/trends-cache.json` (15-minute TTL)
**Blog Integration:** MDX files in `src/content/blog/`

### Database Schema

```sql
-- Trends cache (avoid hammering APIs)
CREATE TABLE IF NOT EXISTS trends_cache (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source TEXT NOT NULL,  -- 'hackernews', 'google_trends', 'twitter'
    category TEXT NOT NULL,  -- 'ai', 'physics', 'sales', 'tech'
    trend_data TEXT NOT NULL,  -- JSON array of trending topics
    fetched_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    expires_at DATETIME NOT NULL
);

-- Content alignment reports
CREATE TABLE IF NOT EXISTS alignment_reports (
    id TEXT PRIMARY KEY,  -- UUID
    slug TEXT NOT NULL,  -- Blog post slug
    draft_hash TEXT NOT NULL,  -- MD5 of draft content (for cache invalidation)
    score INTEGER NOT NULL CHECK (score BETWEEN 0 AND 100),
    brand_voice_score INTEGER,
    seo_score INTEGER,
    trend_alignment_score INTEGER,
    report_json TEXT NOT NULL,  -- Full analysis JSON
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Keyword suggestions history
CREATE TABLE IF NOT EXISTS keyword_suggestions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slug TEXT NOT NULL,
    keyword TEXT NOT NULL,
    source TEXT NOT NULL,  -- 'trend', 'competitor', 'brand_theme'
    relevance_score REAL,
    used INTEGER DEFAULT 0,  -- Was it incorporated?
    suggested_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_trends_expires ON trends_cache(expires_at);
CREATE INDEX IF NOT EXISTS idx_reports_slug ON alignment_reports(slug);
```

---

## MCP Tools

### 1. `content-trends`

**Purpose:** Fetch current trends/news relevant to ThetaCoach topics (physics, AI, sales methodology).

**Description:**
Fetches trending topics from news sources and Google Trends that are relevant to ThetaCoach's content pillars. Uses a 15-minute cache to avoid API rate limits. Returns trends organized by category with relevance scores.

**Input Schema:**
```json
{
  "type": "object",
  "properties": {
    "categories": {
      "type": "array",
      "description": "Categories to fetch trends for",
      "items": {
        "type": "string",
        "enum": ["ai", "physics", "sales", "tech", "startup", "enterprise", "all"]
      },
      "default": ["ai", "physics", "sales"]
    },
    "sources": {
      "type": "array",
      "description": "News sources to query",
      "items": {
        "type": "string",
        "enum": ["hackernews", "google_trends", "reddit_tech", "all"]
      },
      "default": ["hackernews", "google_trends"]
    },
    "max_results": {
      "type": "number",
      "description": "Maximum trends per category",
      "default": 10,
      "minimum": 1,
      "maximum": 50
    },
    "force_refresh": {
      "type": "boolean",
      "description": "Bypass cache and fetch fresh data",
      "default": false
    }
  }
}
```

**Output:**
```json
{
  "fetched_at": "2026-01-23T15:30:00Z",
  "cache_hit": false,
  "trends": {
    "ai": [
      {
        "topic": "Claude 4 Opus release",
        "source": "hackernews",
        "relevance": 0.95,
        "velocity": "rising",
        "url": "https://news.ycombinator.com/item?id=...",
        "brand_fit": {
          "score": 0.88,
          "themes": ["agentic-workflows", "trust-debt"],
          "suggested_angle": "How Trust Debt applies to Claude 4's new capabilities"
        }
      },
      {
        "topic": "AI Agent Security Vulnerabilities",
        "source": "google_trends",
        "relevance": 0.92,
        "velocity": "steady",
        "brand_fit": {
          "score": 0.95,
          "themes": ["liability-fear", "fim-technology"],
          "suggested_angle": "The FIM-IAM solution to the vulnerability Schneier identified"
        }
      }
    ],
    "physics": [...],
    "sales": [...]
  },
  "liability_angles": [
    {
      "trend": "AI Agent Security Vulnerabilities",
      "angle": "Who owns the errors when AI agents fail? The liability question enterprises ignore.",
      "persona_resonance": ["enterprise-buyer", "technical-lead"]
    }
  ]
}
```

**Implementation Notes:**
- Use HackerNews API (free, no auth): `https://hacker-news.firebaseio.com/v0/`
- Use Google Trends via pytrends or unofficial API
- Filter results using `BRAND_THEMES` keywords from existing SEO optimizer
- Calculate `brand_fit.score` by matching trend against voice markers
- Identify "liability angles" - the unifying fear that connects to all personas

---

### 2. `content-align`

**Purpose:** Analyze a draft post against brand voice guidelines and trending topics.

**Description:**
The core alignment tool. Takes a draft MDX file (or raw text) and produces a comprehensive alignment report with a 0-100 Content Score. Analyzes: brand voice compliance, SEO metrics, trend alignment, and readability. Returns specific suggestions for improvement.

**Input Schema:**
```json
{
  "type": "object",
  "properties": {
    "slug": {
      "type": "string",
      "description": "Blog post slug (reads from src/content/blog/{slug}.mdx)"
    },
    "raw_text": {
      "type": "string",
      "description": "Raw text to analyze (alternative to slug)"
    },
    "target_keyword": {
      "type": "string",
      "description": "Primary keyword to optimize for (optional)"
    },
    "include_competitor_analysis": {
      "type": "boolean",
      "description": "Fetch and analyze top-ranking competitors for target keyword",
      "default": false
    },
    "strict_mode": {
      "type": "boolean",
      "description": "Fail if score below 60 (for CI/CD integration)",
      "default": false
    }
  },
  "required": []
}
```

**Output:**
```json
{
  "slug": "ai-agent-security-fim-solution",
  "content_score": 78,
  "grade": "B",
  "scores": {
    "brand_voice": {
      "score": 82,
      "breakdown": {
        "technical_depth": 90,
        "challenger_sales": 75,
        "tesseract_physics": 85,
        "contrarian_insight": 78
      },
      "missing_markers": [
        "Consider adding more 'reframe' language in section C",
        "Add a 'what you think you know is wrong' hook in intro"
      ]
    },
    "seo": {
      "score": 75,
      "breakdown": {
        "word_count": { "actual": 1850, "target": "2000-3500", "score": 70 },
        "readability": { "flesch": 52, "grade": "10th-12th", "score": 85 },
        "title_length": { "actual": 65, "target": "30-60", "score": 60 },
        "meta_description": { "actual": 145, "target": "120-160", "score": 95 },
        "headings": { "count": 8, "target": "5-15", "score": 90 },
        "internal_links": { "count": 2, "target": "3+", "score": 65 }
      },
      "keyword_density": {
        "AI agent": { "count": 12, "density": "0.6%", "target": "0.5-2%", "status": "ok" },
        "FIM-IAM": { "count": 5, "density": "0.3%", "target": "0.5-1%", "status": "low" }
      }
    },
    "trend_alignment": {
      "score": 77,
      "matched_trends": [
        { "trend": "AI Agent Security", "matches": 8, "sections": ["A", "B", "C"] }
      ],
      "missed_opportunities": [
        {
          "trend": "Claude 4 Opus",
          "relevance": 0.85,
          "suggestion": "Reference Claude 4's new agentic capabilities in section E"
        }
      ]
    }
  },
  "action_items": [
    {
      "priority": 1,
      "type": "keyword",
      "action": "Increase FIM-IAM mentions from 5 to 8-10",
      "impact": "+5 points"
    },
    {
      "priority": 2,
      "type": "internal_link",
      "action": "Add link to /blog/trust-debt-glass-wall-reality",
      "impact": "+3 points"
    },
    {
      "priority": 3,
      "type": "trend",
      "action": "Add paragraph connecting to Claude 4 Opus release",
      "impact": "+4 points"
    }
  ],
  "crest_audit": {
    "total": 10,
    "default_variant": 6,
    "semantic_variant": 4,
    "recommendation": "Replace 3 'default' crests with 'trustworthy' or 'methodology'"
  }
}
```

**Implementation Notes:**
- Reuse `analyzePost()` logic from existing `analyze-blog-seo.js`
- Add brand voice scoring using `VOICE_MARKERS` regex matching
- Calculate trend alignment by comparing content against cached trends
- Generate actionable `action_items` sorted by impact
- Include crest audit (from existing SEO optimizer)

---

### 3. `content-suggest`

**Purpose:** Suggest angle/hook for writing based on current news + brand voice.

**Description:**
Given a topic or keyword, suggests specific angles, hooks, and outlines that align with ThetaCoach's brand voice while capitalizing on current trends. Use before writing to plan content strategy.

**Input Schema:**
```json
{
  "type": "object",
  "properties": {
    "topic": {
      "type": "string",
      "description": "Topic or keyword to generate suggestions for"
    },
    "persona": {
      "type": "string",
      "description": "Target persona for the content",
      "enum": ["technical-lead", "product-owner", "enterprise-buyer", "individual-builder", "all"],
      "default": "all"
    },
    "content_type": {
      "type": "string",
      "description": "Type of content to suggest",
      "enum": ["blog-post", "linkedin-post", "twitter-thread", "newsletter"],
      "default": "blog-post"
    },
    "include_outline": {
      "type": "boolean",
      "description": "Generate a full ShortRank A-K outline",
      "default": true
    },
    "contrarian_level": {
      "type": "string",
      "description": "How contrarian should the angle be?",
      "enum": ["mild", "moderate", "spicy"],
      "default": "moderate"
    }
  },
  "required": ["topic"]
}
```

**Output:**
```json
{
  "topic": "AI agent deployment",
  "generated_at": "2026-01-23T15:30:00Z",
  "suggestions": [
    {
      "angle": "The Lethal Trifecta 2.0: Why Your AI Agent Deployment Will Fail (And the Physics Fix)",
      "hook": "Bruce Schneier says AI agents are impossible to secure. Six months later, every major deployment has proven him right. Here's the physics-based solution the industry missed.",
      "brand_voice_score": 92,
      "trend_alignment": ["AI Agent Security", "Enterprise AI Failures"],
      "persona_fit": {
        "enterprise-buyer": 0.95,
        "technical-lead": 0.88
      },
      "liability_angle": "When your AI agent leaks customer data, who faces the SEC inquiry?",
      "outline": {
        "A": {
          "title": "The Six-Month Scorecard",
          "emoji": "📊",
          "content_hint": "Statistics on AI agent failures since Schneier's warning"
        },
        "B": {
          "title": "Why Traditional IAM Failed",
          "emoji": "💀",
          "content_hint": "400ms permission checks vs microsecond agent decisions"
        },
        "C": {
          "title": "The Physics of Permission",
          "emoji": "⚛️",
          "content_hint": "FIM-IAM geometric shapes vs software ACLs"
        },
        "D": {
          "title": "Case Study: The $47M Near-Miss",
          "emoji": "💰",
          "content_hint": "Real example of ForcedLeak-style attack (anonymized)"
        },
        "E": {
          "title": "The Implementation Path",
          "emoji": "🛠️",
          "content_hint": "3-phase deployment: Classical -> Hybrid -> Full quantum"
        },
        "F": {
          "title": "The Math Your Board Needs",
          "emoji": "📈",
          "content_hint": "120,000x performance improvement, liability reduction"
        },
        "G": {
          "title": "Get Started",
          "emoji": "🎯",
          "content_hint": "CTA to FIM-IAM Grid, ThetaCoach CRM, Enterprise contact"
        }
      },
      "suggested_tags": ["AI-security", "FIM-IAM", "enterprise-AI", "agentic-risk", "Bruce-Schneier"],
      "internal_links": [
        "/blog/2025-12-17-schneier-lethal-trifecta-fim-iam-solution",
        "/blog/trust-debt-glass-wall-reality",
        "/fim-iam"
      ]
    },
    {
      "angle": "...",
      "hook": "...",
      ...
    }
  ],
  "trend_context": [
    {
      "trend": "AI Agent Security",
      "current_velocity": "rising",
      "window": "1-2 weeks until saturated",
      "recommendation": "Publish within 5 days to catch the wave"
    }
  ]
}
```

**Implementation Notes:**
- Fetch current trends using `content-trends`
- Match topic against `BRAND_THEMES` to find relevant angles
- Generate hooks using Challenger Sales patterns ("What you think... is wrong")
- Build outline using ShortRank A-K structure from existing blog posts
- Suggest internal links by scanning existing posts for keyword matches
- Calculate trend velocity to suggest optimal publishing window

---

### 4. `content-score`

**Purpose:** Score existing content for SEO alignment (like Surfer SEO content score).

**Description:**
A simplified scoring tool optimized for quick checks. Returns just the score and top 3 action items. Use for batch scoring multiple posts or CI/CD integration.

**Input Schema:**
```json
{
  "type": "object",
  "properties": {
    "slug": {
      "type": "string",
      "description": "Single blog post slug to score"
    },
    "slugs": {
      "type": "array",
      "description": "Multiple slugs for batch scoring",
      "items": { "type": "string" }
    },
    "threshold": {
      "type": "number",
      "description": "Minimum score threshold (for CI/CD fail)",
      "default": 60,
      "minimum": 0,
      "maximum": 100
    },
    "format": {
      "type": "string",
      "description": "Output format",
      "enum": ["summary", "detailed", "ci"],
      "default": "summary"
    }
  }
}
```

**Output (summary format):**
```json
{
  "slug": "ai-agent-security-fim-solution",
  "score": 78,
  "grade": "B",
  "top_issues": [
    "FIM-IAM keyword density too low (0.3% vs 0.5-1% target)",
    "Missing internal link to Trust Debt post",
    "6/10 crests using 'default' variant"
  ],
  "pass": true
}
```

**Output (batch/ci format):**
```json
{
  "total": 10,
  "passed": 8,
  "failed": 2,
  "results": [
    { "slug": "post-1", "score": 85, "pass": true },
    { "slug": "post-2", "score": 55, "pass": false, "blocking_issues": ["..."] }
  ],
  "exit_code": 1
}
```

**Implementation Notes:**
- Reuse scoring logic from `content-align`
- Return minimal output for fast batch processing
- Set `exit_code` for CI/CD integration (0 = all pass, 1 = failures)
- Support `--all` flag to score entire blog directory

---

## Integration with Existing Tools

### Existing SEO Scripts

The following scripts already exist and should be integrated:

| Script | Purpose | Integration |
|--------|---------|-------------|
| `scripts/analyze-blog-seo.js` | Full SEO analysis with readability, keywords, crests | Reuse `analyzePost()` in `content-align` |
| `scripts/optimize-blog-seo.js` | Crest fixing, trend injection (interactive) | Migrate trend matching logic to `content-trends` |

### CRM Integration

Content suggestions can be connected to CRM battle cards:

```javascript
// When writing content for a specific persona
const lead = await crm.getLead(email);
const suggestion = await contentSuggest({
  topic: lead.pain_points,
  persona: lead.persona_type
});
// Use suggestion.liability_angle in battle card
```

---

## API Dependencies

### HackerNews API (Free, No Auth)

```javascript
// Fetch top stories
const topStories = await fetch('https://hacker-news.firebaseio.com/v0/topstories.json');
const ids = await topStories.json();

// Fetch story details
const story = await fetch(`https://hacker-news.firebaseio.com/v0/item/${ids[0]}.json`);
```

### Google Trends (Unofficial)

```javascript
// Use pytrends Python library via subprocess, or:
// Use trends.google.com RSS feeds
const trendsRSS = `https://trends.google.com/trends/trendingsearches/daily/rss?geo=US`;
```

### Future: DataForSEO (Paid, Full SERP)

For competitor analysis, consider DataForSEO API:
- SERP data for target keywords
- Content extraction from top-ranking pages
- TF-IDF analysis of competitor content

---

## CLI Subcommands

```bash
# Install and register with Claude Code
thetacog-mcp install

# Manual commands for testing
thetacog-mcp content-trends --categories ai,physics
thetacog-mcp content-align --slug my-post
thetacog-mcp content-suggest --topic "AI agents" --persona enterprise-buyer
thetacog-mcp content-score --all --threshold 60
```

---

## Error Handling

| Error | Cause | Response |
|-------|-------|----------|
| `SLUG_NOT_FOUND` | MDX file doesn't exist | "Post not found: {slug}.mdx" |
| `TREND_API_ERROR` | HackerNews/Google Trends down | Return cached data with warning |
| `CACHE_EXPIRED` | Trends cache >15min old | Auto-refresh, return fresh data |
| `SCORE_BELOW_THRESHOLD` | CI mode, score < threshold | Exit code 1, list blocking issues |
| `MDX_PARSE_ERROR` | Invalid MDX in post | Skip scoring, report error |

---

## Implementation Checklist

- [ ] Add content alignment tables to SQLite init in `server.js`
- [ ] Implement `content-trends` tool handler
  - [ ] HackerNews API integration
  - [ ] Google Trends RSS parsing
  - [ ] Brand fit scoring using `VOICE_MARKERS`
  - [ ] 15-minute cache with expiry
- [ ] Implement `content-align` tool handler
  - [ ] Reuse `analyzePost()` from existing script
  - [ ] Add brand voice scoring
  - [ ] Add trend alignment scoring
  - [ ] Generate action items with impact estimates
- [ ] Implement `content-suggest` tool handler
  - [ ] Trend-aware angle generation
  - [ ] ShortRank A-K outline template
  - [ ] Liability angle extraction
  - [ ] Internal link suggestions
- [ ] Implement `content-score` tool handler
  - [ ] Batch scoring support
  - [ ] CI/CD exit codes
  - [ ] Minimal output for fast processing
- [ ] Add to ListToolsRequestSchema
- [ ] Update CHANGELOG.md
- [ ] Update README.md with content alignment documentation

---

## Scoring Algorithm

### Content Score Calculation

```javascript
function calculateContentScore(brandVoice, seo, trendAlignment) {
  // Weights based on ThetaCoach priorities
  const weights = {
    brand_voice: 0.40,   // Most important - defines identity
    seo: 0.35,           // Discovery and reach
    trend_alignment: 0.25 // Timeliness and relevance
  };

  const score =
    brandVoice * weights.brand_voice +
    seo * weights.seo +
    trendAlignment * weights.trend_alignment;

  return Math.round(score);
}

function getGrade(score) {
  if (score >= 90) return 'A';
  if (score >= 80) return 'B';
  if (score >= 70) return 'C';
  if (score >= 60) return 'D';
  return 'F';
}
```

### Brand Voice Scoring

```javascript
function scoreBrandVoice(text) {
  const scores = {
    technical_depth: countMarkerMatches(text, VOICE_MARKERS.technical_depth) / 5 * 100,
    challenger_sales: countMarkerMatches(text, VOICE_MARKERS.challenger_sales) / 3 * 100,
    tesseract_physics: countMarkerMatches(text, VOICE_MARKERS.tesseract_physics) / 4 * 100,
    contrarian_insight: countMarkerMatches(text, VOICE_MARKERS.contrarian_insight) / 2 * 100
  };

  // Cap at 100
  Object.keys(scores).forEach(k => scores[k] = Math.min(100, scores[k]));

  // Weighted average (technical depth matters most)
  return (
    scores.technical_depth * 0.30 +
    scores.challenger_sales * 0.25 +
    scores.tesseract_physics * 0.25 +
    scores.contrarian_insight * 0.20
  );
}
```

---

## Usage Examples

### Example 1: Pre-Writing Research

```
User: "I want to write about AI agent security"

Claude: [calls content-trends for AI category]
Claude: [calls content-suggest with topic "AI agent security"]
Claude: "Here's what's trending in AI agent security right now, and three angles that fit ThetaCoach's brand voice:

1. 'The Lethal Trifecta 2.0' - spicy take on Schneier's warning, 92% brand voice score
2. 'The Physics Fix Your CISO Missed' - technical depth angle, 88% brand voice score
3. 'Who Owns the Errors?' - liability angle for enterprise buyers, 90% brand voice score

The 'AI Agent Security' trend is rising fast - recommend publishing within 5 days."
```

### Example 2: Draft Alignment Check

```
User: "Check my draft at /blog/new-ai-security-post"

Claude: [calls content-align with slug]
Claude: "Your Content Score is 72/100 (Grade C). Here's the breakdown:

- Brand Voice: 80/100 (good technical depth, needs more contrarian hooks)
- SEO: 68/100 (word count low, missing internal links)
- Trend Alignment: 68/100 (mentions AI security but misses Claude 4 connection)

Top 3 fixes to reach 85+:
1. Add 300 more words in section E (+8 points)
2. Link to the Schneier post (+5 points)
3. Add paragraph about Claude 4's agentic capabilities (+4 points)"
```

### Example 3: CI/CD Integration

```bash
# In GitHub Actions workflow
- name: Check Content Scores
  run: |
    thetacog-mcp content-score --all --threshold 60 --format ci
    if [ $? -ne 0 ]; then
      echo "Some posts below quality threshold"
      exit 1
    fi
```

---

## References

- Existing SEO Scripts: `/scripts/analyze-blog-seo.js`, `/scripts/optimize-blog-seo.js`
- SEO Data: `/public/seo-data.json`
- CRM MCP Pattern: `/packages/thetacoach-crm-mcp/server.js`
- ThetaCog MCP Pattern: `/packages/thetacog-mcp/server.js`
- RetroAge Spec: `/packages/thetacog-mcp/RETROAGE-SPEC.md`
- MDX Rules: `/CLAUDE.md` (forbidden characters section)
- Brand Themes: `/scripts/optimize-blog-seo.js` (BRAND_THEMES object)
- Blog Post Format: `/CLAUDE.md` (ShortRank A-K structure)

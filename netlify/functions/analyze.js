// netlify/functions/analyze.js

const axios = require("axios");

exports.handler = async (event) => {
  // Only allow POST requests
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: "Method not allowed" }),
    };
  }

  try {
    const { data, siteInfo } = JSON.parse(event.body || "{}");

    const apiKey = process.env.PERPLEXITY_API_KEY;
    if (!apiKey) {
      return {
        statusCode: 500,
        body: JSON.stringify({
          error:
            "API key not configured. Please add PERPLEXITY_API_KEY to Netlify environment variables.",
        }),
      };
    }

    if (!data || !Array.isArray(data) || data.length === 0) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "No observations provided" }),
      };
    }

    const safeSiteName = (siteInfo && siteInfo.siteName) || "Not specified";
    const safeInspector =
      (siteInfo && siteInfo.inspectorName) || "Not specified";
    const safeDate =
      (siteInfo && siteInfo.inspectionDate) || "Not specified";

    // ---------- Helpers ----------

    function normRisk(r) {
      return String(r || "MEDIUM").toUpperCase();
    }

    function getDate(obs) {
      return (
        obs.date ||
        obs.observationDate ||
        obs.created_at ||
        obs.created ||
        obs.timestamp ||
        ""
      );
    }

    function formatDateForText(d) {
      if (!d) return "Date n/a";
      return String(d);
    }

    // ---------- Compute statistics on ALL observations ----------

    const totalObservations = data.length;
    const riskCount = { HIGH: 0, MEDIUM: 0, LOW: 0 };
    const categories = {};
    const locations = new Set();

    data.forEach((obs) => {
      const risk = normRisk(obs.risk);
      riskCount[risk] = (riskCount[risk] || 0) + 1;

      const cat = obs.category || "Unknown";
      categories[cat] = (categories[cat] || 0) + 1;

      if (obs.location) locations.add(obs.location || "Unknown");
    });

    const topCategories = Object.entries(categories)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);

    const statistics = {
      totalObservations,
      riskDistribution: riskCount,
      topCategories,
      locationsAffected: Array.from(locations).length,
    };

    // ---------- Identify repeating patterns (category + location) ----------

    const patternMap = {}; // key: "category|location" -> array of obs

    data.forEach((obs) => {
      const cat = obs.category || "Unknown";
      const loc = obs.location || "Unknown location";
      const key = `${cat}|${loc}`;
      if (!patternMap[key]) patternMap[key] = [];
      patternMap[key].push(obs);
    });

    const repeatingClusters = Object.values(patternMap)
      .filter((arr) => arr.length >= 3) // "repetitive" threshold
      .sort((a, b) => b.length - a.length); // biggest clusters first

    // ---------- Build example set: critical + repetitive ----------

    const MAX_EXAMPLES = 60;
    const exampleObs = [];

    // 1) All HIGH risk incidents (up to 30), sorted by date (newest first)
    const criticalHigh = data
      .filter((o) => normRisk(o.risk) === "HIGH")
      .sort((a, b) => {
        const da = new Date(getDate(a) || "1970-01-01").getTime();
        const db = new Date(getDate(b) || "1970-01-01").getTime();
        return db - da;
      })
      .slice(0, 30);

    criticalHigh.forEach((obs) => {
      if (exampleObs.length < MAX_EXAMPLES) {
        exampleObs.push(obs);
      }
    });

    // 2) Repeating pattern examples (clusters with >=3 observations)
    for (const cluster of repeatingClusters) {
      if (exampleObs.length >= MAX_EXAMPLES) break;
      // take up to 3 examples from each cluster
      for (let i = 0; i < cluster.length && i < 3; i++) {
        if (exampleObs.length >= MAX_EXAMPLES) break;
        exampleObs.push(cluster[i]);
      }
    }

    // 3) Fallback: if still small, add a few more Medium/Low
    if (exampleObs.length < 10) {
      const extras = data
        .filter((o) => normRisk(o.risk) !== "HIGH")
        .slice(0, 10);
      extras.forEach((obs) => {
        if (exampleObs.length < MAX_EXAMPLES) {
          exampleObs.push(obs);
        }
      });
    }

    function formatExample(obs, index) {
      const risk = normRisk(obs.risk);
      const cat = obs.category || "Unknown";
      const loc = obs.location || "Unknown location";
      const dateText = formatDateForText(getDate(obs));
      const status = obs.status || "Unknown";
      const desc = obs.description || "";

      return `${index}. ${dateText} – [${risk}] ${cat} at ${loc} (Status: ${status})
   ${desc}`;
    }

    const examplesText = exampleObs
      .map((obs, i) => formatExample(obs, i + 1))
      .join("\n\n");

    const totalHigh = riskCount.HIGH || 0;
    const totalMedium = riskCount.MEDIUM || 0;
    const totalLow = riskCount.LOW || 0;
    const pctHigh =
      totalObservations > 0
        ? Math.round((totalHigh / totalObservations) * 100)
        : 0;
    const highPctText =
      totalObservations > 0 ? `${pctHigh}%` : "0%";

    const topCategoriesText =
      topCategories.length > 0
        ? topCategories.map(([cat, count]) => `${cat} (${count})`).join(", ")
        : "n/a";

    // ---------- Prompt: focus on critical + repetitive issues + dates ----------

    const summary = `
Generate a comprehensive Occupational Safety Analysis Report for ${safeSiteName} covering the period ${safeDate}.
The report is an annual summary intended for management and must focus especially on:
- critical HIGH risk incidents, and
- repetitive patterns (similar issues happening again and again).

CONTEXT
- Sites / cost centers: ${safeSiteName}
- Period: ${safeDate}
- Prepared by: ${safeInspector}

OVERALL STATISTICS FOR THE PERIOD
- Total observations: ${totalObservations}
- Risk breakdown:
  - HIGH: ${totalHigh} (${highPctText} of all observations)
  - MEDIUM: ${totalMedium}
  - LOW: ${totalLow}
- Top categories (by frequency): ${topCategoriesText}
- Number of distinct locations affected: ${statistics.locationsAffected}

REPRESENTATIVE EXAMPLE OBSERVATIONS
The following incidents are selected examples. They include:
- all available HIGH risk cases (up to a cap), and
- examples from the most repetitive patterns (same category and location appearing many times).
Each line includes the observation date, risk level, category, location, status and a short description.

${examplesText}

Use these examples, together with the overall statistics, to identify which risks are critical and which issues repeat over time. 
When you describe an issue, mention dates from these examples (e.g. “On 2025-10-16 at [site] ...”) to show when problems occurred.

TASK
Based on this information, generate a comprehensive Occupational Safety Analysis Report that includes the following sections:

1. Executive Summary
   - Concise overview of the overall safety situation at the sites.
   - Clear risk breakdown (HIGH / MEDIUM / LOW percentages).
   - Highlight the most important critical and repetitive issues, referencing dates where helpful.
   - Tone: professional with medium–high urgency.

2. Risk Distribution Analysis
   - Analyse how risk is distributed between HIGH, MEDIUM and LOW.
   - Explain which types of incidents dominate HIGH risk.
   - Comment on whether the risk profile indicates acceptable control, emerging concerns or obvious weaknesses.

3. Top Critical and Recurrent Issues
   - Present a ranked list (for example top 5–7) of the most important issues, focusing on:
     - HIGH risk incidents, and
     - problems that repeat across dates or sites (recurrent hazards).
   - For each issue, provide:
     - a short title,
     - risk level(s),
     - typical sites or cost centres,
     - examples with dates (e.g. “On 2025-10-16 and 2025-11-03 similar lighting issues were observed at ...”),
     - short explanation of consequences if not fixed.

4. Categorized Issues and Patterns
   - Group observations by category (lighting, slips/trips, threatening behaviour, ergonomics, housekeeping, fire/electrical, structural hazards, etc.).
   - Describe how often they appear and where they repeat (same sites / locations).
   - Point out categories that are mostly MEDIUM risk but occur frequently and could escalate.

5. Root Cause Analysis
   - Identify likely root causes behind the observed critical and repetitive issues, such as:
     - maintenance gaps
     - training or orientation deficiencies
     - unclear procedures or responsibilities
     - physical layout / design issues
     - insufficient inspection or follow-up
   - Summarise these in 3–7 clear bullet points linked to the issues above.

6. Recommendations and Priority Actions
   - Provide concrete actions grouped into:
     - Immediate actions (for serious HIGH risks and urgent problems)
     - Short-term actions (next few weeks)
     - Long-term development actions (structural, process or training changes)
   - For each recommendation:
     - describe what should be done, where, and why,
     - link it to specific issues or patterns (mention dates where helpful),
     - explain how it will reduce risk.

7. Compliance Standards
   - Briefly reference relevant occupational safety regulations and standards,
     such as the Occupational Safety Act 738/2002 and typical Finnish/EU requirements
     (safe working environment, hazard identification, PPE and training obligations, lighting and safe access).
   - Indicate where the observations suggest possible compliance gaps, without making strict legal claims.

8. Performance Metrics
   - Describe the current state using practical metrics (for example:
     total observations, proportion of HIGH risks, main categories by count).
   - Suggest target metrics such as:
     - zero HIGH risk observations,
     - reduction of MEDIUM risks in key recurring categories,
     - completion rates for training or corrective actions.
   - Propose how progress could be monitored over time.

9. Implementation Timeline
   - Propose a realistic timeline for the recommended actions:
     - Immediate (0–7 days)
     - Short term (1–4 weeks)
     - Medium term (1–3 months)
     - Long term (3+ months)
   - Allocate action types to these phases logically, with special attention to critical and repetitive issues.

10. Conclusion
   - Provide a short closing assessment of overall safety level and urgency.
   - Highlight where management should focus attention next.
   - Reinforce the importance of eliminating HIGH risks and systematically addressing recurring problems.

STYLE REQUIREMENTS
- Use clear headings and subheadings following the structure above.
- Focus especially on critical (HIGH) risks and repetitive patterns, referring to dates when describing key examples.
- Use neutral, professional business language with a medium–high urgency tone.
- Do NOT mention artificial intelligence, models, or that the report was generated.
- Do NOT invent numbers; rely on the statistics and patterns provided.
- Aim for a length that would fit comfortably in about 2–4 A4 pages when converted to PDF.

Now, based strictly on the statistics and dated example observations above, write the full Occupational Safety Analysis Report following this structure.
    `.trim();

    // ---------- Call Perplexity API (sonar) ----------

    const response = await axios.post(
      "https://api.perplexity.ai/chat/completions",
      {
        model: "sonar",
        messages: [{ role: "user", content: summary }],
        max_tokens: 4000,
        temperature: 0.7,
      },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        timeout: 60000, // client-side timeout; remote may still have its own limit
      }
    );

    if (!response.data.choices || !response.data.choices[0]) {
      return {
        statusCode: 500,
        body: JSON.stringify({ error: "No response from report service" }),
      };
    }

    const analysis = response.data.choices[0].message.content;

    return {
      statusCode: 200,
      body: JSON.stringify({
        analysis,
        statistics,
      }),
    };
  } catch (error) {
    console.error("Error in analyze function:", error);

    let errorMsg = error.message || "Server error";
    if (error.response && error.response.status === 401) {
      errorMsg =
        "Invalid API key - check PERPLEXITY_API_KEY in Netlify environment.";
    } else if (error.response && error.response.status === 429) {
      errorMsg =
        "Too many requests to the API - please wait a moment and try again.";
    } else if (error.response && error.response.status === 500) {
      errorMsg = "Perplexity API error - service temporarily unavailable.";
    } else if (error.response && error.response.status === 504) {
      errorMsg =
        "The report service timed out while processing this request. Try a smaller date range or fewer KPs.";
    }

    return {
      statusCode: 500,
      body: JSON.stringify({
        error: errorMsg,
        details:
          error.response && error.response.data ? error.response.data : null,
      }),
    };
  }
};

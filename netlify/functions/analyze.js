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

    // ---------- Compute statistics on ALL observations ----------

    const totalObservations = data.length;
    const riskCount = { HIGH: 0, MEDIUM: 0, LOW: 0 };
    const categories = {};
    const locations = new Set();

    function normRisk(r) {
      return String(r || "MEDIUM").toUpperCase();
    }

    data.forEach((obs) => {
      const risk = normRisk(obs.risk);
      riskCount[risk] = (riskCount[risk] || 0) + 1;

      const cat = obs.category || "Unknown";
      categories[cat] = (categories[cat] || 0) + 1;

      if (obs.location) locations.add(obs.location);
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

    // ---------- Build a trimmed list for the prompt --------------

    const MAX_OBS_FOR_PROMPT = 140;

    const highs = data.filter((o) => normRisk(o.risk) === "HIGH");
    const mediums = data.filter((o) => normRisk(o.risk) === "MEDIUM");
    const lows = data.filter((o) => normRisk(o.risk) === "LOW");

    const trimmed = [];

    function takeFrom(arr) {
      for (let i = 0; i < arr.length; i++) {
        if (trimmed.length >= MAX_OBS_FOR_PROMPT) return;
        trimmed.push(arr[i]);
      }
    }

    takeFrom(highs);
    takeFrom(mediums);
    takeFrom(lows);

    // If somehow there are still none, fall back to original data
    const promptData = trimmed.length ? trimmed : data;

    const observationsText = promptData
      .map(
        (obs, i) =>
          `${i + 1}. [${normRisk(obs.risk)}] ${obs.category || "Unknown"} at ${
            obs.location || "Unknown location"
          } (Status: ${obs.status || "Unknown"})\n` +
          `Description: ${obs.description || ""}`
      )
      .join("\n\n");

    const totalHigh = riskCount.HIGH || 0;
    const totalMedium = riskCount.MEDIUM || 0;
    const totalLow = riskCount.LOW || 0;
    const pctHigh =
      totalObservations > 0
        ? Math.round((totalHigh / totalObservations) * 100)
        : 0;

    const highPctText =
      totalObservations > 0
        ? `${pctHigh}%`
        : "0%";

    const topCategoriesText =
      topCategories.length > 0
        ? topCategories.map(([cat, count]) => `${cat} (${count})`).join(", ")
        : "n/a";

    // ---------- PROMPT MATCHING YOUR SPEC -------------------------

    const summary = `
Generate a comprehensive Occupational Safety Analysis Report for ${safeSiteName} covering the period ${safeDate}. 
Base it on the quantitative statistics and safety observations provided below.

The report is for professional use and should be suitable to present directly to management or the customer.

CONTEXT
- Sites / cost centers: ${safeSiteName}
- Period: ${safeDate}
- Prepared by: ${safeInspector}

OVERALL STATISTICS
- Total observations: ${totalObservations}
- Risk breakdown:
  - HIGH: ${totalHigh} (${highPctText} of all observations)
  - MEDIUM: ${totalMedium}
  - LOW: ${totalLow}
- Top categories (by frequency): ${topCategoriesText}
- Number of distinct locations affected: ${statistics.locationsAffected}

You are also given example observations in free-text form. 
Each observation includes a risk level, category, location, status and description of the situation and measures:

${observationsText}

TASK
Using this information, generate a comprehensive Occupational Safety Analysis Report that follows this exact structure and intent:

1. Executive Summary
   - Provide a concise overview of the overall safety situation at the sites.
   - Include a clear risk breakdown (HIGH / MEDIUM / LOW) and express percentages where relevant.
   - Highlight the key themes (for example: firearm or weapon incidents, lighting deficiencies, slips/trips, ergonomics, low ceilings, fire/electrical risks, threatening situations).
   - Use a medium–high urgency tone while remaining professional.

2. Risk Distribution Analysis
   - Analyse how risk is distributed between HIGH, MEDIUM and LOW.
   - Comment on what types of incidents dominate each risk level.
   - Explain whether the risk profile suggests acceptable control, emerging concerns, or clear weaknesses.

3. Top 5 Critical Issues
   - Rank the five most critical issues by combined risk and potential consequences.
   - For each issue: give a short title, risk level(s), typical locations or KPs, and a brief explanation of the consequences if not addressed.
   - Use examples from the observations (for instance: firearm discovery, repeated lighting deficiencies, slips from cleaning, head strikes due to low ceilings, threatening situations).

4. Categorized Issues with Frequency and Patterns
   - Group observations by category (e.g. lighting, slips/trips, threatening behaviour, ergonomics, housekeeping, fire/electrical, structural hazards).
   - Describe frequencies and patterns, including where problems repeat across different sites.
   - Mention if some categories appear mainly as MEDIUM risk but could escalate.

5. Root Cause Analysis
   - Identify likely root causes behind the patterns you see, such as:
     - maintenance gaps
     - insufficient training or orientation
     - unclear procedures or responsibilities
     - physical layout / design issues
     - inadequate inspection or follow-up
   - Summarise these in 3–7 clear bullet points linked to the observations.

6. Recommendations with Priority Action Items
   - Provide concrete actions grouped into:
     - Immediate actions (for the most serious HIGH risks or urgent issues)
     - Short-term actions (to be addressed in the coming weeks)
     - Long-term development actions (structural, process or training changes)
   - Each recommendation should explain what to do, where, and why, and should clearly reduce identified risks.

7. Compliance Standards
   - Briefly reference relevant occupational safety regulations and standards, 
     such as the Occupational Safety Act 738/2002 and other typical Finnish or EU requirements 
     (e.g. obligations concerning safe working environment, hazard identification, PPE, training, lighting and safe access).
   - Indicate where the observations suggest potential gaps in compliance without making strict legal claims.

8. Performance Metrics
   - Describe the current state using practical metrics (for example: total observations, proportion of HIGH risks, main categories by count).
   - Suggest target metrics such as:
     - zero HIGH risk observations
     - reduction of MEDIUM risks in key categories
     - completion rates for training or corrective actions
   - Propose how progress could be tracked over time.

9. Implementation Timeline
   - Propose a realistic timeline for the recommended actions:
     - Immediate (0–7 days)
     - Short term (1–4 weeks)
     - Medium term (1–3 months)
     - Long term (3+ months)
   - Assign action types to these phases in a logical way.

10. Conclusion
   - Provide a short closing assessment of overall safety level and urgency.
   - Highlight where management should focus attention next.
   - Reinforce key metrics and the importance of aiming for zero HIGH risks.

STYLE REQUIREMENTS
- Use clear headings and subheadings following the structure above.
- Use neutral, professional business language with a medium–high urgency tone.
- Quantify impacts wherever possible (for example: number of incidents, percentage of HIGH risks, repetition across sites).
- Do NOT mention artificial intelligence, models, or that the report was generated.
- Do NOT invent numbers; rely on the statistics and patterns in the observations.
- Aim for a length that would fit comfortably in about 2–4 A4 pages when converted to PDF.

Now, based strictly on the statistics and observations provided, write the full Occupational Safety Analysis Report following this structure.
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
        timeout: 60000, // 60s client-side timeout
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

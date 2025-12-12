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

    // Get API key from environment variable
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

    // ---------------- Prepare prompt (no AI wording) -----------------

    const observationsText = data
      .map(
        (obs, i) =>
          `${i + 1}. [${obs.risk || "MEDIUM"}] ${obs.category || "Unknown"} at ${
            obs.location || "Unknown location"
          } (Status: ${obs.status || "Unknown"})` +
          ` Description: ${obs.description || ""}`
      )
      .join("\n\n");

    const summary = `
You are an occupational safety specialist.

SITE INFORMATION
- Site or cost centers: ${safeSiteName}
- Inspector: ${safeInspector}
- Period: ${safeDate}

OBSERVATIONS DATA
There are ${data.length} observations. Each observation has:
- risk level (HIGH, MEDIUM, LOW)
- category
- location
- status
- a free-text description of the situation and measures.

Here are the observations:
${observationsText}

TASK
Write a clear, professional OCCUPATIONAL SAFETY ANALYSIS report that can be used directly in a PDF for management. Use neutral, factual language and do not mention that this text was generated or that any model was used.

STRUCTURE
Use the following structure and headings (in ALL CAPS):

OCCUPATIONAL SAFETY ANALYSIS
<site or KP information> – <period>

SUMMARY
- Total observations: <number> cases
- High-risk cases: <number and % of total> (risk = HIGH)
- Short overview: 2–4 sentences that describe the overall safety situation and main themes.

RISK DISTRIBUTION
- Number and percentage of HIGH, MEDIUM and LOW risk observations.
- Short interpretation of what this distribution means for safety.

SITE / COST CENTER ANALYSIS
If possible, group observations by site or KP (based on the locations or descriptions). For each group, write:
- Total cases and number of HIGH risk cases.
- A short paragraph describing typical issues for this group.
- A short bullet list of the most important example cases with dates, category and location.

CRITICAL INCIDENTS
List and explain the most serious situations (mainly HIGH risk):
- Threatening situations and violence
- Fire and electrical hazards
- Sharp object and cutting hazards
- Other critical situations
For each item: date – location – one-sentence description and why it is critical.

THEMES AND ROOT CAUSES
Summarise the main recurring themes and likely root causes, for example:
- lack of equipment or PPE
- unclear procedures
- physical environment or layout issues
- competence / training gaps
Use 3–6 concise bullet points.

RECOMMENDATIONS FOR NEXT PERIOD
Provide a list of concrete, prioritised recommendations linked directly to the findings:
1. Immediate actions for the most critical risks
2. Short-term improvements (next weeks)
3. Medium- and long-term development actions
Explain briefly why each action is important and how it reduces risk.

CONCLUSION
Provide a short closing paragraph that summarises:
- overall safety level
- urgency of actions
- suggested focus areas for follow-up.

Format the report clearly with headings and bullet points where helpful.
Do NOT mention artificial intelligence, models, or that the report was generated.
`.trim();

    // ---------------- Call Perplexity API (same as your original) -----

    const response = await axios.post(
      "https://api.perplexity.ai/chat/completions",
      {
        model: "sonar", // keep the known-working model
        messages: [{ role: "user", content: summary }],
        max_tokens: 4000,
        temperature: 0.7,
      },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        timeout: 30000,
      }
    );

    if (!response.data.choices || !response.data.choices[0]) {
      return {
        statusCode: 500,
        body: JSON.stringify({ error: "No response from report service" }),
      };
    }

    const analysis = response.data.choices[0].message.content;

    // ---------------- Calculate statistics (same as before) -----------

    const riskCount = { HIGH: 0, MEDIUM: 0, LOW: 0 };
    const categories = {};
    const locations = new Set();

    data.forEach((obs) => {
      const risk = (obs.risk || "MEDIUM").toUpperCase();
      riskCount[risk] = (riskCount[risk] || 0) + 1;

      const cat = obs.category || "Unknown";
      categories[cat] = (categories[cat] || 0) + 1;

      if (obs.location) locations.add(obs.location);
    });

    const topCategories = Object.entries(categories)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);

    return {
      statusCode: 200,
      body: JSON.stringify({
        analysis,
        statistics: {
          totalObservations: data.length,
          riskDistribution: riskCount,
          topCategories,
          locationsAffected: Array.from(locations).length,
        },
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
    }

    return {
      statusCode: 500,
      body: JSON.stringify({
        error: errorMsg,
        details: error.response && error.response.data
          ? error.response.data
          : null,
      }),
    };
  }
};

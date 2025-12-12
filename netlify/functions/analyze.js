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

    // ---------- EXECUTIVE SUMMARY PROMPT -------------------------

    const summary = `
You are an occupational safety specialist.

CONTEXT
- Site or cost centers: ${safeSiteName}
- Period: ${safeDate}
- Inspector: ${safeInspector}

QUANTITATIVE OVERVIEW
- Total observations: ${totalObservations}
- Risk distribution:
  - HIGH: ${totalHigh} (${pctHigh}% of all observations)
  - MEDIUM: ${totalMedium}
  - LOW: ${totalLow}
- Top categories: ${
      topCategories.length
        ? topCategories.map(([cat, count]) => `${cat} (${count})`).join(", ")
        : "n/a"
    }

You are also given representative example observations below. Each one includes
a risk level, category, location, status and description:

${observationsText}

TASK
Write a concise EXECUTIVE SUMMARY in English for management based on the data above.
The summary must be dynamic and tailored to these specific numbers and patterns,
not generic boilerplate.

STRUCTURE
1. Opening paragraph (2–3 sentences)
   - Describe the overall safety situation at the sites.
   - Mention the total number of observations and the balance between HIGH,
     MEDIUM and LOW risk.
   - Highlight the main themes you see in the data (for example slips/trips,
     lighting, threatening situations, ergonomics, fire/electrical, etc.).

2. Key findings (3–6 bullet points)
   - Each bullet should have a short title and 1–2 sentences of explanation.
   - Connect the bullet to the data: risk level(s), categories, example sites,
     and whether issues are repeated or isolated.
   - Prioritise HIGH risk and clearly impactful patterns.

3. Forward-looking conclusion (1–2 sentences)
   - Briefly state how urgent the situation is.
   - Suggest the main areas management should focus on next.

STYLE RULES
- Use neutral, professional business language.
- Do NOT mention artificial intelligence, models, or that the text was generated.
- Do NOT invent numbers; use the statistics above and the patterns in the examples.
- Keep total length roughly 200–400 words.

Write only the executive summary text (no extra notes or explanations).
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

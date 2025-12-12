// netlify/functions/analyze.js

const axios = require("axios");

/**
 * Netlify Function: Analyze safety observations and generate a structured report.
 *
 * Expects POST body:
 * {
 *   data: [
 *     { risk, category, location, status, description },
 *     ...
 *   ],
 *   siteInfo: {
 *     siteName,
 *     inspectorName,
 *     inspectionDate
 *   }
 * }
 *
 * Returns:
 * {
 *   analysis: "<long text report>",
 *   statistics: {
 *     totalObservations: number,
 *     riskDistribution: { HIGH, MEDIUM, LOW },
 *     topCategories: [[categoryName, count], ...]
 *   }
 * }
 */

exports.handler = async (event) => {
  try {
    // --- CORS preflight (safe even if not needed) ---
    if (event.httpMethod === "OPTIONS") {
      return {
        statusCode: 200,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "POST,OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
        },
        body: "",
      };
    }

    // --- Only allow POST ---
    if (event.httpMethod !== "POST") {
      return {
        statusCode: 405,
        body: JSON.stringify({ error: "Method not allowed. Use POST." }),
      };
    }

    if (!event.body) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "Missing request body." }),
      };
    }

    // --- Parse body ---
    let parsed;
    try {
      parsed = JSON.parse(event.body);
    } catch (err) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "Invalid JSON in request body." }),
      };
    }

    const data = parsed.data;
    const siteInfo = parsed.siteInfo || {};

    if (!Array.isArray(data) || data.length === 0) {
      return {
        statusCode: 400,
        body: JSON.stringify({
          error: "Field 'data' must be a non-empty array of observations.",
        }),
      };
    }

    const effectiveSiteInfo = {
      siteName: siteInfo.siteName || "Unknown site",
      inspectorName: siteInfo.inspectorName || "Not specified",
      inspectionDate: siteInfo.inspectionDate || "Not specified",
    };

    // ---------------- Basic statistics for the UI -------------------------

    const totalObservations = data.length;
    const riskDistribution = { HIGH: 0, MEDIUM: 0, LOW: 0 };
    const categoryCounts = {};

    data.forEach((obs) => {
      const r = String(obs.risk || "MEDIUM").toUpperCase();
      if (riskDistribution[r] === undefined) {
        riskDistribution[r] = 0;
      }
      riskDistribution[r] += 1;

      const cat = (obs.category || "Unknown").trim();
      categoryCounts[cat] = (categoryCounts[cat] || 0) + 1;
    });

    const topCategories = Object.entries(categoryCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);

    const statistics = {
      totalObservations: totalObservations,
      riskDistribution: riskDistribution,
      topCategories: topCategories,
    };

    // ---------------- Get API key -------------------------

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

    // ---------------- Build prompt (no template literals) ------------------

    const lines = [];

    lines.push("You are an occupational safety specialist.");
    lines.push("");
    lines.push("You receive:");
    lines.push('- "data": a list of safety observations with fields:');
    lines.push("  - risk: HIGH, MEDIUM or LOW");
    lines.push("  - category: observation category");
    lines.push("  - location: customer site, hotel, etc.");
    lines.push("  - status: status from the Hailer export");
    lines.push("  - description: combined description of the situation, prevention and measures");
    lines.push('- "siteInfo": context for the report:');
    lines.push("  - siteName: label for the whole report (can be multiple KPs)");
    lines.push("  - inspectorName: who prepared the report");
    lines.push("  - inspectionDate: period covered by the data");
    lines.push("");
    lines.push(
      "Write a clear, professional OCCUPATIONAL SAFETY ANALYSIS report in English that can be used directly in a PDF for management."
    );
    lines.push("");
    lines.push("Use this structure EXACTLY (headings in ALL CAPS):");
    lines.push("");
    lines.push("OCCUPATIONAL SAFETY ANALYSIS");
    lines.push("<siteName> – <inspectionDate>");
    lines.push("");
    lines.push("SUMMARY");
    lines.push("- Total observations: <number> cases");
    lines.push("- Period: <inspectionDate or derived from the data>");
    lines.push("- High-risk cases: <number and % of total> (risk = HIGH)");
    lines.push(
      "- Short overview: 2–4 sentences that describe the general situation and main themes."
    );
    lines.push("");
    lines.push(
      "Then write sections for the main groups of sites or cost centers if they are obvious from the locations or descriptions. If you cannot reliably split by site, write one consolidated section."
    );
    lines.push("");
    lines.push("For each section, follow this pattern:");
    lines.push("");
    lines.push('SECTION TITLE (for example "KP 810–86 – Main customer sites")');
    lines.push("Total cases: <N> | High-risk: <N> (<%>");
    lines.push("");
    lines.push("ALL CASES WITH DATES:");
    lines.push("Date    Category    Location    Issue");
    lines.push(
      "- <short line per important observation: date – category – site – one-sentence issue>"
    );
    lines.push("");
    lines.push(
      "Focus first on HIGH risk and unusual or representative cases. Use concise, neutral language."
    );
    lines.push("");
    lines.push("After the table lines for that section, add:");
    lines.push("");
    lines.push("Key Issues:");
    lines.push(
      "1. <short explanation that groups together the main themes for this section>"
    );
    lines.push("2. <another key issue with dates in brackets if helpful>");
    lines.push("3. <optional additional point>");
    lines.push("");
    lines.push("After all sections, write:");
    lines.push("");
    lines.push("CRITICAL INCIDENTS SUMMARY (All high-risk cases)");
    lines.push("Threatening situations:");
    lines.push("- <date – location – one sentence, if any>");
    lines.push("");
    lines.push("Fire and electrical hazards:");
    lines.push("- <date – location – one sentence, if any>");
    lines.push("");
    lines.push("Sharp object and cutting hazards:");
    lines.push("- <date – location – one sentence, if any>");
    lines.push("");
    lines.push("Other high-risk situations:");
    lines.push("- <date – location – one sentence, if any>");
    lines.push("");
    lines.push("Finally, write:");
    lines.push("");
    lines.push("RECOMMENDATIONS FOR NEXT PERIOD");
    lines.push("1. <concrete recommendation based on patterns in the data>");
    lines.push(
      "2. <another recommendation, focusing on prevention and training>"
    );
    lines.push(
      "3. <another recommendation, focusing on monitoring or follow-up>"
    );
    lines.push("(usually 3–6 points total)");
    lines.push("");
    lines.push("IMPORTANT RULES");
    lines.push("- Base everything only on the observations data provided.");
    lines.push(
      "- Never mention artificial intelligence, models, or that the text was generated."
    );
    lines.push(
      "- Use neutral, professional business language and clear, short paragraphs."
    );
    lines.push(
      "- Aim for a length similar to 1–3 A4 pages depending on how many observations there are."
    );
    lines.push("");
    lines.push("Here is the JSON input you must base the report on:");
    lines.push("");

    const jsonInput = {
      data: data,
      siteInfo: effectiveSiteInfo,
    };

    lines.push(JSON.stringify(jsonInput, null, 2));

    const prompt = lines.join("\n");

    // ---------------- Call Perplexity API -------------------------

    const apiUrl = "https://api.perplexity.ai/chat/completions";

    const payload = {
      model: "llama-3.1-sonar-small-128k-online",
      messages: [
        {
          role: "user",
          content: prompt,
        },
      ],
      temperature: 0.4,
      top_p: 0.9,
    };

    const response = await axios.post(apiUrl, payload, {
      headers: {
        Authorization: "Bearer " + apiKey,
        "Content-Type": "application/json",
      },
      timeout: 60000,
    });

    const completion = response.data;
    let analysis = "";

    if (
      completion &&
      completion.choices &&
      completion.choices[0] &&
      completion.choices[0].message &&
      completion.choices[0].message.content
    ) {
      analysis = completion.choices[0].message.content;
    }

    if (!analysis) {
      return {
        statusCode: 502,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
        body: JSON.stringify({
          error: "Report service returned an empty response.",
          statistics: statistics,
        }),
      };
    }

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
      body: JSON.stringify({
        analysis: analysis,
        statistics: statistics,
      }),
    };
  } catch (err) {
    console.error("analyze function error:", err);

    let message = "Unknown error.";
    if (err && err.message) {
      message = err.message;
    } else if (typeof err === "string") {
      message = err;
    }

    return {
      statusCode: 500,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
      body: JSON.stringify({
        error: message,
      }),
    };
  }
};

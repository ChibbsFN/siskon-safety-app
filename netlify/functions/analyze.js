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
    // CORS preflight support (safe even if not strictly needed)
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

    let parsed;
    try {
      parsed = JSON.parse(event.body);
    } catch (err) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "Invalid JSON in request body." }),
      };
    }

    const { data, siteInfo } = parsed;

    if (!Array.isArray(data) || data.length === 0) {
      return {
        statusCode: 400,
        body: JSON.stringify({
          error: "Field 'data' must be a non-empty array of observations.",
        }),
      };
    }

    const effectiveSiteInfo = {
      siteName: siteInfo && siteInfo.siteName ? siteInfo.siteName : "Unknown site",
      inspectorName:
        siteInfo && siteInfo.inspectorName
          ? siteInfo.inspectorName
          : "Not specified",
      inspectionDate:
        siteInfo && siteInfo.inspectionDate
          ? siteInfo.inspectionDate
          : "Not specified",
    };

    // ---------------- Basic statistics for the UI ---------

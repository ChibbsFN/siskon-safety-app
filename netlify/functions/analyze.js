const axios = require('axios');

exports.handler = async (event) => {
  // Only allow POST requests
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    const { data, siteInfo } = JSON.parse(event.body);
    
    // Get API key from environment variable
    const apiKey = process.env.PERPLEXITY_API_KEY;
    
    if (!apiKey) {
      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'API key not configured. Please add PERPLEXITY_API_KEY to Netlify environment variables.' })
      };
    }

    if (!data || data.length === 0) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'No observations provided' })
      };
    }

    // Prepare summary for AI
    const summary = `You are a professional occupational safety expert. Analyze this safety data and provide a comprehensive professional report.

SITE INFORMATION:
- Site: ${siteInfo.siteName}
- Inspector: ${siteInfo.inspectorName}
- Date: ${siteInfo.inspectionDate}

SAFETY OBSERVATIONS (${data.length} total):
${data.map((obs, i) => `${i+1}. [${obs.risk}] ${obs.category} at ${obs.location} (Status: ${obs.status})
   Description: ${obs.description}`).join('\n\n')}

Please provide a comprehensive professional safety analysis report that includes:

1. EXECUTIVE SUMMARY
   - Brief overview of findings
   - Overall risk assessment
   - Key concerns

2. RISK DISTRIBUTION ANALYSIS
   - Number and percentage of HIGH, MEDIUM, LOW risk items
   - Impact assessment

3. CRITICAL FINDINGS
   - Top 5 most critical safety issues identified
   - Why each is critical
   - Potential consequences if not addressed

4. CATEGORIZED ISSUES
   - Group issues by category
   - Frequency of each category
   - Pattern analysis

5. ROOT CAUSE ANALYSIS
   - Common contributing factors
   - Systemic issues identified
   - Underlying problems

6. RECOMMENDATIONS & ACTION ITEMS
   - Immediate actions (HIGH risk items)
   - Short-term improvements (MEDIUM risk)
   - Long-term safety initiatives
   - Priority order

7. COMPLIANCE & STANDARDS
   - Relevant safety standards/regulations potentially violated
   - Compliance gaps

8. PERFORMANCE METRICS
   - Current state metrics
   - Target metrics
   - Success indicators

9. IMPLEMENTATION TIMELINE
   - Immediate (0-7 days)
   - Short-term (1-4 weeks)
   - Medium-term (1-3 months)
   - Long-term (3+ months)

10. CONCLUSION & SUMMARY
    - Overall assessment
    - Urgency level
    - Next steps

Format the report professionally with clear sections, bullet points, and actionable insights.`;

    // Call Perplexity API
    const response = await axios.post('https://api.perplexity.ai/chat/completions', {
      model: 'sonar',
      messages: [{ 
        role: 'user', 
        content: summary 
      }],
      max_tokens: 4000,
      temperature: 0.7
    }, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      timeout: 30000
    });

    if (!response.data.choices || !response.data.choices[0]) {
      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'No response from AI service' })
      };
    }

    const analysis = response.data.choices[0].message.content;

    // Calculate statistics
    const riskCount = { HIGH: 0, MEDIUM: 0, LOW: 0 };
    const categories = {};
    const locations = new Set();
    
    data.forEach(obs => {
      const risk = (obs.risk || 'MEDIUM').toUpperCase();
      riskCount[risk] = (riskCount[risk] || 0) + 1;
      categories[obs.category] = (categories[obs.category] || 0) + 1;
      if (obs.location) locations.add(obs.location);
    });

    const topCategories = Object.entries(categories)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);

    return {
      statusCode: 200,
      body: JSON.stringify({
        analysis: analysis,
        statistics: {
          totalObservations: data.length,
          riskDistribution: riskCount,
          topCategories: topCategories,
          locationsAffected: Array.from(locations).length
        }
      })
    };

  } catch (error) {
    console.error('Error:', error);
    
    // More detailed error handling
    let errorMsg = error.message || 'Server error';
    
    if (error.response?.status === 401) {
      errorMsg = 'Invalid API key - check PERPLEXITY_API_KEY in Netlify environment';
    } else if (error.response?.status === 429) {
      errorMsg = 'Too many requests to API - please wait a moment and try again';
    } else if (error.response?.status === 500) {
      errorMsg = 'Perplexity API error - service temporarily unavailable';
    }

    return {
      statusCode: 500,
      body: JSON.stringify({ 
        error: errorMsg,
        details: error.response?.data?.error || null
      })
    };
  }
};
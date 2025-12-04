
import { getSecret } from "../utils/secrets";
import * as path from "path";
import * as fs from "fs";

// Load leniency config (default to 5 if not configured)
function getLeniency(): number {
  try {
    const possiblePaths = [
      path.join(__dirname, "..", "..", "scripts", "admin-config.json"),
      path.join(process.cwd(), "scripts", "admin-config.json"),
      "./scripts/admin-config.json"
    ];
    
    for (const configPath of possiblePaths) {
      if (fs.existsSync(configPath)) {
        const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
        const leniency = config.leniency || 5;
        return Math.max(1, Math.min(10, leniency)); // Clamp to 1-10
      }
    }
  } catch (err) {
    console.warn("Could not load leniency config, using default:", err);
  }
  return 5; // Default: moderate strictness
}

// Build scoring guidelines based on leniency (1=very strict, 10=very lenient)
function buildScoringGuidelines(leniency: number): string {
  if (leniency <= 3) {
    // Very Strict (1-3)
    return [
      "Technical Scoring Guidelines (VERY STRICT EVALUATION):",
      "- Score 90-100 ONLY for exceptional answers with specific Azure service names, implementation details, quantifiable metrics, and real-world examples",
      "- Score 75-89 for strong technical depth covering ALL key concepts with proper Azure terminology and best practices",
      "- Score 60-74 for adequate understanding but missing specifics or best practices",
      "- Score 40-59 for weak responses showing surface-level knowledge without depth",
      "- Score 20-39 for poor responses with significant gaps or incorrect information",
      "- Below 20 for completely off-topic or irrelevant answers",
      "- DEMAND specific Azure service names (e.g., Azure Front Door, Traffic Manager, Availability Zones)",
      "- REQUIRE concrete implementation steps, not vague concepts",
      "- PENALIZE generic answers that could apply to any cloud provider",
      "- EXPECT quantifiable metrics (SLAs, RTO, RPO, uptime percentages)",
      "- Be critical of missing details and incomplete explanations"
    ].join("\n");
  } else if (leniency <= 6) {
    // Moderate (4-6)
    return [
      "Technical Scoring Guidelines (BALANCED EVALUATION):",
      "- Score 90-100 for excellent answers with specific Azure services and clear implementation approach",
      "- Score 75-89 for good technical knowledge covering most key concepts",
      "- Score 60-74 for adequate understanding with some gaps",
      "- Score 40-59 for basic responses missing important details",
      "- Score 20-39 for weak responses with significant issues",
      "- Below 20 for off-topic or irrelevant answers",
      "- Expect Azure-specific terminology and services",
      "- Look for practical implementation guidance",
      "- Value both depth and breadth of knowledge",
      "- Give credit for demonstrating architectural thinking"
    ].join("\n");
  } else {
    // Lenient (7-10)
    return [
      "Technical Scoring Guidelines (ENCOURAGING EVALUATION):",
      "- Score 90-100 for strong answers showing Azure knowledge and architectural thinking",
      "- Score 75-89 for solid responses covering main concepts",
      "- Score 60-74 for reasonable understanding with room for improvement",
      "- Score 40-59 for basic responses that show some relevant knowledge",
      "- Score 20-39 for responses with major gaps",
      "- Below 20 for completely irrelevant answers",
      "- Appreciate Azure-specific mentions even if not exhaustive",
      "- Value conceptual understanding alongside specific implementation",
      "- Give credit for relevant ideas even if not perfectly articulated",
      "- Be encouraging while identifying growth areas"
    ].join("\n");
  }
}

// Conversational evaluation prompt that maintains context around Azure architecture topics
const buildPrompt = (transcript: string, question: any, conversationHistory?: string, leniency: number = 5) => {
  const keyPhrases = (question.key_phrases || []).map((p:string)=>p.toLowerCase());
  const context = conversationHistory ? `\n\nPrevious conversation context:\n${conversationHistory}` : "";
  
  return [
       "You are evaluating a natural, conversational exchange between a Microsoft Mission Critical Architect and a CTO. The conversation should feel organic and collaborative, not like a Q&A session.",
       "",
       "Evaluate how well the architect:",
       "1. Maintains conversational flow while staying relevant to Azure architecture topics (Well-Architected Framework, resiliency patterns, zonal adoption, multi-region deployments, failure mode analysis, security)",
       "2. Responds naturally to the CTO's questions and concerns",
       "3. Demonstrates deep technical knowledge while keeping it business-focused",
       "4. Builds on previous points in the conversation naturally",
       "",
       "Output ONLY valid JSON with these fields:",
       "- score (0-100 integer): Technical accuracy and relevance to Azure architecture best practices",
       "- matched_phrases (array): Key Azure/architecture concepts mentioned",
       "- missing_phrases (array): Important concepts that should have been covered",
       "- feedback (string): Conversational and technical feedback - acknowledge what was good and suggest improvements naturally",
       "- sentiment (object): { confidence: 0-100, empathy: 0-100, executive_presence: 0-100, professionalism: 0-100 }",
       "- sentiment_feedback (string): Assessment of communication style",
       "- follow_up_suggestion (string): A natural follow-up question or topic the CTO might raise based on this response",
       "",
       "Context - CTO's question/concern: " + (question.question || ""),
       "Expected technical topics: " + keyPhrases.join(", "),
       "Architect's response: " + transcript,
       context,
       "",
       buildScoringGuidelines(leniency),
       "",
       "Sentiment Scoring:",
       "- confidence: Natural authority without arrogance. Comfortable saying 'let me explore that' or 'here's what I recommend'",
       "- empathy: Active listening, acknowledging CTO concerns, collaborative problem-solving tone",
       "- executive_presence: Strategic framing, business impact focus, concise but thorough, comfort with ambiguity",
       "- professionalism: Consultative partnership, respectful dialogue, owning recommendations",
       "",
       "Output JSON now."
  ].join("\n\n");
};

export default async function evaluate(transcript: string, question: any) {
  // Try Azure OpenAI first (if configured). Otherwise fallback to deterministic local scoring.
  const leniency = getLeniency();
  console.log(`Evaluating with leniency level: ${leniency}/10`);
  
  try {
     const endpoint = process.env.AZURE_OPENAI_ENDPOINT || await getSecret("AZURE_OPENAI_ENDPOINT");
     const apiKey = process.env.AZURE_OPENAI_API_KEY || await getSecret("AZURE_OPENAI_API_KEY");
     const deployment = process.env.AZURE_OPENAI_DEPLOYMENT || await getSecret("AZURE_OPENAI_DEPLOYMENT");
     
     if (!endpoint || !apiKey || !deployment) throw new Error("Azure OpenAI not configured");
     
     // Construct full Azure OpenAI chat completions URL
     const fullUrl = `${endpoint}/openai/deployments/${deployment}/chat/completions?api-version=2025-01-01-preview`;
     
     // Use Azure OpenAI chat completions API
     const response = await fetch(fullUrl, {
        method: "POST",
        headers: {
           "Content-Type": "application/json",
           "api-key": apiKey
        },
        body: JSON.stringify({
           messages: [
              {
                 role: "user",
                 content: buildPrompt(transcript, question, undefined, leniency)
              }
           ],
           max_tokens: 400,
           temperature: 0.3
        })
     });
     
     if (!response.ok) {
        const errorText = await response.text();
        console.error(`Azure OpenAI API error: ${response.status} ${response.statusText}`, errorText);
        throw new Error(`Azure OpenAI API error: ${response.status} ${response.statusText}`);
     }
     
     const data = await response.json();
     const text = data.choices?.[0]?.message?.content || "";
     
     // Attempt to extract JSON from text
     const firstBrace = text.indexOf("{");
     const lastBrace = text.lastIndexOf("}");
     if (firstBrace >= 0 && lastBrace >= 0) {
        const jsonStr = text.slice(firstBrace, lastBrace + 1);
        const parsed = JSON.parse(jsonStr);
        return parsed;
     }
     // fallback to local scoring
     return localScore(transcript, question);
  } catch (err: any) {
     console.warn("Azure OpenAI evaluation failed, falling back:", err?.message || err);
     return localScore(transcript, question);
  }
}

function localScore(transcript: string, question: any) {
  const keyPhrases = (question.key_phrases || []).map((s:string)=>s.toLowerCase());
  const matched: string[] = [];
  const low = transcript.toLowerCase();
  for (const kp of keyPhrases) {
     if (kp.split(" ").every((tok: string) => low.includes(tok))) matched.push(kp);
  }
  // Strict scoring - no minimum floor, must earn every point
  const matchRate = matched.length / Math.max(1, keyPhrases.length);
  // Apply penalty for incomplete coverage - reduce by 20% if less than 70% match
  const completionPenalty = matchRate < 0.7 ? 0.8 : 1.0;
  const baseScore = Math.round(matchRate * 100 * completionPenalty);
  const score = Math.min(100, baseScore);
  const missing = keyPhrases.filter((k: string) => !matched.includes(k));
  
  let feedback = "";
  if (matched.length === keyPhrases.length) {
    feedback = `Excellent! You covered all ${keyPhrases.length} key topics: ${matched.slice(0, 3).join(", ")}${matched.length > 3 ? `, and ${matched.length - 3} more` : ""}. To elevate this to exceptional: 1) Include specific Azure service names (e.g., Azure Front Door, Traffic Manager, Availability Zones), 2) Mention quantifiable metrics (SLAs, RTO, RPO), 3) Provide real-world implementation examples or customer scenarios.`;
  } else if (matched.length >= keyPhrases.length * 0.7) {
    const strengths = matched.length > 0 ? `\n\n✓ What you did well: You addressed ${matched.slice(0, 2).join(", ")}${matched.length > 2 ? `, and ${matched.length - 2} other topic(s)` : ""}.` : "";
    const improvements = `\n\n✗ Areas for improvement:\n  - Critical gaps: ${missing.slice(0, 2).join(", ")}\n  - Add specific Azure services and features\n  - Include implementation steps or best practices\n  - Mention relevant SLAs, uptime percentages, or recovery metrics`;
    feedback = `Partial coverage (${matched.length}/${keyPhrases.length} topics).${strengths}${improvements}`;
  } else if (matched.length > 0) {
    const strengths = `\n\n✓ Positive: You mentioned ${matched.slice(0, 2).join(", ")}${matched.length > 2 ? `, plus ${matched.length - 2} more` : ""}.`;
    const improvements = `\n\n✗ Significant gaps (missing ${missing.length} key concepts):\n  - Essential topics to cover: ${missing.slice(0, 3).join(", ")}\n  - Provide concrete Azure architecture examples\n  - Demonstrate understanding of Well-Architected Framework\n  - Explain HOW to implement, not just WHAT to do\n  - Reference specific Azure documentation or patterns`;
    feedback = `Weak response - only ${matched.length}/${keyPhrases.length} topics addressed.${strengths}${improvements}`;
  } else {
    feedback = `Poor response - none of the required topics covered.\n\n✗ You must address these fundamental concepts:\n  1. ${missing.slice(0, 4).join("\n  2. ")}\n\nTo improve: Study Azure architecture best practices, review the Well-Architected Framework, and prepare specific examples of Azure services and implementation patterns. Practice explaining technical concepts with business context.`;
  }
  
  // Basic sentiment analysis
  const sentiment = analyzeSentiment(transcript);
  const sentimentFeedback = generateSentimentFeedback(sentiment, transcript);
  
  return { 
    score, 
    matched_phrases: matched, 
    missing_phrases: missing, 
    feedback,
    sentiment,
    sentiment_feedback: sentimentFeedback
  };
}

function analyzeSentiment(transcript: string): { confidence: number; empathy: number; executive_presence: number; professionalism: number } {
  const low = transcript.toLowerCase();
  const wordCount = transcript.split(/\s+/).length;
  
  // Check for negative/hostile/inappropriate language first
  const hostilePhrases = ['bad person', 'failure', 'stupid', 'idiot', 'incompetent', 'worthless', 'terrible', 
                          'awful', 'hate', 'worst', 'useless', 'garbage', 'crap', 'sucks', 'pathetic',
                          'you are bad', 'you will fail', 'set for failure', 'doomed', 'hopeless'];
  const negativePhrases = ['won\'t work', 'can\'t', 'impossible', 'no way', 'never', 'absolutely not',
                           'waste of time', 'pointless', 'not going to', 'refuse'];
  const dismissivePhrases = ['whatever', 'don\'t care', 'not my problem', 'not important', 'doesn\'t matter'];
  
  const hostileCount = hostilePhrases.filter(p => low.includes(p)).length;
  const negativeCount = negativePhrases.filter(p => low.includes(p)).length;
  const dismissiveCount = dismissivePhrases.filter(p => low.includes(p)).length;
  
  // Severe penalty for hostile/inappropriate language
  const hostilePenalty = hostileCount * 50;
  const negativePenalty = negativeCount * 25;
  const dismissivePenalty = dismissiveCount * 30;
  
  // Confidence indicators (more lenient - start higher, penalize less)
  const confidentPhrases = ['will', 'recommend', 'should', 'must', 'ensure', 'guarantee', 'commit', 'definitely', 'absolutely'];
  const hesitantPhrases = ['maybe', 'perhaps', 'might', 'possibly', 'i think', 'not sure', 'probably'];
  const confidentCount = confidentPhrases.filter(p => low.includes(p)).length;
  const hesitantCount = hesitantPhrases.filter(p => low.includes(p)).length;
  const confidence = Math.min(100, Math.max(0, 15 + (confidentCount * 15) - (hesitantCount * 20) - hostilePenalty - negativePenalty));
  
  // Empathy indicators (more lenient baseline but severely penalize hostile language)
  // High-value empathetic responses to pain points
  const sympatheticPhrases = ['sorry', 'apologize', 'here to help', 'we\'re here', 'we are here', 
                              'i\'m sorry', 'i am sorry', 'that must be', 'frustrating for you',
                              'understand your frustration', 'feel your pain', 'i hear you'];
  const empathyPhrases = ['understand', 'appreciate', 'acknowledge', 'concern', 'pain point', 
                          'challenge', 'impact', 'critical', 'partner', 'together', 'support you',
                          'work with you', 'help you', 'assist you'];
  
  const sympatheticCount = sympatheticPhrases.filter(p => low.includes(p)).length;
  const empathyCount = empathyPhrases.filter(p => low.includes(p)).length;
  
  // Reward sympathetic phrases more heavily (they show direct empathy to pain points)
  const empathy = Math.min(100, Math.max(0, 10 + (sympatheticCount * 20) + (empathyCount * 12) - hostilePenalty - dismissivePenalty));
  
  // Executive presence indicators (more lenient - less penalty for jargon)
  const executivePhrases = ['strategy', 'roadmap', 'vision', 'business', 'revenue', 'customer', 'enterprise', 'mission critical', 'priority', 'investment'];
  const technicalJargon = ['api', 'endpoint', 'query', 'cache', 'latency', 'throughput'];
  const executiveCount = executivePhrases.filter(p => low.includes(p)).length;
  const jargonCount = technicalJargon.filter(p => low.includes(p)).length;
  const concise = wordCount < 150 ? 10 : (wordCount < 250 ? 0 : -15);
  const executive_presence = Math.min(100, Math.max(0, 12 + (executiveCount * 12) - (jargonCount * 8) + concise - hostilePenalty - dismissivePenalty));
  
  // Professionalism indicators (more lenient - allow conversational tone but penalize inappropriate language heavily)
  const professionalPhrases = ['thank you', 'appreciate', 'respectfully', 'collaborate', 'committed', 'accountable', 'transparent'];
  const informalPhrases = ['yeah', 'yep', 'gonna', 'wanna', 'kinda', 'sorta'];
  const professionalCount = professionalPhrases.filter(p => low.includes(p)).length;
  const informalCount = informalPhrases.filter(p => low.includes(p)).length;
  const professionalism = Math.min(100, Math.max(0, 20 + (professionalCount * 12) - (informalCount * 18) - hostilePenalty - negativePenalty - dismissivePenalty));
  
  return { confidence, empathy, executive_presence, professionalism };
}

function generateSentimentFeedback(sentiment: { confidence: number; empathy: number; executive_presence: number; professionalism: number }, transcript: string): string {
  const low = transcript.toLowerCase();
  
  // Check for inappropriate language
  const hostilePhrases = ['bad person', 'failure', 'stupid', 'idiot', 'incompetent', 'worthless', 'terrible', 
                          'awful', 'hate', 'worst', 'useless', 'garbage', 'crap', 'sucks', 'pathetic',
                          'you are bad', 'you will fail', 'set for failure', 'doomed', 'hopeless'];
  const negativePhrases = ['won\'t work', 'can\'t', 'impossible', 'no way', 'never', 'absolutely not',
                           'waste of time', 'pointless'];
  const dismissivePhrases = ['whatever', 'don\'t care', 'not my problem', 'not important', 'doesn\'t matter'];
  const sympatheticPhrases = ['sorry', 'apologize', 'here to help', 'we\'re here', 'we are here', 
                              'i\'m sorry', 'i am sorry', 'that must be', 'frustrating for you',
                              'understand your frustration', 'feel your pain', 'i hear you'];
  
  const hasHostile = hostilePhrases.some(p => low.includes(p));
  const hasNegative = negativePhrases.some(p => low.includes(p));
  const hasDismissive = dismissivePhrases.some(p => low.includes(p));
  const hasSympathy = sympatheticPhrases.some(p => low.includes(p));
  const hasCriticalIssue = hasHostile || hasDismissive;
  
  let feedback = "\n\n**COMMUNICATION ASSESSMENT**\n\n";
  
  // Critical Issues Section (if any)
  if (hasCriticalIssue) {
    feedback += "🚨 **CRITICAL COMMUNICATION FAILURE**\n\n";
    if (hasHostile) {
      feedback += "• **Issue:** Hostile language detected - offensive or attacking words toward the client\n";
      feedback += "• **Impact:** This is NEVER acceptable in professional consulting\n\n";
    }
    if (hasDismissive) {
      feedback += "• **Issue:** Dismissive tone - you dismissed the client's concerns\n";
      feedback += "• **Impact:** Consultants must actively listen and address concerns\n\n";
    }
    feedback += "**Real-world consequences:**\n";
    feedback += "• Immediate escalation to leadership\n";
    feedback += "• Potential contract termination\n";
    feedback += "• Reputation damage\n\n";
    feedback += "**What to say instead:**\n";
    feedback += "• ❌ \"That won't work\" or \"You're wrong\"\n";
    feedback += "• ✅ \"I understand your concern. Let's explore options together.\"\n\n";
    feedback += "• ❌ \"This is a waste of time\"\n";
    feedback += "• ✅ \"I appreciate the challenge. Here's how we can address it...\"\n\n";
  }
  
  // 1. Confidence Assessment
  feedback += `**1. CONFIDENCE: ${sentiment.confidence}%**\n\n`;
  
  if (sentiment.confidence >= 70) {
    feedback += "✅ **Status:** STRONG\n\n";
    feedback += "**What worked:**\n";
    feedback += "• Decisive language: \"will\", \"should\", \"recommend\"\n";
    feedback += "• Clear recommendations without hedging\n\n";
  } else if (sentiment.confidence >= 40) {
    feedback += "⚠️ **Status:** MODERATE\n\n";
    feedback += "**How to strengthen:**\n";
    feedback += "• Replace \"I think\" → \"I recommend\"\n";
    feedback += "• Replace \"might\" → \"will\"\n";
    feedback += "• Replace \"maybe we could\" → \"we should\"\n\n";
    feedback += "**Example transformation:**\n";
    feedback += "• ❌ \"Maybe we could look at Azure Front Door?\"\n";
    feedback += "• ✅ \"I recommend implementing Azure Front Door for global load balancing.\"\n\n";
  } else {
    if (hasCriticalIssue) {
      feedback += "❌ **Status:** FAILED\n\n";
      feedback += "**Issue:** Hostile/negative language destroys all credibility\n\n";
      feedback += "**How to recover:**\n";
      feedback += "• Channel concerns into constructive recommendations\n";
      feedback += "• Use solution-focused language\n";
      feedback += "• Demonstrate expertise through partnership, not criticism\n\n";
    } else {
      feedback += "❌ **Status:** WEAK\n\n";
      feedback += "**Issues detected:**\n";
      feedback += "• Too much hedging: \"maybe\", \"perhaps\", \"might\"\n";
      feedback += "• Uncertain phrasing: \"I think\", \"not sure\"\n\n";
      feedback += "**Transformation examples:**\n";
      feedback += "• ❌ Weak: \"I'm not sure, but perhaps we could try Azure Traffic Manager?\"\n";
      feedback += "• ✅ Strong: \"I recommend Azure Traffic Manager. It will provide geographic routing and automatic failover.\"\n\n";
    }
  }
  
  // 2. Empathy Assessment
  feedback += `**2. EMPATHY: ${sentiment.empathy}%**\n\n`;
  
  if (sentiment.empathy >= 70) {
    if (hasSympathy) {
      feedback += "✅ **Status:** EXCELLENT\n\n";
      feedback += "**What worked:**\n";
      feedback += "• Used sympathetic phrases: \"I'm sorry\", \"we're here to help\"\n";
      feedback += "• Acknowledged pain points before solutions\n";
      feedback += "• Demonstrated emotional intelligence\n\n";
    } else {
      feedback += "✅ **Status:** GOOD\n\n";
      feedback += "**To reach excellence:**\n";
      feedback += "• When Mark raises pain points, START with empathy\n";
      feedback += "• Use phrases: \"I'm sorry to hear that\" / \"We're here to help you resolve this\"\n\n";
    }
  } else if (sentiment.empathy >= 40) {
    feedback += "⚠️ **Status:** PARTIAL\n\n";
    feedback += "**Empathy formula for pain points:**\n";
    feedback += "1. **Acknowledge:** \"I understand that's frustrating\"\n";
    feedback += "2. **Validate:** \"That's a critical concern\"\n";
    feedback += "3. **Support:** \"We're here to help you through this\"\n";
    feedback += "4. **Action:** \"Here's how we'll address it...\"\n\n";
    feedback += "**Example response:**\n";
    feedback += "\"I'm sorry to hear you're experiencing outages. That must be impacting customer satisfaction significantly. We're here to help you achieve the reliability you need. I recommend implementing Azure's high-availability architecture with...\"\n\n";
  } else {
    if (hasCriticalIssue) {
      feedback += "❌ **Status:** FAILED\n\n";
      feedback += "**Issue:** Hostile or dismissive language shows ZERO empathy\n\n";
      feedback += "**Mandatory structure for any pain point:**\n";
      feedback += "1. Express sympathy: \"I'm sorry to hear that\"\n";
      feedback += "2. Show care: \"We're here to help\"\n";
      feedback += "3. Validate: \"I appreciate you raising this\"\n";
      feedback += "4. Partner: \"Let's work through this together\"\n\n";
    } else {
      feedback += "❌ **Status:** MINIMAL\n\n";
      feedback += "**Required empathetic phrases:**\n";
      feedback += "• \"I'm sorry you're facing this\"\n";
      feedback += "• \"I understand that's frustrating\"\n";
      feedback += "• \"We're here to support you\"\n";
      feedback += "• \"That must be challenging\"\n";
      feedback += "• \"I hear your concern\"\n\n";
      feedback += "**Full example:**\n";
      feedback += "\"I'm sorry to hear you've experienced these outages. I understand how that impacts leadership confidence and customer trust. We're here to help you establish the reliability your business needs. Let me walk you through a comprehensive high-availability solution using Azure's...\"\n\n";
    }
  }
  
  // 3. Executive Presence Assessment
  feedback += `**3. EXECUTIVE PRESENCE: ${sentiment.executive_presence}%**\n\n`;
  
  if (sentiment.executive_presence >= 70) {
    feedback += "✅ **Status:** STRONG\n\n";
    feedback += "**What worked:**\n";
    feedback += "• Framed responses with business value\n";
    feedback += "• Maintained executive-level dialogue\n";
    feedback += "• Balanced technical depth with strategic context\n\n";
  } else if (sentiment.executive_presence >= 40) {
    feedback += "⚠️ **Status:** ADEQUATE\n\n";
    feedback += "**How to elevate:**\n";
    feedback += "• Connect technical details to business outcomes\n";
    feedback += "• Use strategic terms: \"roadmap\", \"investment\", \"priority\"\n";
    feedback += "• Keep responses concise (<150 words) yet thorough\n\n";
    feedback += "**Transformation example:**\n";
    feedback += "• ❌ Tactical: \"We need to configure load balancers and set up health probes.\"\n";
    feedback += "• ✅ Strategic: \"This investment in load balancing infrastructure will improve customer experience and reduce revenue risk from outages.\"\n\n";
  } else {
    if (hasCriticalIssue) {
      feedback += "❌ **Status:** FAILED\n\n";
      feedback += "**Issue:** Hostile communication eliminates executive credibility\n\n";
      feedback += "**Recovery approach:**\n";
      feedback += "• Frame everything as opportunities for improvement\n";
      feedback += "• Focus on solutions and ROI\n";
      feedback += "• Demonstrate strategic thinking through constructive recommendations\n\n";
      feedback += "**Example:**\n";
      feedback += "• ❌ \"Your architecture is terrible and will fail\"\n";
      feedback += "• ✅ \"I see opportunities to strengthen your architecture. Here's a roadmap that will reduce downtime by 95%...\"\n\n";
    } else {
      feedback += "❌ **Status:** TOO TACTICAL\n\n";
      feedback += "**Issues:**\n";
      feedback += "• Over-focus on technical details\n";
      feedback += "• Missing business impact\n";
      feedback += "• Too much jargon\n\n";
      feedback += "**Executive communication framework:**\n";
      feedback += "1. **Business Impact:** \"This will improve customer satisfaction and reduce revenue risk\"\n";
      feedback += "2. **Strategic Context:** \"Aligns with your digital transformation roadmap\"\n";
      feedback += "3. **Investment Framing:** \"The priority investment areas are...\"\n";
      feedback += "4. **Technical Summary:** \"We'll implement Azure Traffic Manager for...\"\n\n";
    }
  }
  
  // 4. Professionalism Assessment
  feedback += `**4. PROFESSIONALISM: ${sentiment.professionalism}%**\n\n`;
  
  if (sentiment.professionalism >= 80) {
    feedback += "✅ **Status:** EXCELLENT\n\n";
    feedback += "**What worked:**\n";
    feedback += "• Consultative partnership approach\n";
    feedback += "• Appropriate formal language\n";
    feedback += "• Respectful and collaborative tone\n\n";
  } else if (sentiment.professionalism >= 50) {
    feedback += "⚠️ **Status:** GENERALLY PROFESSIONAL\n\n";
    feedback += "**To polish:**\n";
    feedback += "• Use consultative language: \"collaborate\", \"partner\", \"committed\"\n";
    feedback += "• Express appreciation: \"Thank you for raising this\"\n";
    feedback += "• Maintain formal tone, avoid casual expressions\n\n";
    feedback += "**Refinement examples:**\n";
    feedback += "• ❌ \"Yeah, we can fix that issue\"\n";
    feedback += "• ✅ \"Absolutely, I'm committed to resolving this for you\"\n\n";
  } else {
    if (hasCriticalIssue) {
      feedback += "❌ **Status:** COMPLETELY UNPROFESSIONAL\n\n";
      feedback += "**Critical violation:** Hostile, attacking, or dismissive language toward the client\n\n";
      feedback += "**Real-world consequences:**\n";
      feedback += "• Immediate escalation to leadership\n";
      feedback += "• Formal client complaint\n";
      feedback += "• Potential contract termination\n";
      feedback += "• Firm reputation damage\n\n";
      feedback += "**Fundamental standards:**\n";
      feedback += "• NEVER use negative language about people or organizations\n";
      feedback += "• Maintain respect at ALL times\n";
      feedback += "• Focus on solutions, not problems or blame\n";
      feedback += "• Treat every interaction as a partnership opportunity\n\n";
    } else {
      feedback += "❌ **Status:** UNPROFESSIONAL\n\n";
      feedback += "**Issues detected:**\n";
      feedback += "• Casual words: \"yeah\", \"gonna\", \"wanna\", \"kinda\"\n";
      feedback += "• Informal expressions\n\n";
      feedback += "**Professional vocabulary:**\n";
      feedback += "• Replace \"yeah\" → \"yes\" or \"certainly\"\n";
      feedback += "• Replace \"gonna\" → \"going to\" or \"will\"\n";
      feedback += "• Replace \"wanna\" → \"want to\" or \"should\"\n\n";
      feedback += "**Add consultative phrases:**\n";
      feedback += "• \"Thank you for raising this concern\"\n";
      feedback += "• \"I appreciate your perspective\"\n";
      feedback += "• \"I'm committed to supporting your success\"\n\n";
    }
  }
  
  return feedback;
}

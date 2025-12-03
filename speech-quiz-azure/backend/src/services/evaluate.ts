
import { getSecret } from "../utils/secrets";

// Conversational evaluation prompt that maintains context around Azure architecture topics
const buildPrompt = (transcript: string, question: any, conversationHistory?: string) => {
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
       "Technical Scoring Guidelines (Strict Evaluation):",
       "- Score 90-100 ONLY for exceptional answers with specific Azure service names, implementation details, and real-world examples",
       "- Score 75-89 for strong technical depth covering ALL key concepts with proper Azure terminology",
       "- Score 60-74 for adequate understanding but missing specifics or best practices",
       "- Score 40-59 for weak responses showing surface-level knowledge without depth",
       "- Score 20-39 for poor responses with significant gaps or incorrect information",
       "- Below 20 for completely off-topic or irrelevant answers",
       "- Demand specific Azure service names (e.g., Azure Front Door, Traffic Manager, Availability Zones)",
       "- Require concrete implementation steps, not vague concepts",
       "- Penalize generic answers that could apply to any cloud provider",
       "- Expect quantifiable metrics (SLAs, RTO, RPO, uptime percentages)",
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
                 content: buildPrompt(transcript, question)
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
     if (kp.split(" ").every(tok => low.includes(tok))) matched.push(kp);
  }
  // Strict scoring - no minimum floor, must earn every point
  const matchRate = matched.length / Math.max(1, keyPhrases.length);
  // Apply penalty for incomplete coverage - reduce by 20% if less than 70% match
  const completionPenalty = matchRate < 0.7 ? 0.8 : 1.0;
  const baseScore = Math.round(matchRate * 100 * completionPenalty);
  const score = Math.min(100, baseScore);
  const missing = keyPhrases.filter(k => !matched.includes(k));
  
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
  const sentimentFeedback = generateSentimentFeedback(sentiment);
  
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
  
  // Confidence indicators (more lenient - start higher, penalize less)
  const confidentPhrases = ['will', 'recommend', 'should', 'must', 'ensure', 'guarantee', 'commit', 'definitely', 'absolutely'];
  const hesitantPhrases = ['maybe', 'perhaps', 'might', 'possibly', 'i think', 'not sure', 'probably'];
  const confidentCount = confidentPhrases.filter(p => low.includes(p)).length;
  const hesitantCount = hesitantPhrases.filter(p => low.includes(p)).length;
  const confidence = Math.min(100, Math.max(0, 15 + (confidentCount * 15) - (hesitantCount * 20)));
  
  // Empathy indicators (more lenient baseline)
  const empathyPhrases = ['understand', 'appreciate', 'acknowledge', 'concern', 'pain point', 'challenge', 'impact', 'critical', 'partner', 'together'];
  const empathyCount = empathyPhrases.filter(p => low.includes(p)).length;
  const empathy = Math.min(100, Math.max(0, 10 + (empathyCount * 12)));
  
  // Executive presence indicators (more lenient - less penalty for jargon)
  const executivePhrases = ['strategy', 'roadmap', 'vision', 'business', 'revenue', 'customer', 'enterprise', 'mission critical', 'priority', 'investment'];
  const technicalJargon = ['api', 'endpoint', 'query', 'cache', 'latency', 'throughput'];
  const executiveCount = executivePhrases.filter(p => low.includes(p)).length;
  const jargonCount = technicalJargon.filter(p => low.includes(p)).length;
  const concise = wordCount < 150 ? 10 : (wordCount < 250 ? 0 : -15);
  const executive_presence = Math.min(100, Math.max(0, 12 + (executiveCount * 12) - (jargonCount * 8) + concise));
  
  // Professionalism indicators (more lenient - allow conversational tone)
  const professionalPhrases = ['thank you', 'appreciate', 'respectfully', 'collaborate', 'committed', 'accountable', 'transparent'];
  const informalPhrases = ['yeah', 'yep', 'gonna', 'wanna', 'kinda', 'sorta'];
  const professionalCount = professionalPhrases.filter(p => low.includes(p)).length;
  const informalCount = informalPhrases.filter(p => low.includes(p)).length;
  const professionalism = Math.min(100, Math.max(0, 20 + (professionalCount * 12) - (informalCount * 18)));
  
  return { confidence, empathy, executive_presence, professionalism };
}

function generateSentimentFeedback(sentiment: { confidence: number; empathy: number; executive_presence: number; professionalism: number }): string {
  const sections: string[] = [];
  
  // Confidence feedback
  if (sentiment.confidence >= 70) {
    sections.push(`✓ Confidence (${sentiment.confidence}%): Excellent! You demonstrated strong conviction and authority. Your use of decisive language like "will", "should", "recommend" shows expertise.`);
  } else if (sentiment.confidence >= 40) {
    sections.push(`△ Confidence (${sentiment.confidence}%): Moderate confidence shown. To improve: Use more decisive language, avoid hedging words like "maybe", "perhaps", "might". State recommendations clearly with conviction.`);
  } else {
    sections.push(`✗ Confidence (${sentiment.confidence}%): Lacks conviction. Issues: Too much hesitation, uncertain language. To improve: Replace "I think" with "I recommend", use "will" instead of "might", state solutions definitively. Practice assertive communication while remaining consultative.`);
  }
  
  // Empathy feedback
  if (sentiment.empathy >= 70) {
    sections.push(`✓ Empathy (${sentiment.empathy}%): Outstanding! You actively acknowledged concerns and demonstrated customer understanding. Great use of empathetic language.`);
  } else if (sentiment.empathy >= 40) {
    sections.push(`△ Empathy (${sentiment.empathy}%): Some customer awareness shown. To improve: More explicitly acknowledge the CTO's pain points, use phrases like "I understand your concern about...", "I appreciate the challenge...", show you're listening actively.`);
  } else {
    sections.push(`✗ Empathy (${sentiment.empathy}%): Minimal customer focus. Issues: Didn't acknowledge concerns or business impact. To improve: Start by validating the CTO's challenges, use empathetic phrases ("understand", "appreciate", "acknowledge"), connect technical solutions to their specific pain points.`);
  }
  
  // Executive presence feedback
  if (sentiment.executive_presence >= 70) {
    sections.push(`✓ Executive Presence (${sentiment.executive_presence}%): Strong strategic communication! You framed responses with business value and maintained executive-level dialogue.`);
  } else if (sentiment.executive_presence >= 40) {
    sections.push(`△ Executive Presence (${sentiment.executive_presence}%): Adequate but needs more strategic framing. To improve: Connect technical details to business outcomes (revenue, customer satisfaction, operational efficiency), use strategic terms like "roadmap", "investment", "priority". Keep responses concise yet thorough.`);
  } else {
    sections.push(`✗ Executive Presence (${sentiment.executive_presence}%): Too tactical, lacking strategic perspective. Issues: Over-focus on technical details, missing business context. To improve: Lead with business impact, mention strategy/vision/priorities, explain "why this matters to the business", reduce technical jargon, keep responses concise (<150 words when possible).`);
  }
  
  // Professionalism feedback
  if (sentiment.professionalism >= 80) {
    sections.push(`✓ Professionalism (${sentiment.professionalism}%): Excellent professional tone! Maintained consultative partnership approach throughout.`);
  } else if (sentiment.professionalism >= 50) {
    sections.push(`△ Professionalism (${sentiment.professionalism}%): Generally professional. To improve: Use more consultative language ("collaborate", "partner", "committed"), express appreciation, maintain formal tone, avoid casual expressions.`);
  } else {
    sections.push(`✗ Professionalism (${sentiment.professionalism}%): Unprofessional tone detected. Issues: Too casual or informal language. To improve: Eliminate casual words ("yeah", "gonna", "wanna"), use professional phrases ("thank you", "I appreciate", "respectfully"), maintain consultative partnership tone, treat this as an executive conversation.`);
  }
  
  return "\n\nCommunication Assessment:\n" + sections.join("\n\n");
}


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
       "Technical Scoring Guidelines (Be Lenient):",
       "- Score 70-90 for answers that show general understanding of Azure concepts, even if not perfectly articulated",
       "- Score 50-70 for responses that demonstrate awareness of the problem space and show willingness to learn",
       "- Give credit for attempting to address the CTO's concern, even if missing specific technical details",
       "- Recognize conversational responses that build rapport over perfect technical accuracy",
       "- Value practical thinking and business awareness as much as specific Azure terminology",
       "- Don't penalize for missing buzzwords if the core concept is understood",
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
     
     if (!endpoint || !apiKey) throw new Error("Azure OpenAI not configured");
     
     // Use Azure OpenAI chat completions API
     const response = await fetch(endpoint, {
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
  } catch (err) {
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
  // More lenient scoring: give partial credit and boost overall score
  const matchRate = matched.length / Math.max(1, keyPhrases.length);
  const baseScore = Math.round(matchRate * 100);
  // Boost: minimum 60 if any answer given, add 15 points to bring scores up
  const score = Math.min(100, Math.max(60, baseScore + 15));
  const missing = keyPhrases.filter(k => !matched.includes(k));
  
  let feedback = "";
  if (matched.length === keyPhrases.length) {
    feedback = "Excellent — covered all key points clearly.";
  } else if (matched.length > 0) {
    feedback = `Good response! You covered ${matched.length} important topics. To strengthen further, consider: ${missing.slice(0, 2).join(", ")}.`;
  } else {
    feedback = `Your response shows engagement with the problem. For next time, try focusing on these key areas: ${missing.slice(0, 3).join(", ")}.`;
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
  const confidence = Math.min(100, Math.max(50, 65 + (confidentCount * 10) - (hesitantCount * 8)));
  
  // Empathy indicators (more lenient baseline)
  const empathyPhrases = ['understand', 'appreciate', 'acknowledge', 'concern', 'pain point', 'challenge', 'impact', 'critical', 'partner', 'together'];
  const empathyCount = empathyPhrases.filter(p => low.includes(p)).length;
  const empathy = Math.min(100, Math.max(55, 60 + (empathyCount * 8)));
  
  // Executive presence indicators (more lenient - less penalty for jargon)
  const executivePhrases = ['strategy', 'roadmap', 'vision', 'business', 'revenue', 'customer', 'enterprise', 'mission critical', 'priority', 'investment'];
  const technicalJargon = ['api', 'endpoint', 'query', 'cache', 'latency', 'throughput'];
  const executiveCount = executivePhrases.filter(p => low.includes(p)).length;
  const jargonCount = technicalJargon.filter(p => low.includes(p)).length;
  const concise = wordCount < 150 ? 5 : (wordCount < 250 ? 0 : -5);
  const executive_presence = Math.min(100, Math.max(55, 60 + (executiveCount * 8) - (jargonCount * 1) + concise));
  
  // Professionalism indicators (more lenient - allow conversational tone)
  const professionalPhrases = ['thank you', 'appreciate', 'respectfully', 'collaborate', 'committed', 'accountable', 'transparent'];
  const informalPhrases = ['yeah', 'yep', 'gonna', 'wanna', 'kinda', 'sorta'];
  const professionalCount = professionalPhrases.filter(p => low.includes(p)).length;
  const informalCount = informalPhrases.filter(p => low.includes(p)).length;
  const professionalism = Math.min(100, Math.max(60, 70 + (professionalCount * 8) - (informalCount * 5)));
  
  return { confidence, empathy, executive_presence, professionalism };
}

function generateSentimentFeedback(sentiment: { confidence: number; empathy: number; executive_presence: number; professionalism: number }): string {
  const feedback: string[] = [];
  
  if (sentiment.confidence < 50) feedback.push("Show more confidence and conviction in your recommendations.");
  else if (sentiment.confidence >= 70) feedback.push("Strong confident delivery.");
  
  if (sentiment.empathy < 50) feedback.push("Acknowledge the CTO's concerns more directly.");
  else if (sentiment.empathy >= 70) feedback.push("Excellent empathy and customer understanding.");
  
  if (sentiment.executive_presence < 50) feedback.push("Frame responses with business impact and strategic value.");
  else if (sentiment.executive_presence >= 70) feedback.push("Strong executive presence and strategic communication.");
  
  if (sentiment.professionalism < 60) feedback.push("Maintain professional tone and language.");
  else if (sentiment.professionalism >= 80) feedback.push("Professional and consultative approach.");
  
  return feedback.length ? feedback.join(" ") : "Good overall communication style.";
}

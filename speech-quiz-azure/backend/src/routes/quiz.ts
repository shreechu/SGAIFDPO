
import { Router } from "express";
import { readFileSync } from "fs";
import path from "path";
import evaluateController from "../services/evaluate";
import { saveSession } from "../services/store";
import axios from "axios";
import { getSecret, getSecrets } from "../utils/secrets";

const router = Router();

// Helper function to load questions dynamically
function loadQuestions(): any[] {
  const possiblePaths = [
    path.resolve(process.cwd(), "scripts/questions.json"),
    path.resolve(process.cwd(), "../scripts/questions.json"),
    path.resolve(__dirname, "../../scripts/questions.json")
  ];
  
  for (const questionsPath of possiblePaths) {
    try {
      const questions = JSON.parse(readFileSync(questionsPath, "utf8"));
      console.log("✅ Loaded questions from", questionsPath, "count=", questions.length);
      return questions;
    } catch {
      // Try next path
    }
  }
  
  console.error("❌ Could not load questions.json from any path:", possiblePaths);
  return [];
}

// Store quiz sessions with their random question selections
// Map<sessionId, selectedQuestions[]>
const quizSessions = new Map<string, any[]>();

// Function to generate random question selection for a quiz session
function generateQuizQuestions(): any[] {
  const questions = loadQuestions();
  if (questions.length === 0) return [];
  
  // First question is always the introduction (index 0)
  const introQuestion = questions[0];
  
  // Get remaining questions (excluding intro)
  const remainingQuestions = questions.slice(1);
  
  // If we have 10 or fewer remaining questions, use all of them
  if (remainingQuestions.length <= 10) {
    return [introQuestion, ...remainingQuestions];
  }
  
  // Randomly select 10 questions from the remaining questions
  const shuffled = [...remainingQuestions].sort(() => Math.random() - 0.5);
  const selected = shuffled.slice(0, 10);
  
  // Return intro + 10 random questions
  return [introQuestion, ...selected];
}

// Simple Microsoft Learn links by topic to include with results
const learnLinksByTopic: Record<string, Array<{ title: string; url: string }>> = {
  Reliability: [
    { title: "Azure Well-Architected Framework: Reliability", url: "https://learn.microsoft.com/azure/architecture/framework/resiliency/overview" },
    { title: "Design for resiliency in Azure", url: "https://learn.microsoft.com/azure/architecture/resiliency/" }
  ],
  Observability: [
    { title: "Azure Monitor overview", url: "https://learn.microsoft.com/azure/azure-monitor/overview" },
    { title: "Distributed tracing with OpenTelemetry (Azure)", url: "https://learn.microsoft.com/azure/azure-monitor/app/opentelemetry-overview" },
    { title: "SLOs, error budgets and alerting", url: "https://learn.microsoft.com/azure/architecture/framework/observability/monitoring-slos" }
  ],
  "Change Management": [
    { title: "Safe deployment practices (blue/green, canary)", url: "https://learn.microsoft.com/azure/architecture/framework/reliability/deploy" },
    { title: "Feature flags with Azure App Configuration", url: "https://learn.microsoft.com/azure/azure-app-configuration/concept-feature-management" }
  ],
  "Support & Process": [
    { title: "Azure Support plans", url: "https://learn.microsoft.com/training/support-plans/" },
    { title: "Azure Service Health", url: "https://learn.microsoft.com/azure/service-health/overview" }
  ],
  "Cost Optimization": [
    { title: "Azure Advisor cost recommendations", url: "https://learn.microsoft.com/azure/advisor/advisor-cost-recommendations" },
    { title: "Azure Reservations and Savings Plans", url: "https://learn.microsoft.com/azure/cost-management-billing/savings-plan/" },
    { title: "Cost Management + Billing", url: "https://learn.microsoft.com/azure/cost-management-billing/" }
  ]
};

// Function to adapt question based on conversation history
async function adaptQuestionBasedOnHistory(baseQuestion: any, conversationHistory: Array<{ question: string, answer: string }>) {
  const secrets = getSecrets();
  if (!secrets.AZURE_OPENAI_API_KEY || !secrets.AZURE_OPENAI_ENDPOINT) {
    return baseQuestion; // Return original if OpenAI not configured
  }

  const conversationContext = conversationHistory
    .map(h => `Mark: ${h.question}\nArchitect: ${h.answer}`)
    .join('\n\n');

  const prompt = `You are Mark, the CTO at Zava having a natural conversation with a Mission Critical Architect candidate. 

Previous conversation:
${conversationContext}

Your next planned question was: "${baseQuestion.question}"

Based on what the architect has said so far, adapt this question to:
1. Reference specific points they mentioned (e.g., "You mentioned X earlier...")
2. Follow up naturally on interesting topics they brought up
3. Build on the conversation flow rather than asking standalone questions
4. Keep Mark's casual, direct CTO personality
5. Stay focused on the core topic: ${baseQuestion.topic}

Return ONLY the adapted question text, nothing else. Keep it conversational and natural, as if you're genuinely interested in their previous responses.`;

  try {
    const response = await axios.post(
      `${secrets.AZURE_OPENAI_ENDPOINT}/openai/deployments/${secrets.AZURE_OPENAI_DEPLOYMENT}/chat/completions?api-version=2025-01-01-preview`,
      {
        messages: [
          { role: "system", content: "You are Mark, a CTO having a natural conversation about Azure architecture." },
          { role: "user", content: prompt }
        ],
        temperature: 0.8,
        max_tokens: 300
      },
      {
        headers: {
          "Content-Type": "application/json",
          "api-key": secrets.AZURE_OPENAI_API_KEY
        },
        timeout: 10000
      }
    );

    const adaptedText = response.data?.choices?.[0]?.message?.content?.trim();
    if (adaptedText && adaptedText.length > 20) {
      console.log(`Adapted question for ${baseQuestion.id}:`, adaptedText.substring(0, 100) + '...');
      return {
        ...baseQuestion,
        question: adaptedText,
        adapted: true
      };
    }
  } catch (err: any) {
    console.warn(`Failed to adapt question ${baseQuestion.id}:`, err.message);
  }

  return baseQuestion;
}

// Next question endpoint with optional conversation history
router.post("/nextquestion", async (req, res) => {
  try {
    const { idx, conversationHistory, sessionId } = req.body || {};
    const questionIndex = parseInt(String(idx || "0"), 10) || 0;
    
    // Get session-specific questions if available
    let sessionQuestions = questions;
    if (sessionId && quizSessions.has(sessionId)) {
      sessionQuestions = quizSessions.get(sessionId)!;
    }
    
    const baseQuestion = sessionQuestions[questionIndex] || null;
    
    if (!baseQuestion) {
      return res.json({ question: null, nextIndex: questionIndex + 1 });
    }

    // If we have conversation history and OpenAI is configured, adapt the question
    if (conversationHistory && conversationHistory.length > 0) {
      try {
        const adaptedQuestion = await adaptQuestionBasedOnHistory(baseQuestion, conversationHistory);
        return res.json({ question: adaptedQuestion, nextIndex: questionIndex + 1 });
      } catch (err) {
        console.warn("Failed to adapt question, using base question:", err);
      }
    }
    
    res.json({ question: baseQuestion, nextIndex: questionIndex + 1 });
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: err.message || String(err) });
  }
});

// Legacy GET endpoint for backward compatibility
// Initialize a new quiz session with random questions
router.post("/start-quiz", (req, res) => {
  const { sessionId } = req.body;
  if (!sessionId) {
    return res.status(400).json({ error: "sessionId required" });
  }
  
  // Generate random question selection for this session
  const sessionQuestions = generateQuizQuestions();
  quizSessions.set(sessionId, sessionQuestions);
  
  console.log(`🎲 Started quiz session ${sessionId} with ${sessionQuestions.length} questions`);
  
  res.json({ 
    totalQuestions: sessionQuestions.length,
    message: "Quiz session initialized" 
  });
});

router.get("/nextquestion", (req, res) => {
  const idx = parseInt(String(req.query.idx || "0"), 10) || 0;
  const sessionId = String(req.query.sessionId || "");
  
  // If sessionId provided, use session-specific questions
  let sessionQuestions = questions;
  if (sessionId && quizSessions.has(sessionId)) {
    sessionQuestions = quizSessions.get(sessionId)!;
  }
  
  const q = sessionQuestions[idx] || null;
  res.json({ question: q, nextIndex: idx + 1 });
});

// Evaluate endpoint: receives { transcript, question }
router.post("/evaluate", async (req, res) => {
  try {
     const { transcript, question, audioBase64, sessionId } = req.body;
     if (!transcript || !question) return res.status(400).json({ error: "Missing fields" });

     const evaluation = await evaluateController(transcript, question);
     // Persist using local store (or Cosmos when configured)
     await saveSession({ sessionId, questionId: question.id, transcript, evaluation, timestamp: new Date().toISOString() });
     res.json({ evaluation });
  } catch (err: any) {
     console.error(err);
     res.status(500).json({ error: err.message || String(err) });
  }
});

// Evaluate all answers at the end of the quiz
// Expects: { sessionId: string, answers: Array<{ questionId: string, transcript: string }> }
router.post("/evaluate-all", async (req, res) => {
  try {
    const { sessionId, answers } = req.body || {};
    console.log("evaluate-all received:", { sessionId, answersCount: answers?.length, body: req.body });
    if (!Array.isArray(answers) || !answers.length) {
      console.error("Invalid answers:", { isArray: Array.isArray(answers), length: answers?.length, answers });
      return res.status(400).json({ error: "answers array required" });
    }

    const byId = new Map(questions.map(q => [q.id, q] as const));
    const results: any[] = [];
    for (const a of answers) {
      const q = byId.get(a.questionId);
      if (!q) continue;
      const evaluation = await evaluateController(a.transcript || "", q);
      const links = learnLinksByTopic[q.topic as string] || [];
      results.push({ questionId: q.id, heading: q.heading, topic: q.topic, evaluation, learnLinks: links });
    }

    const scores = results.map(r => Number(r.evaluation?.score || 0));
    const overallScore = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0;
    
    // Note: Session saving is now handled by frontend calling POST /api/sessions
    // This allows the frontend to include user profile data (name, email, confidence levels)
    
    res.json({ overallScore, results });
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: err.message || String(err) });
  }
});

export default router;

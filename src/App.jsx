import { useState, useRef, useEffect, useCallback } from "react";

// ═══════════════════════════════════════════════════════════════
// STORAGE — localStorage with graceful fallback
// ═══════════════════════════════════════════════════════════════

const Storage = {
  get(key) {
    try { return JSON.parse(localStorage.getItem(`pc_${key}`)); } catch { return null; }
  },
  set(key, val) {
    try { localStorage.setItem(`pc_${key}`, JSON.stringify(val)); } catch {}
  },
};

// ═══════════════════════════════════════════════════════════════
// API — with retry logic and streaming
// ═══════════════════════════════════════════════════════════════

async function callClaude(systemPrompt, messages, maxTokens = 1000, retries = 3) {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ system: systemPrompt, messages, max_tokens: maxTokens }),
      });
      const data = await res.json();
      if (data.error) {
        if (res.status === 429 && attempt < retries - 1) {
          await new Promise(r => setTimeout(r, 1500 * (attempt + 1)));
          continue;
        }
        throw new Error(data.error);
      }
      return data.content?.map(b => b.text || "").join("") || "";
    } catch (e) {
      if (attempt === retries - 1) throw e;
      await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
    }
  }
}

async function streamClaude(systemPrompt, messages, maxTokens, onChunk, onDone) {
  const res = await fetch("/api/stream", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ system: systemPrompt, messages, max_tokens: maxTokens }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Stream failed" }));
    throw new Error(err.error || "Stream failed");
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let fullText = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      if (line.startsWith("data: ")) {
        const raw = line.slice(6).trim();
        if (!raw || raw === "[DONE]") continue;
        try {
          const parsed = JSON.parse(raw);
          if (parsed.type === "content_block_delta" && parsed.delta?.text) {
            fullText += parsed.delta.text;
            onChunk(fullText);
          }
        } catch {}
      }
    }
  }
  onDone(fullText);
  return fullText;
}

// ═══════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════

const DETAIL_LEVELS = [
  { id: "instant", label: "Instant", tagline: "No questions asked", desc: "Just tell us the topic and we'll generate a solid prompt immediately.", icon: "⚡", iconColor: "#c9a84c", questionCount: 0, maxQuestions: 0, maxTokens: 1000 },
  { id: "standard", label: "Standard", tagline: "A well-rounded prompt", desc: "We'll ask only what we need — usually 2–4 targeted questions.", icon: "◈", questionCount: 3, maxQuestions: 5, maxTokens: 1500 },
  { id: "detailed", label: "Detailed", tagline: "Comprehensive, expert-level", desc: "We'll ask up to 10 strategic questions, stopping as soon as we have everything needed.", icon: "✦", questionCount: 5, maxQuestions: 10, maxTokens: 2500 },
];

const AI_PLATFORMS = [
  { id: "chatgpt", label: "ChatGPT" }, { id: "claude", label: "Claude" },
  { id: "gemini", label: "Gemini" }, { id: "copilot", label: "Copilot" },
  { id: "perplexity", label: "Perplexity" }, { id: "midjourney", label: "Midjourney" },
  { id: "grok", label: "Grok" }, { id: "meta", label: "Meta AI" },
];

// ═══════════════════════════════════════════════════════════════
// TEMPLATES
// ═══════════════════════════════════════════════════════════════

const TEMPLATE_CATEGORIES = ["All", "Writing", "Code", "Build", "Business", "Creative", "Education", "Data"];

const TEMPLATES = [
  { id: "blog", name: "Blog Post Writer", cat: "Writing", icon: "📝", desc: "Structured blog post with intro, body, and conclusion", depth: "standard", platform: "ChatGPT", topic: "Write a blog post about " },
  { id: "email-campaign", name: "Email Campaign", cat: "Writing", icon: "📧", desc: "Persuasive marketing email sequence", depth: "detailed", platform: "ChatGPT", topic: "Create an email campaign for " },
  { id: "social-media", name: "Social Media Calendar", cat: "Writing", icon: "📱", desc: "A week of platform-specific social posts", depth: "standard", platform: "ChatGPT", topic: "Create a social media content calendar for " },
  { id: "cover-letter", name: "Cover Letter", cat: "Writing", icon: "💌", desc: "Tailored cover letter for a job application", depth: "standard", platform: "Claude", topic: "Write a cover letter for a position as " },
  { id: "product-desc", name: "Product Description", cat: "Writing", icon: "🏷️", desc: "Compelling product copy for e-commerce", depth: "instant", platform: "ChatGPT", topic: "Write a product description for " },
  { id: "code-review", name: "Code Review", cat: "Code", icon: "🔍", desc: "Thorough code review with suggestions", depth: "detailed", platform: "Claude", topic: "Review this code and suggest improvements: " },
  { id: "debug", name: "Debug Helper", cat: "Code", icon: "🐛", desc: "Find and fix bugs in your code", depth: "standard", platform: "Claude", topic: "Help me debug this issue: " },
  { id: "docs", name: "Documentation Generator", cat: "Code", icon: "📄", desc: "Generate docs from code or requirements", depth: "detailed", platform: "Claude", topic: "Write documentation for " },
  { id: "api-design", name: "API Designer", cat: "Code", icon: "🔌", desc: "Design a REST or GraphQL API", depth: "detailed", platform: "Claude", topic: "Design an API for " },
  { id: "swot", name: "SWOT Analysis", cat: "Business", icon: "📊", desc: "Comprehensive strengths/weaknesses/opportunities/threats", depth: "detailed", platform: "ChatGPT", topic: "Perform a SWOT analysis for " },
  { id: "pitch", name: "Pitch Deck Outline", cat: "Business", icon: "🎯", desc: "Investor pitch deck structure and content", depth: "detailed", platform: "Claude", topic: "Create a pitch deck outline for " },
  { id: "meeting", name: "Meeting Agenda", cat: "Business", icon: "📋", desc: "Structured meeting agenda with time allocations", depth: "instant", platform: "ChatGPT", topic: "Create a meeting agenda for " },
  { id: "okr", name: "OKR Builder", cat: "Business", icon: "🎯", desc: "Draft objectives and key results", depth: "standard", platform: "Claude", topic: "Draft OKRs for " },
  { id: "story", name: "Story Outline", cat: "Creative", icon: "📖", desc: "Plot structure, characters, and story beats", depth: "detailed", platform: "ChatGPT", topic: "Create a story outline about " },
  { id: "brainstorm", name: "Brainstorming Session", cat: "Creative", icon: "💡", desc: "Generate creative ideas with structured exploration", depth: "standard", platform: "Claude", topic: "Brainstorm ideas for " },
  { id: "character", name: "Character Builder", cat: "Creative", icon: "🧑‍🎨", desc: "Develop a detailed fictional character", depth: "detailed", platform: "ChatGPT", topic: "Create a character for " },
  { id: "lesson", name: "Lesson Plan", cat: "Education", icon: "🎓", desc: "Structured lesson plan with objectives and activities", depth: "detailed", platform: "Claude", topic: "Create a lesson plan for teaching " },
  { id: "study-guide", name: "Study Guide", cat: "Education", icon: "📚", desc: "Comprehensive study guide for any subject", depth: "standard", platform: "ChatGPT", topic: "Create a study guide for " },
  { id: "quiz", name: "Quiz Generator", cat: "Education", icon: "❓", desc: "Generate quiz questions with answer key", depth: "standard", platform: "ChatGPT", topic: "Create a quiz about " },
  { id: "data-analysis", name: "Data Analysis", cat: "Data", icon: "📈", desc: "Analyze a dataset and extract insights", depth: "detailed", platform: "Claude", topic: "Analyze this data and provide insights: " },
  { id: "sql-builder", name: "SQL Query Builder", cat: "Data", icon: "🗃️", desc: "Generate SQL queries from plain English", depth: "standard", platform: "ChatGPT", topic: "Write a SQL query to " },
  { id: "landing-page", name: "Landing Page", cat: "Build", icon: "🌐", desc: "Full landing page with hero, features, CTA sections", depth: "detailed", platform: "Claude", topic: "Build a landing page for " },
  { id: "saas-app", name: "SaaS App Blueprint", cat: "Build", icon: "🚀", desc: "Full-stack SaaS architecture with auth, billing, and core features", depth: "detailed", platform: "Claude", topic: "Design and build a SaaS application for " },
  { id: "mobile-app", name: "Mobile App Design", cat: "Build", icon: "📲", desc: "React Native or Flutter app with screens and navigation", depth: "detailed", platform: "Claude", topic: "Build a mobile app that " },
  { id: "dashboard", name: "Admin Dashboard", cat: "Build", icon: "🖥️", desc: "Data-rich admin panel with charts, tables, and controls", depth: "detailed", platform: "Claude", topic: "Build an admin dashboard for " },
  { id: "portfolio", name: "Portfolio Website", cat: "Build", icon: "✨", desc: "Personal or agency portfolio with projects and contact", depth: "standard", platform: "Claude", topic: "Build a portfolio website for " },
  { id: "ecommerce", name: "E-Commerce Store", cat: "Build", icon: "🛒", desc: "Online store with product listings, cart, and checkout", depth: "detailed", platform: "Claude", topic: "Build an e-commerce store for " },
];

// ═══════════════════════════════════════════════════════════════
// SYSTEM PROMPTS
// ═══════════════════════════════════════════════════════════════

function getQuestionsSystem(detail) {
  const d = DETAIL_LEVELS.find(l => l.id === detail);
  return `You are part of an AI prompt generator tool. The user told you which AI they're writing for and their topic.

RULES:
- Return ONLY valid JSON — no markdown, no backticks, no explanation
- Format: { "questions": [ { "id": "q1", "question": "...", "placeholder": "..." }, ... ] }
- Ask between 1 and ${d.maxQuestions} questions — ask only what is truly necessary to write an excellent prompt
- Start with the single most critical piece of missing information, then continue only if additional questions would meaningfully improve the result
- Stop asking once you have enough — do NOT pad with unnecessary questions just to reach a maximum
- ${detail === "standard" ? "Focus on: primary goal and intended audience. Add format/tone only if the topic is ambiguous." : "Cover: goal, audience, format, tone, constraints, and any domain-specific details the AI would need. Each question must earn its place."}
- Tailor every question to the specific AI platform and topic
- Keep questions conversational and concrete
- Placeholders should be specific, realistic examples`;
}

function getPromptSystem(detail) {
  const d = DETAIL_LEVELS.find(l => l.id === detail);
  return `You are an expert AI prompt engineer. Build a prompt optimized for the target AI platform.

RULES:
- Return ONLY the prompt text — no explanations, no labels, no markdown formatting
- Optimize for the target AI platform's strengths
- ${detail === "instant"
    ? "You only have the topic — infer reasonable defaults. Write 2-4 clear sentences."
    : detail === "standard"
    ? "Include a role/persona, task, key context, and format guidance. 4-6 sentences."
    : "Include detailed role/persona, comprehensive task, all context, constraints, tone, and output format. 6-10 sentences."}
- Write directed at the AI (e.g. "You are..." or "Act as...")
- Never include meta-commentary`;
}

const REFINE_SYSTEM = `You are helping refine an AI prompt. The user will share the current prompt and request specific changes. Apply ONLY the requested changes while keeping everything else intact. Return ONLY the updated prompt text — no explanations, no labels, no markdown formatting. Never say things like "Here's the updated prompt" — just return the prompt itself.`;

// ═══════════════════════════════════════════════════════════════
// EXPORT HELPERS
// ═══════════════════════════════════════════════════════════════

function exportAsMarkdown(prompt, targetAI, detail, topic) {
  return `# Obsidia AI — Generated Prompt\n\n**Platform:** ${targetAI}  \n**Detail Level:** ${detail}  \n**Topic:** ${topic}  \n**Generated:** ${new Date().toLocaleDateString()}\n\n---\n\n\`\`\`\n${prompt}\n\`\`\`\n`;
}

function downloadFile(content, filename) {
  const blob = new Blob([content], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ═══════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════

export default function ObsidiaAI() {
  // Steps: 0=depth, 1=platform, 2=topic, 3=loading-q, 4=questions, 5=generating, 6=result
  const [step, setStep] = useState(0);
  const [showTemplates, setShowTemplates] = useState(false);
  const [templateCat, setTemplateCat] = useState("All");
  const [detailLevel, setDetailLevel] = useState(null);
  const [targetAI, setTargetAI] = useState("");
  const [topic, setTopic] = useState("");
  const [questions, setQuestions] = useState([]);
  const [answers, setAnswers] = useState({});
  const [generatedPrompt, setGeneratedPrompt] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copiedMd, setCopiedMd] = useState(false);
  const [error, setError] = useState("");
  const [history, setHistory] = useState([]);
  const [showHistory, setShowHistory] = useState(false);
  const [hoveredDetail, setHoveredDetail] = useState(null);
  const [hoveredAI, setHoveredAI] = useState(null);
  const [showPromptTip, setShowPromptTip] = useState(false);

  // Refinement state
  const [refineInput, setRefineInput] = useState("");
  const [refineHistory, setRefineHistory] = useState([]); // [{role, content}]
  const [isRefining, setIsRefining] = useState(false);
  const [promptVersions, setPromptVersions] = useState([]); // all versions of the prompt

  const bottomRef = useRef(null);
  const topicRef = useRef(null);
  const aiRef = useRef(null);
  const refineRef = useRef(null);

  // ── Load from storage on mount ──
  useEffect(() => {
    const saved = Storage.get("history");
    if (saved?.length) setHistory(saved.map(h => ({ ...h, time: new Date(h.time) })));
    const prefs = Storage.get("prefs");
    if (prefs?.lastDepth) {
      const d = DETAIL_LEVELS.find(l => l.id === prefs.lastDepth);
      if (d) setDetailLevel(d);
    }
    if (prefs?.lastPlatform) setTargetAI(prefs.lastPlatform);
  }, []);

  // ── Save history to storage ──
  useEffect(() => {
    if (history.length) Storage.set("history", history);
  }, [history]);

  // ── Save prefs ──
  useEffect(() => {
    if (detailLevel || targetAI) {
      Storage.set("prefs", { lastDepth: detailLevel?.id, lastPlatform: targetAI });
    }
  }, [detailLevel, targetAI]);

  // ── Tab-to-complete placeholder ──
  useEffect(() => {
    const handleTab = (e) => {
      if (e.key !== "Tab") return;
      const el = e.target;
      if ((el.tagName !== "INPUT" && el.tagName !== "TEXTAREA") || !el.placeholder || el.value.trim() || el.dataset.tabcycle) return;
      e.preventDefault();
      const proto = el.tagName === "TEXTAREA" ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, "value").set;
      setter.call(el, el.placeholder);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    };
    document.addEventListener("keydown", handleTab);
    return () => document.removeEventListener("keydown", handleTab);
  }, []);

  // ── Scroll to top on initial load ──
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "instant" });
  }, []);

  // ── Scroll to top on step transitions and panel toggles ──
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, [step, showTemplates, showHistory]);

  // ── Scroll to bottom only while actively streaming new content ──
  useEffect(() => {
    if (isStreaming) bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [generatedPrompt, isStreaming]);

  // ── Scroll to bottom when refinement history grows ──
  useEffect(() => {
    if (refineHistory.length > 0) bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [refineHistory]);

  useEffect(() => {
    if (step === 1) setTimeout(() => aiRef.current?.focus(), 300);
    if (step === 2) setTimeout(() => topicRef.current?.focus(), 200);
  }, [step]);

  // ── Get max tokens for current detail level ──
  const getMaxTokens = () => detailLevel?.maxTokens || 1000;
  const isInstant = detailLevel?.id === "instant";

  // ── Handlers ──

  const pickDetail = (level) => { setDetailLevel(level); setStep(1); };

  const useTemplate = (t) => {
    const d = DETAIL_LEVELS.find(l => l.id === t.depth);
    setDetailLevel(d);
    setTargetAI(t.platform);
    setTopic(t.topic);
    setShowTemplates(false);
    setStep(2);
  };

  const submitAI = () => { if (targetAI.trim()) setStep(2); };

  const submitTopic = async () => {
    if (!topic.trim()) return;
    if (isInstant) {
      generatePrompt();
      return;
    }
    setStep(3);
    setError("");
    try {
      const raw = await callClaude(
        getQuestionsSystem(detailLevel.id),
        [{ role: "user", content: `Target AI: ${targetAI}\nTopic: ${topic}\nDetail level: ${detailLevel.label}` }],
        1000
      );
      const cleaned = raw.replace(/```json|```/g, "").trim();
      const parsed = JSON.parse(cleaned);
      if (parsed.questions?.length) {
        setQuestions(parsed.questions);
        setAnswers({});
        setStep(4);
      } else throw new Error("No questions");
    } catch (e) {
      setError(e.message || "Failed to generate questions. Please try again.");
      setStep(2);
    }
  };

  const generatePrompt = async (fromAnswers = false) => {
    setStep(5);
    setError("");
    setGeneratedPrompt("");
    setIsStreaming(true);
    setRefineHistory([]);
    setRefineInput("");
    setPromptVersions([]);

    let userContent = `Target AI: ${targetAI}\nTopic: ${topic}\nDetail level: ${detailLevel.label}`;
    if (fromAnswers && questions.length) {
      const qaPairs = questions.map(q => `Q: ${q.question}\nA: ${answers[q.id] || "(skipped)"}`).join("\n\n");
      userContent += `\n\nFollow-up Q&A:\n${qaPairs}`;
    }

    try {
      setStep(6);
      await streamClaude(
        getPromptSystem(detailLevel.id),
        [{ role: "user", content: userContent }],
        getMaxTokens(),
        (partial) => setGeneratedPrompt(partial),
        (final) => {
          setIsStreaming(false);
          setPromptVersions([final.trim()]);
          const entry = { prompt: final.trim(), topic, targetAI, detail: detailLevel.label, time: new Date() };
          setHistory(prev => [entry, ...prev].slice(0, 30));
        }
      );
    } catch (e) {
      setIsStreaming(false);
      setError(e.message || "Failed to generate prompt. Please try again.");
      setStep(fromAnswers ? 4 : 2);
    }
  };

  const submitAnswers = () => generatePrompt(true);

  // ── Refinement ──
  const submitRefinement = async () => {
    if (!refineInput.trim() || isRefining) return;
    const instruction = refineInput.trim();
    setRefineInput("");
    setIsRefining(true);
    setError("");

    const newHistory = [
      ...refineHistory,
      { role: "user", content: `Current prompt:\n"${generatedPrompt}"\n\nRequested change: ${instruction}` },
    ];
    // Only send last few turns to stay within token limits
    const recentMessages = newHistory.slice(-6);

    try {
      setIsStreaming(true);
      let finalText = "";
      await streamClaude(
        REFINE_SYSTEM,
        recentMessages,
        getMaxTokens(),
        (partial) => setGeneratedPrompt(partial),
        (final) => {
          finalText = final.trim();
          setIsStreaming(false);
          setPromptVersions(prev => [...prev, finalText]);
          setRefineHistory([...newHistory, { role: "assistant", content: finalText }]);
          // Update history
          setHistory(prev => {
            const updated = [...prev];
            if (updated[0]) updated[0] = { ...updated[0], prompt: finalText };
            return updated;
          });
        }
      );
    } catch (e) {
      setIsStreaming(false);
      setError(e.message || "Refinement failed. Please try again.");
    }
    setIsRefining(false);
  };

  const revertToVersion = (idx) => {
    setGeneratedPrompt(promptVersions[idx]);
  };

  // ── Regenerate ──
  const regenerate = async () => {
    setStep(5);
    setIsStreaming(true);
    setGeneratedPrompt("");
    setRefineHistory([]);
    setRefineInput("");
    setError("");

    let userContent = `Target AI: ${targetAI}\nTopic: ${topic}\nDetail level: ${detailLevel.label}`;
    if (questions.length) {
      const qaPairs = questions.map(q => `Q: ${q.question}\nA: ${answers[q.id] || "(skipped)"}`).join("\n\n");
      userContent += `\n\nFollow-up Q&A:\n${qaPairs}`;
    }
    userContent += `\n\nGenerate a DIFFERENT variation.`;

    try {
      setStep(6);
      await streamClaude(
        getPromptSystem(detailLevel.id),
        [{ role: "user", content: userContent }],
        getMaxTokens(),
        (partial) => setGeneratedPrompt(partial),
        (final) => {
          setIsStreaming(false);
          setPromptVersions([final.trim()]);
          const entry = { prompt: final.trim(), topic, targetAI, detail: detailLevel.label, time: new Date() };
          setHistory(prev => [entry, ...prev].slice(0, 30));
        }
      );
    } catch (e) {
      setIsStreaming(false);
      setError(e.message || "Regeneration failed.");
    }
  };

  // ── Export ──
  const handleCopy = () => { navigator.clipboard.writeText(generatedPrompt); setCopied(true); setTimeout(() => setCopied(false), 2500); };
  const handleCopyMarkdown = () => {
    navigator.clipboard.writeText(exportAsMarkdown(generatedPrompt, targetAI, detailLevel?.label, topic));
    setCopiedMd(true); setTimeout(() => setCopiedMd(false), 2500);
  };
  const handleDownload = () => {
    downloadFile(generatedPrompt, `obsidia-ai-${Date.now()}.txt`);
  };

  const startOver = () => {
    setStep(0); setDetailLevel(null); setTargetAI(""); setTopic(""); setQuestions([]); setAnswers({});
    setGeneratedPrompt(""); setCopied(false); setError(""); setRefineHistory([]); setRefineInput("");
    setPromptVersions([]); setIsStreaming(false); setShowTemplates(false);
  };

  const answeredCount = questions.filter(q => answers[q.id]?.trim()).length;

  // ── Progress ──
  const progressSteps = isInstant ? ["Depth", "AI", "Topic", "Prompt"] : ["Depth", "AI", "Topic", "Questions", "Prompt"];
  const getProgressWidth = () => {
    if (isInstant) return step === 0 ? "0%" : step === 1 ? "33%" : step === 2 ? "66%" : "100%";
    return step === 0 ? "0%" : step === 1 ? "25%" : step === 2 ? "50%" : step <= 4 ? "75%" : "100%";
  };
  const isStepActive = (i) => {
    const map = isInstant ? [0, 1, 2, 6] : [0, 1, 2, 4, 6];
    return step >= map[i];
  };

  // ═══════════════════════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════════════════════

  return (
    <div style={S.page}>
      <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700;800&family=Cormorant+Garamond:wght@600;700&display=swap" rel="stylesheet" />
      <div style={S.glowTop} /><div style={S.glowBot} /><div style={S.grain} />

      <div style={S.container}>
        {/* Header */}
        <header style={S.header}>
          <div style={S.logoBadge}><span style={{ fontSize: "14px" }}>✦</span> Obsidia AI</div>
          <h1 style={S.title}>Craft Your <span style={S.goldText}>Perfect Prompt</span> With <span style={S.goldText}>Obsidia AI</span></h1>
          <p style={S.subtitle}>Tell us what you need, answer a few quick questions, and get an expert-level AI prompt — tailored to your platform and ready to paste.</p>
          <div style={S.divider}><div style={S.divLine} /><span style={S.divDot}>◈</span><div style={S.divLine} /></div>
        </header>

        {/* Progress */}
        <div style={S.progressWrap}>
          <div style={S.progressTrack}><div style={{ ...S.progressFill, width: getProgressWidth() }} /></div>
          <div style={S.progressLabels}>
            {progressSteps.map((l, i) => <span key={i} style={{ ...S.progressLabel, color: isStepActive(i) ? "#c9a84c" : "#3a3632" }}>{l}</span>)}
          </div>
        </div>

        {/* ═══ Step 0: Depth ═══ */}
        {step === 0 && (
          <Fade>
            <SH title="How detailed of a prompt do you need?" desc="This determines how many questions we'll ask and how thorough the final prompt will be." />
            <div style={S.detailGrid}>
              {DETAIL_LEVELS.map(level => (
                <button key={level.id} onClick={() => pickDetail(level)}
                  onMouseEnter={() => setHoveredDetail(level.id)} onMouseLeave={() => setHoveredDetail(null)}
                  style={{ ...S.detailCard, borderColor: hoveredDetail === level.id ? "rgba(201,168,76,0.5)" : "rgba(255,255,255,0.05)", background: hoveredDetail === level.id ? "rgba(201,168,76,0.04)" : "rgba(255,255,255,0.015)", transform: hoveredDetail === level.id ? "translateY(-4px)" : "translateY(0)", boxShadow: hoveredDetail === level.id ? "0 12px 40px rgba(201,168,76,0.08)" : "none" }}>
                  <div style={{ ...S.detailIcon, ...(level.iconColor ? { filter: "sepia(1) saturate(2) hue-rotate(5deg) brightness(0.95)" } : {}) }}>{level.icon}</div>
                  <div style={S.detailLabel}>{level.label}</div>
                  <div style={S.detailTagline}>{level.tagline}</div>
                  <div style={S.detailDesc}>{level.desc}</div>
                  <span style={S.detailBadge}>{level.maxQuestions === 0 ? "No questions" : `Up to ${level.maxQuestions} questions`}</span>
                </button>
              ))}
            </div>

            {/* Template & History toggles */}
            <div style={{ marginTop: "28px", display: "flex", justifyContent: "center", gap: "10px", flexWrap: "wrap" }}>
              <button onClick={() => { setShowTemplates(!showTemplates); if (!showTemplates) setShowHistory(false); }} className="btn-secondary" style={{ ...S.secBtn, display: "inline-flex", alignItems: "center", gap: "6px", borderColor: showTemplates ? "rgba(201,168,76,0.3)" : "white", color: showTemplates ? "#c9a84c" : "#d0ccc6" }}>
                {showTemplates ? "Hide templates" : "📋 Templates"}
              </button>
              <button onClick={() => { setShowHistory(!showHistory); if (!showHistory) setShowTemplates(false); }} className="btn-secondary" style={{ ...S.secBtn, display: "inline-flex", alignItems: "center", gap: "6px", borderColor: showHistory ? "rgba(201,168,76,0.3)" : "white", color: showHistory ? "#c9a84c" : "#d0ccc6" }}>
                🕘 History {history.length > 0 && <span style={S.histCount}>{history.length}</span>}
              </button>
            </div>

            {/* Template browser */}
            {showTemplates && (
              <Fade>
                <div style={{ marginTop: "24px" }}>
                  <div style={S.templateCatBar}>
                    {TEMPLATE_CATEGORIES.map(c => (
                      <button key={c} onClick={() => setTemplateCat(c)} style={{ ...S.templateCatBtn, color: templateCat === c ? "#c9a84c" : "#6d675e", borderColor: templateCat === c ? "rgba(201,168,76,0.3)" : "transparent", background: templateCat === c ? "rgba(201,168,76,0.06)" : "transparent" }}>{c}</button>
                    ))}
                  </div>
                  <div style={S.templateGrid}>
                    {TEMPLATES.filter(t => templateCat === "All" || t.cat === templateCat).map(t => (
                      <button key={t.id} onClick={() => useTemplate(t)} className="template-card" style={S.templateCard}>
                        <span style={{ fontSize: "20px" }}>{t.icon}</span>
                        <div style={{ fontSize: "14px", fontWeight: 600, color: "#e8e4db" }}>{t.name}</div>
                        <div style={{ fontSize: "12px", color: "#6d675e", lineHeight: 1.4 }}>{t.desc}</div>
                        <div style={{ display: "flex", gap: "6px", marginTop: "auto" }}>
                          <span style={S.tinyTag}>{t.platform}</span>
                          <span style={S.tinyTag}>{t.depth}</span>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              </Fade>
            )}

            {/* History panel on depth page */}
            {showHistory && (
              <Fade>
                <div style={{ marginTop: "24px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "14px" }}>
                    <div style={{ fontSize: "12px", fontWeight: 700, color: "#c9a84c", textTransform: "uppercase", letterSpacing: "1px" }}>Recent Prompts</div>
                    {history.length > 0 && <button onClick={() => { setHistory([]); Storage.set("history", []); }} className="btn-secondary" style={{ ...S.secBtn, fontSize: "11px", padding: "6px 12px", color: "#5a554c" }}>Clear all</button>}
                  </div>
                  {history.length === 0 ? (
                    <div style={{ padding: "40px 20px", textAlign: "center", borderRadius: "14px", background: "rgba(255,255,255,0.015)", border: "1px solid rgba(255,255,255,0.45)" }}>
                      <div style={{ fontSize: "28px", marginBottom: "12px" }}>🕘</div>
                      <div style={{ fontSize: "15px", fontWeight: 500, color: "#8a857c", marginBottom: "6px" }}>No history yet</div>
                      <div style={{ fontSize: "13px", color: "#5a554c", lineHeight: 1.5 }}>Your generated prompts will appear here so you can reuse them anytime.</div>
                    </div>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                      {history.map((h, i) => (
                      <div key={i} className="hist-item" style={S.histItem}
                        onClick={() => { setGeneratedPrompt(h.prompt); setTargetAI(h.targetAI); setCopied(false); setRefineHistory([]); setPromptVersions([h.prompt]); setStep(6); }}>
                        <div style={S.histTop}>
                          <div style={{ display: "flex", gap: "6px" }}>
                            <span style={S.histTag}>{h.targetAI}</span>
                            <span style={S.histTag}>{h.detail}</span>
                          </div>
                          <span style={{ fontSize: "11px", color: "#3a3632" }}>{h.time instanceof Date ? h.time.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : ""}</span>
                        </div>
                        <div style={{ fontSize: "14px", fontWeight: 500, color: "#b0aa9f", marginBottom: "4px" }}>{h.topic}</div>
                        <div style={{ fontSize: "12px", color: "#5a554c", lineHeight: 1.4 }}>{h.prompt.length > 100 ? h.prompt.slice(0, 100) + "..." : h.prompt}</div>
                      </div>
                    ))}
                  </div>
                  )}
                </div>
              </Fade>
            )}
          </Fade>
        )}

        {/* ═══ Step 1: AI Platform ═══ */}
        {step === 1 && (
          <Fade>
            <SH title="What AI will you be generating this prompt for?" desc="Select one below or type your own." />
            <div style={S.card}>
              <div style={S.aiChipsWrap}>
                {AI_PLATFORMS.map(ai => {
                  const sel = targetAI === ai.label;
                  const hov = hoveredAI === ai.id;
                  return (
                    <button key={ai.id} onClick={() => setTargetAI(ai.label)} onMouseEnter={() => setHoveredAI(ai.id)} onMouseLeave={() => setHoveredAI(null)}
                      style={{ ...S.aiChip, borderColor: sel ? "rgba(201,168,76,0.5)" : hov ? "rgba(201,168,76,0.25)" : "rgba(255,255,255,0.06)", background: sel ? "rgba(201,168,76,0.1)" : hov ? "rgba(201,168,76,0.03)" : "rgba(255,255,255,0.02)", color: sel ? "#c9a84c" : hov ? "#b0aa9f" : "#7a756c", transform: hov && !sel ? "translateY(-1px)" : "translateY(0)" }}>
                      {ai.label}{sel && <span style={{ marginLeft: "6px", fontSize: "11px" }}>✓</span>}
                    </button>
                  );
                })}
              </div>
              <div style={S.orDivider}><div style={S.orLine} /><span style={S.orText}>or type your own</span><div style={S.orLine} /></div>
              <input ref={aiRef} type="text" value={targetAI} onChange={e => setTargetAI(e.target.value)} placeholder="Type an AI platform name..." style={S.input} data-tabcycle="true"
                onKeyDown={e => {
                  if (e.key === "Tab") {
                    e.preventDefault();
                    const labels = AI_PLATFORMS.map(a => a.label);
                    const idx = labels.indexOf(targetAI);
                    setTargetAI(labels[(idx + 1) % labels.length]);
                    return;
                  }
                  if (e.key === "Enter") submitAI();
                }} />
              <div style={S.cardActions}>
                <BtnBack onClick={() => { setStep(0); setDetailLevel(null); setTargetAI(""); }} />
                <BtnPrimary onClick={submitAI} disabled={!targetAI.trim()} label="Next →" />
              </div>
            </div>
          </Fade>
        )}

        {/* ═══ Step 2: Topic ═══ */}
        {step === 2 && (
          <Fade>
            <SH title={`What do you need ${targetAI} to do?`} desc={isInstant ? "Describe your topic — we'll generate your prompt instantly." : "Describe your topic or goal."} />
            <div style={S.card}>
              <label style={S.inputLabel}>Your topic or goal</label>
              <textarea ref={topicRef} value={topic} onChange={e => setTopic(e.target.value)}
                placeholder='e.g. "Write a blog post about remote work culture" or "Help me build a 30-day fitness plan"'
                style={S.textarea} rows={4}
                onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submitTopic(); } }} />
              <div style={S.cardActions}>
                <BtnBack onClick={() => { setStep(1); setTopic(""); }} />
                <BtnPrimary onClick={submitTopic} disabled={!topic.trim()} label={isInstant ? "Generate prompt →" : "Next — Ask me questions →"} />
              </div>
            </div>
          </Fade>
        )}

        {/* ═══ Step 3: Loading questions ═══ */}
        {step === 3 && (
          <Fade><div style={S.loadBox}><GoldSpinner /><p style={S.loadTitle}>Preparing your questions...</p><p style={S.loadSub}>Crafting {detailLevel?.questionCount} personalized questions for your {targetAI} prompt</p></div></Fade>
        )}

        {/* ═══ Step 4: Questions ═══ */}
        {step === 4 && (
          <Fade>
            <SH title={detailLevel?.id === "standard" ? "A few questions to fine-tune" : "Let's get the details right"} desc={`Your answers help build a better prompt for ${targetAI}.`} />
            {/* Context reference strip */}
            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginBottom: "20px", padding: "12px 16px", borderRadius: "10px", background: "rgba(201,168,76,0.03)", border: "1px solid rgba(201,168,76,0.08)" }}>
              <span style={{ fontSize: "10px", fontWeight: 700, color: "#6d675e", textTransform: "uppercase", letterSpacing: "0.8px", alignSelf: "center", marginRight: "4px" }}>Context:</span>
              <span style={{ fontSize: "12px", color: "#c9a84c", background: "rgba(201,168,76,0.06)", padding: "3px 10px", borderRadius: "4px", fontWeight: 600 }}>{targetAI}</span>
              <span style={{ fontSize: "12px", color: "#8a857c", background: "rgba(255,255,255,0.03)", padding: "3px 10px", borderRadius: "4px" }}>{detailLevel?.label}</span>
              <span style={{ fontSize: "12px", color: "#b0aa9f", background: "rgba(255,255,255,0.03)", padding: "3px 10px", borderRadius: "4px", fontStyle: "italic", maxWidth: "100%" }}>{topic.length > 60 ? topic.slice(0, 60) + "…" : topic}</span>
            </div>
            {error && <div style={S.errorBox}>{error}</div>}
            <div style={S.questionsWrap}>
              {questions.map((q, i) => (
                <div key={q.id} style={S.qCard}>
                  <div style={S.qNum}>{i + 1}</div>
                  <div style={{ flex: 1 }}>
                    <label style={S.qLabel}>{q.question}</label>
                    <textarea value={answers[q.id] || ""} onChange={e => setAnswers(a => ({ ...a, [q.id]: e.target.value }))} placeholder={q.placeholder} style={S.qInput} rows={2} />
                  </div>
                </div>
              ))}
            </div>
            <div style={S.cardActions}>
              <BtnBack onClick={() => { setStep(2); setQuestions([]); }} />
              <BtnPrimary onClick={submitAnswers} disabled={answeredCount === 0} label={<>Build my prompt{answeredCount > 0 && <span style={S.aBadge}>{answeredCount}/{questions.length}</span>}</>} />
            </div>
          </Fade>
        )}

        {/* ═══ Step 5: Generating (shown briefly before streaming kicks in) ═══ */}
        {step === 5 && (
          <Fade><div style={S.loadBox}><GoldSpinner /><p style={S.loadTitle}>Crafting your prompt...</p><p style={S.loadSub}>Building a {detailLevel?.label.toLowerCase()}-level prompt for {targetAI}</p></div></Fade>
        )}

        {/* ═══ Step 6: Result ═══ */}
        {step === 6 && (
          <Fade>
            <div style={{ textAlign: "center", marginBottom: "28px" }}>
              <div style={S.resultBadge}>✦ Your {targetAI} Prompt</div>
              <p style={S.resultSub}>{isStreaming ? "Generating..." : `${detailLevel?.label} prompt ready — copy and paste into ${targetAI}.`}</p>
            </div>
            {error && <div style={S.errorBox}>{error}</div>}

            {/* Result card */}
            <div style={{ ...S.resultCard, animation: isStreaming ? "none" : "goldPulse 3s ease infinite" }}>
              <div style={S.resultHeader}>
                <div style={S.resultMeta}>
                  <span style={S.metaTag}>{targetAI}</span>
                  <span style={{ color: "#3a3632", fontSize: "10px" }}>·</span>
                  <span style={S.metaTag}>{detailLevel?.label}</span>
                </div>
                {!isStreaming && <BtnCopy onClick={handleCopy} copied={copied} />}
              </div>
              <p style={{ ...S.resultText, opacity: isStreaming ? 0.8 : 1 }}>
                {generatedPrompt || " "}
                {isStreaming && <span style={S.cursor}>|</span>}
              </p>
            </div>

            {/* Export & action buttons */}
            {!isStreaming && (
              <Fade>
                <div style={S.exportBar}>
                  <button className="btn-secondary" onClick={handleCopy} style={S.exportBtn}>{copied ? "✓ Copied" : "📋 Copy"}</button>
                  <button className="btn-secondary" onClick={handleCopyMarkdown} style={S.exportBtn}>{copiedMd ? "✓ Copied" : "📝 Copy as Markdown"}</button>
                  <button className="btn-secondary" onClick={handleDownload} style={S.exportBtn}>💾 Download .txt</button>
                </div>

                <div style={{ display: "flex", gap: "10px", marginTop: "12px", flexWrap: "wrap" }}>
                  <BtnSecondary onClick={startOver} label="✦ New prompt" />
                  {!isInstant && <BtnSecondary onClick={() => { setStep(4); setGeneratedPrompt(""); setRefineHistory([]); setPromptVersions([]); }} label="↻ Edit answers" />}
                  <BtnPrimary onClick={regenerate} label="⟳ Different version" />
                </div>

                {/* Version history */}
                {promptVersions.length > 1 && (
                  <div style={S.versionsBox}>
                    <div style={S.versionsTitle}>Version History</div>
                    <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                      {promptVersions.map((v, i) => (
                        <button key={i} onClick={() => revertToVersion(i)} className="btn-secondary"
                          style={{ ...S.versionBtn, borderColor: generatedPrompt === v ? "rgba(201,168,76,0.3)" : "rgba(255,255,255,0.04)" }}>
                          <span style={{ fontSize: "12px", fontWeight: 600, color: "#c9a84c" }}>v{i + 1}</span>
                          <span style={{ fontSize: "12px", color: "#6d675e" }}>{v.length > 80 ? v.slice(0, 80) + "..." : v}</span>
                          {generatedPrompt === v && <span style={{ fontSize: "10px", color: "#c9a84c", marginLeft: "auto" }}>current</span>}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Refinement panel */}
                <div style={S.refineBox}>
                  <div style={S.refineTitle}>Refine your prompt</div>
                  <p style={S.refineSub}>Tell us what to change — the AI will adjust your prompt while keeping everything else.</p>

                  {refineHistory.filter(m => m.role === "user").length > 0 && (
                    <div style={{ marginBottom: "14px", display: "flex", flexDirection: "column", gap: "8px" }}>
                      {refineHistory.filter(m => m.role === "user").map((m, i) => (
                        <div key={i} style={S.refineMsg}>
                          <span style={{ color: "#c9a84c", fontSize: "11px", fontWeight: 600 }}>You:</span>
                          <span style={{ color: "#8a857c", fontSize: "13px" }}>{m.content.split("Requested change: ")[1] || m.content}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  <div style={S.refineInputWrap}>
                    <input ref={refineRef} type="text" value={refineInput} onChange={e => setRefineInput(e.target.value)}
                      placeholder='e.g. "Make the tone more casual" or "Add a section about error handling"'
                      style={S.refineInput}
                      onKeyDown={e => { if (e.key === "Enter") submitRefinement(); }}
                      disabled={isRefining} />
                    <button onClick={submitRefinement} disabled={!refineInput.trim() || isRefining} className="btn-primary"
                      style={{ ...S.refineSendBtn, opacity: refineInput.trim() && !isRefining ? 1 : 0.4 }}>
                      {isRefining ? "..." : "→"}
                    </button>
                  </div>
                </div>

                {/* Tips */}
                <div style={S.tipsCard}>
                  <div style={S.tipsHeader}>Tips for best results</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                    <span style={S.tipItem}>Paste this at the <strong>start</strong> of a new chat in {targetAI}</span>
                    <span style={S.tipItem}>Use the <strong>refinement panel</strong> above to tweak the prompt without starting over</span>
                    <span style={S.tipItem}>Hit <strong>Different version</strong> for an alternate take on the same topic</span>
                  </div>
                </div>
              </Fade>
            )}
          </Fade>
        )}

        {/* ── History ── */}
        {history.length > 0 && step !== 3 && step !== 5 && (
          <div style={S.historySection}>
            <button onClick={() => setShowHistory(!showHistory)} style={S.histToggle}>
              <span style={{ display: "inline-block", transition: "transform 0.2s", transform: showHistory ? "rotate(90deg)" : "rotate(0deg)", marginRight: "6px" }}>▸</span>
              Saved prompts <span style={S.histCount}>{history.length}</span>
            </button>
            {showHistory && (
              <div style={S.histList}>
                {history.map((h, i) => (
                  <div key={i} className="hist-item" style={S.histItem}
                    onClick={() => { setGeneratedPrompt(h.prompt); setTargetAI(h.targetAI); setCopied(false); setRefineHistory([]); setPromptVersions([h.prompt]); if (step !== 6) setStep(6); }}>
                    <div style={S.histTop}>
                      <div style={{ display: "flex", gap: "6px" }}>
                        <span style={S.histTag}>{h.targetAI}</span>
                        <span style={S.histTag}>{h.detail}</span>
                      </div>
                      <span style={{ fontSize: "11px", color: "#3a3632" }}>{h.time instanceof Date ? h.time.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : ""}</span>
                    </div>
                    <div style={{ fontSize: "14px", fontWeight: 500, color: "#b0aa9f", marginBottom: "4px" }}>{h.topic}</div>
                    <div style={{ fontSize: "12px", color: "#5a554c", lineHeight: 1.4 }}>{h.prompt.length > 100 ? h.prompt.slice(0, 100) + "..." : h.prompt}</div>
                  </div>
                ))}
                <button onClick={() => { setHistory([]); Storage.set("history", []); }} className="btn-secondary" style={{ ...S.secBtn, marginTop: "8px", fontSize: "12px", color: "#5a554c" }}>Clear history</button>
              </div>
            )}
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Floating prompt tip widget */}
      <PromptTip open={showPromptTip} onToggle={() => setShowPromptTip(v => !v)} />

      <style>{`
        @keyframes fadeUp { from { opacity:0; transform:translateY(18px); } to { opacity:1; transform:translateY(0); } }
        @keyframes spin { to { transform:rotate(360deg); } }
        @keyframes pulse { 0%,100%{opacity:0.4;} 50%{opacity:1;} }
        @keyframes shimmer { 0% { background-position:-200% center; } 100% { background-position:200% center; } }
        @keyframes goldPulse { 0%,100% { box-shadow:0 0 8px rgba(201,168,76,0.12); } 50% { box-shadow:0 0 20px rgba(201,168,76,0.22); } }
        @keyframes blink { 0%,100%{opacity:1;} 50%{opacity:0;} }
        * { box-sizing:border-box; }
        textarea::placeholder, input::placeholder { color:#44403a !important; }
        textarea:focus, input:focus { outline:none; border-color:rgba(201,168,76,0.4) !important; }
        button { font-family:'Outfit',sans-serif; }
        ::-webkit-scrollbar { width:5px; }
        ::-webkit-scrollbar-thumb { background:rgba(201,168,76,0.15); border-radius:3px; }
        .btn-primary:hover:not(:disabled) { transform:translateY(-2px); box-shadow:0 8px 30px rgba(201,168,76,0.25); }
        .btn-secondary:hover { border-color:rgba(201,168,76,0.3) !important; color:#c9a84c !important; transform:translateY(-1px); }
        .btn-back:hover { color:#c9a84c !important; }
        .btn-copy:hover { background:rgba(201,168,76,0.08) !important; }
        .hist-item:hover { border-color:rgba(201,168,76,0.2) !important; background:rgba(201,168,76,0.03) !important; }
        .template-card:hover { border-color:rgba(201,168,76,0.4) !important; background:rgba(201,168,76,0.04) !important; transform:translateY(-2px) !important; }
      `}</style>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// SUB-COMPONENTS
// ═══════════════════════════════════════════════════════════════

function PromptTip({ open, onToggle }) {
  return (
    <div style={{ position: "fixed", bottom: "24px", right: "24px", zIndex: 100, display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "10px" }}>
      {open && (
        <div style={{ width: "300px", borderRadius: "14px", background: "#0e0d0b", border: "1px solid rgba(201,168,76,0.18)", boxShadow: "0 20px 60px rgba(0,0,0,0.6)", animation: "fadeUp 0.3s ease forwards", overflow: "hidden" }}>
          <div style={{ padding: "14px 16px 10px", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
            <div style={{ fontSize: "11px", fontWeight: 700, color: "#c9a84c", textTransform: "uppercase", letterSpacing: "1.2px" }}>Why prompts matter</div>
          </div>
          <div style={{ padding: "14px 16px 16px", display: "flex", flexDirection: "column", gap: "10px" }}>
            <div style={{ borderRadius: "8px", background: "rgba(180,60,60,0.07)", border: "1px solid rgba(180,60,60,0.12)", padding: "10px 12px" }}>
              <div style={{ fontSize: "10px", fontWeight: 700, color: "#a05050", textTransform: "uppercase", letterSpacing: "0.8px", marginBottom: "5px" }}>✗ Vague</div>
              <div style={{ fontSize: "13px", color: "#7a6b6b", lineHeight: 1.5, fontStyle: "italic" }}>"Write me a marketing email."</div>
            </div>
            <div style={{ borderRadius: "8px", background: "rgba(201,168,76,0.05)", border: "1px solid rgba(201,168,76,0.15)", padding: "10px 12px" }}>
              <div style={{ fontSize: "10px", fontWeight: 700, color: "#c9a84c", textTransform: "uppercase", letterSpacing: "0.8px", marginBottom: "5px" }}>✓ Specific</div>
              <div style={{ fontSize: "13px", color: "#a09070", lineHeight: 1.5, fontStyle: "italic" }}>"Act as a conversion copywriter. Write a 150-word re-engagement email for SaaS users who haven't logged in for 30 days. Tone: warm, not pushy. Include one clear CTA."</div>
            </div>
            <div style={{ fontSize: "12px", color: "#4a4540", lineHeight: 1.55, textAlign: "center", paddingTop: "2px" }}>
              Specific prompts get <span style={{ color: "#c9a84c", fontWeight: 600 }}>10× better results</span> — Obsidia AI builds them for you.
            </div>
          </div>
        </div>
      )}
      <button onClick={onToggle} style={{ width: "44px", height: "44px", borderRadius: "50%", border: "1px solid rgba(201,168,76,0.25)", background: open ? "rgba(201,168,76,0.12)" : "rgba(14,13,11,0.95)", color: "#c9a84c", fontSize: "18px", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 4px 20px rgba(0,0,0,0.5)", transition: "all 0.25s ease", backdropFilter: "blur(8px)" }} title="Why prompts matter">
        {open ? "×" : "?"}
      </button>
    </div>
  );
}

function Fade({ children }) { return <div style={{ animation: "fadeUp 0.5s ease forwards" }}>{children}</div>; }

function SH({ title, desc }) {
  return (
    <div style={{ marginBottom: "28px" }}>
      <h2 style={{ fontFamily: "'Cormorant Garamond',Georgia,serif", fontSize: "clamp(22px,4.5vw,32px)", fontWeight: 700, color: "#f0ece4", margin: "0 0 10px", lineHeight: 1.2, letterSpacing: "-0.3px" }}>{title}</h2>
      <p style={{ fontSize: "15px", color: "#6d675e", margin: 0, lineHeight: 1.55 }}>{desc}</p>
    </div>
  );
}

function GoldSpinner() { return <div style={{ width: "36px", height: "36px", border: "2.5px solid rgba(201,168,76,0.1)", borderTopColor: "#c9a84c", borderRadius: "50%", animation: "spin 0.9s linear infinite", margin: "0 auto 20px" }} />; }

function BtnPrimary({ onClick, disabled, label }) {
  return <button className="btn-primary" onClick={onClick} disabled={disabled} style={{ padding: "14px 30px", borderRadius: "10px", border: "1px solid rgba(201,168,76,0.3)", background: "linear-gradient(135deg,#b8942f,#c9a84c,#d4b85a)", color: "#0a0a0a", fontSize: "14px", fontWeight: 700, cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.35 : 1, transition: "all 0.3s ease", display: "flex", alignItems: "center", letterSpacing: "0.3px", textTransform: "uppercase" }}>{label}</button>;
}

function BtnSecondary({ onClick, label }) {
  return <button className="btn-secondary" onClick={onClick} style={{ padding: "12px 22px", borderRadius: "10px", border: "1px solid rgba(255,255,255,0.07)", background: "transparent", color: "#7a756c", fontSize: "13px", fontWeight: 500, cursor: "pointer", transition: "all 0.3s ease" }}>{label}</button>;
}

function BtnBack({ onClick }) {
  return <button className="btn-back" onClick={onClick} style={{ padding: "12px 18px", borderRadius: "10px", border: "none", background: "transparent", color: "#5a554c", fontSize: "14px", fontWeight: 500, cursor: "pointer", transition: "all 0.25s ease" }}>← Back</button>;
}

function BtnCopy({ onClick, copied }) {
  return <button className="btn-copy" onClick={onClick} style={{ padding: "7px 16px", borderRadius: "6px", border: "1px solid rgba(201,168,76,0.25)", background: copied ? "rgba(201,168,76,0.1)" : "transparent", color: "#c9a84c", fontSize: "12px", fontWeight: 600, cursor: "pointer", transition: "all 0.25s ease", letterSpacing: "0.5px", textTransform: "uppercase" }}>{copied ? "✓ Copied" : "Copy"}</button>;
}

// ═══════════════════════════════════════════════════════════════
// STYLES
// ═══════════════════════════════════════════════════════════════

const S = {
  page: { minHeight: "100vh", background: "#050505", color: "#e8e4db", fontFamily: "'Outfit',sans-serif", position: "relative", overflow: "hidden" },
  glowTop: { position: "fixed", top: "-250px", right: "-200px", width: "650px", height: "650px", background: "radial-gradient(circle,rgba(201,168,76,0.045) 0%,transparent 60%)", pointerEvents: "none" },
  glowBot: { position: "fixed", bottom: "-250px", left: "-150px", width: "550px", height: "550px", background: "radial-gradient(circle,rgba(120,100,180,0.025) 0%,transparent 60%)", pointerEvents: "none" },
  grain: { position: "fixed", inset: 0, pointerEvents: "none", zIndex: 0, opacity: 0.025, backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)'/%3E%3C/svg%3E")` },
  container: { maxWidth: "700px", margin: "0 auto", padding: "48px 24px 120px", position: "relative", zIndex: 1 },
  header: { textAlign: "center", marginBottom: "36px" },
  logoBadge: { display: "inline-flex", alignItems: "center", gap: "8px", padding: "7px 18px", borderRadius: "100px", background: "rgba(201,168,76,0.06)", border: "1px solid rgba(201,168,76,0.12)", fontSize: "12px", fontWeight: 600, letterSpacing: "1.5px", textTransform: "uppercase", color: "#c9a84c", marginBottom: "20px" },
  title: { fontFamily: "'Cormorant Garamond',Georgia,serif", fontSize: "clamp(32px,7vw,52px)", fontWeight: 700, lineHeight: 1.08, margin: "0 0 16px", color: "#f0ece4", letterSpacing: "-0.5px" },
  goldText: { background: "linear-gradient(135deg,#c9a84c 0%,#e8d48b 40%,#c9a84c 70%,#a88a30 100%)", backgroundSize: "200% auto", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", animation: "shimmer 6s linear infinite" },
  subtitle: { fontSize: "16px", color: "#6d675e", fontWeight: 300, lineHeight: 1.65, maxWidth: "520px", margin: "0 auto" },
  divider: { display: "flex", alignItems: "center", gap: "16px", marginTop: "28px", justifyContent: "center" },
  divLine: { width: "60px", height: "1px", background: "linear-gradient(to right,transparent,rgba(201,168,76,0.15),transparent)" },
  divDot: { color: "#c9a84c", fontSize: "10px", opacity: 0.4 },
  progressWrap: { marginBottom: "40px" },
  progressTrack: { height: "2px", borderRadius: "2px", background: "rgba(255,255,255,0.04)", overflow: "hidden", marginBottom: "10px" },
  progressFill: { height: "100%", borderRadius: "2px", background: "linear-gradient(90deg,#a88a30,#c9a84c,#d4b85a)", transition: "width 0.6s ease" },
  progressLabels: { display: "flex", justifyContent: "space-between", padding: "0 2px" },
  progressLabel: { fontSize: "10px", fontWeight: 600, letterSpacing: "0.8px", textTransform: "uppercase", transition: "color 0.3s" },

  detailGrid: { display: "flex", flexDirection: "column", gap: "12px" },
  detailCard: { padding: "24px", borderRadius: "14px", border: "1px solid rgba(255,255,255,0.05)", background: "rgba(255,255,255,0.015)", cursor: "pointer", textAlign: "left", transition: "all 0.35s cubic-bezier(0.4,0,0.2,1)", color: "#e8e4db" },
  detailIcon: { fontSize: "20px", color: "#c9a84c", marginBottom: "8px" },
  detailLabel: { fontSize: "20px", fontWeight: 700, marginBottom: "2px", fontFamily: "'Cormorant Garamond',Georgia,serif", color: "#f0ece4" },
  detailTagline: { fontSize: "13px", color: "#c9a84c", fontWeight: 500, marginBottom: "8px" },
  detailDesc: { fontSize: "14px", color: "#6d675e", lineHeight: 1.5, marginBottom: "12px" },
  detailBadge: { fontSize: "11px", fontWeight: 600, color: "#8a857c", textTransform: "uppercase", letterSpacing: "0.8px", padding: "4px 10px", borderRadius: "4px", background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.04)" },

  // Templates
  templateCatBar: { display: "flex", gap: "4px", flexWrap: "wrap", marginBottom: "16px" },
  templateCatBtn: { padding: "6px 14px", borderRadius: "6px", border: "1px solid transparent", background: "transparent", fontSize: "12px", fontWeight: 600, cursor: "pointer", transition: "all 0.2s" },
  templateGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(180px,1fr))", gap: "10px" },
  templateCard: { padding: "16px", borderRadius: "12px", border: "1px solid rgba(255,255,255,0.45)", background: "rgba(255,255,255,0.015)", cursor: "pointer", textAlign: "left", display: "flex", flexDirection: "column", gap: "6px", transition: "all 0.3s ease", minHeight: "130px" },
  tinyTag: { fontSize: "10px", fontWeight: 600, color: "#8a857c", textTransform: "uppercase", padding: "2px 6px", borderRadius: "3px", background: "rgba(255,255,255,0.03)", letterSpacing: "0.3px" },

  // AI chips & card
  aiChipsWrap: { display: "flex", flexWrap: "wrap", gap: "8px", marginBottom: "20px" },
  aiChip: { padding: "10px 18px", borderRadius: "8px", border: "1px solid rgba(255,255,255,0.06)", background: "rgba(255,255,255,0.02)", color: "#7a756c", fontSize: "14px", fontWeight: 500, cursor: "pointer", transition: "all 0.25s ease", display: "flex", alignItems: "center" },
  orDivider: { display: "flex", alignItems: "center", gap: "14px", marginBottom: "16px" },
  orLine: { flex: 1, height: "1px", background: "rgba(255,255,255,0.05)" },
  orText: { fontSize: "11px", fontWeight: 500, color: "#4a4540", textTransform: "uppercase", letterSpacing: "0.8px" },
  card: { background: "rgba(255,255,255,0.015)", border: "1px solid rgba(255,255,255,0.05)", borderRadius: "16px", padding: "28px" },
  inputLabel: { display: "block", fontSize: "12px", fontWeight: 600, color: "#8a857c", marginBottom: "10px", textTransform: "uppercase", letterSpacing: "0.8px" },
  input: { width: "100%", padding: "15px 18px", borderRadius: "10px", border: "1px solid rgba(255,255,255,0.06)", background: "rgba(0,0,0,0.4)", color: "#e8e4db", fontSize: "16px", fontFamily: "'Outfit',sans-serif", transition: "border-color 0.25s" },
  textarea: { width: "100%", padding: "15px 18px", borderRadius: "10px", border: "1px solid rgba(255,255,255,0.06)", background: "rgba(0,0,0,0.4)", color: "#e8e4db", fontSize: "15px", fontFamily: "'Outfit',sans-serif", resize: "vertical", lineHeight: 1.55, transition: "border-color 0.25s" },
  cardActions: { display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "20px", gap: "12px", flexWrap: "wrap" },

  loadBox: { textAlign: "center", padding: "70px 20px" },
  loadTitle: { fontSize: "18px", fontWeight: 600, color: "#f0ece4", margin: "0 0 8px", animation: "pulse 1.8s ease infinite" },
  loadSub: { fontSize: "14px", color: "#5a554c", margin: 0 },

  questionsWrap: { display: "flex", flexDirection: "column", gap: "12px", marginBottom: "20px" },
  qCard: { display: "flex", gap: "14px", padding: "22px", borderRadius: "14px", background: "rgba(255,255,255,0.015)", border: "1px solid rgba(255,255,255,0.05)" },
  qNum: { width: "26px", height: "26px", borderRadius: "50%", background: "rgba(201,168,76,0.08)", border: "1px solid rgba(201,168,76,0.15)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "12px", fontWeight: 700, color: "#c9a84c", flexShrink: 0, marginTop: "2px" },
  qLabel: { display: "block", fontSize: "15px", fontWeight: 500, color: "#e8e4db", marginBottom: "10px", lineHeight: 1.45 },
  qInput: { width: "100%", padding: "12px 14px", borderRadius: "8px", border: "1px solid rgba(255,255,255,0.06)", background: "rgba(0,0,0,0.4)", color: "#e8e4db", fontSize: "14px", fontFamily: "'Outfit',sans-serif", resize: "vertical", lineHeight: 1.5, transition: "border-color 0.25s" },
  aBadge: { marginLeft: "10px", padding: "2px 10px", borderRadius: "100px", background: "rgba(0,0,0,0.25)", fontSize: "11px", fontWeight: 500 },
  errorBox: { padding: "14px 18px", borderRadius: "10px", background: "rgba(180,60,60,0.08)", border: "1px solid rgba(180,60,60,0.15)", color: "#d48080", fontSize: "14px", marginBottom: "16px" },

  // Result
  resultBadge: { display: "inline-block", padding: "8px 22px", borderRadius: "100px", background: "rgba(201,168,76,0.06)", border: "1px solid rgba(201,168,76,0.15)", fontSize: "14px", fontWeight: 600, color: "#c9a84c", marginBottom: "12px", letterSpacing: "0.3px" },
  resultSub: { fontSize: "15px", color: "#6d675e", margin: 0, lineHeight: 1.5 },
  resultCard: { borderRadius: "16px", background: "rgba(255,255,255,0.015)", border: "1px solid rgba(201,168,76,0.12)", overflow: "hidden" },
  resultHeader: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 22px", borderBottom: "1px solid rgba(255,255,255,0.04)", flexWrap: "wrap", gap: "8px" },
  resultMeta: { display: "flex", alignItems: "center", gap: "8px" },
  metaTag: { fontSize: "11px", fontWeight: 600, color: "#8a857c", textTransform: "uppercase", letterSpacing: "0.6px" },
  resultText: { padding: "26px", margin: 0, fontSize: "16px", lineHeight: 1.8, color: "#e8e4db", fontWeight: 300, whiteSpace: "pre-wrap", minHeight: "60px" },
  cursor: { display: "inline-block", animation: "blink 0.8s step-end infinite", color: "#c9a84c", fontWeight: 300 },

  // Export bar
  exportBar: { display: "flex", gap: "8px", marginTop: "16px", flexWrap: "wrap" },
  exportBtn: { padding: "10px 16px", borderRadius: "8px", border: "1px solid rgba(255,255,255,0.06)", background: "rgba(255,255,255,0.015)", color: "#8a857c", fontSize: "12px", fontWeight: 500, cursor: "pointer", transition: "all 0.25s ease" },

  secBtn: { padding: "12px 22px", borderRadius: "10px", border: "1px solid white", background: "transparent", color: "#d0ccc6", fontSize: "13px", fontWeight: 500, cursor: "pointer", transition: "all 0.3s ease" },

  // Versions
  versionsBox: { marginTop: "24px", padding: "18px", borderRadius: "12px", background: "rgba(192,192,192,0.02)", border: "1px solid rgba(192,192,192,0.06)" },
  versionsTitle: { fontSize: "12px", fontWeight: 700, color: "rgba(192,192,192,0.5)", textTransform: "uppercase", letterSpacing: "1px", marginBottom: "10px" },
  versionBtn: { display: "flex", alignItems: "center", gap: "10px", padding: "10px 14px", borderRadius: "8px", border: "1px solid rgba(255,255,255,0.04)", background: "transparent", cursor: "pointer", transition: "all 0.2s", textAlign: "left", width: "100%" },

  // Refinement
  refineBox: { marginTop: "28px", padding: "22px", borderRadius: "14px", background: "rgba(201,168,76,0.02)", border: "1px solid rgba(201,168,76,0.08)" },
  refineTitle: { fontSize: "14px", fontWeight: 700, color: "#c9a84c", marginBottom: "6px" },
  refineSub: { fontSize: "13px", color: "#6d675e", marginBottom: "16px", lineHeight: 1.5 },
  refineMsg: { display: "flex", gap: "8px", padding: "8px 12px", borderRadius: "8px", background: "rgba(201,168,76,0.03)", border: "1px solid rgba(201,168,76,0.06)" },
  refineInputWrap: { display: "flex", gap: "8px" },
  refineInput: { flex: 1, padding: "12px 16px", borderRadius: "10px", border: "1px solid rgba(201,168,76,0.12)", background: "rgba(0,0,0,0.3)", color: "#e8e4db", fontSize: "14px", fontFamily: "'Outfit',sans-serif", transition: "border-color 0.25s" },
  refineSendBtn: { padding: "12px 20px", borderRadius: "10px", border: "1px solid rgba(201,168,76,0.3)", background: "linear-gradient(135deg,#b8942f,#c9a84c)", color: "#0a0a0a", fontSize: "16px", fontWeight: 700, cursor: "pointer", transition: "all 0.3s ease" },

  // Tips
  tipsCard: { marginTop: "28px", padding: "22px", borderRadius: "12px", background: "rgba(120,100,180,0.03)", border: "1px solid rgba(120,100,180,0.08)" },
  tipsHeader: { fontSize: "12px", fontWeight: 700, color: "rgba(160,140,210,0.7)", marginBottom: "14px", textTransform: "uppercase", letterSpacing: "1px" },
  tipItem: { fontSize: "13px", color: "#6d675e", lineHeight: 1.5, paddingLeft: "14px", borderLeft: "2px solid rgba(120,100,180,0.12)" },

  // History
  historySection: { marginTop: "56px", paddingTop: "28px", borderTop: "1px solid rgba(255,255,255,0.03)" },
  histToggle: { background: "none", border: "none", color: "#5a554c", fontSize: "13px", cursor: "pointer", fontWeight: 500, padding: 0, display: "flex", alignItems: "center", transition: "color 0.2s" },
  histCount: { marginLeft: "6px", padding: "1px 8px", borderRadius: "4px", background: "rgba(201,168,76,0.08)", color: "#c9a84c", fontSize: "11px", fontWeight: 600 },
  histList: { marginTop: "14px", display: "flex", flexDirection: "column", gap: "8px", animation: "fadeUp 0.3s ease" },
  histItem: { padding: "16px 20px", borderRadius: "12px", background: "rgba(255,255,255,0.01)", border: "1px solid rgba(255,255,255,0.45)", cursor: "pointer", transition: "all 0.25s ease" },
  histTop: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" },
  histTag: { fontSize: "10px", fontWeight: 600, color: "#c9a84c", textTransform: "uppercase", letterSpacing: "0.6px", padding: "2px 8px", borderRadius: "4px", background: "rgba(201,168,76,0.06)" },
};

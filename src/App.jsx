import { useState, useRef, useEffect } from "react";

async function callClaude(systemPrompt, userMessage) {
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      system: systemPrompt,
      messages: [{ role: "user", content: userMessage }],
    }),
  });
  const data = await res.json();
  return data.content?.map((b) => b.text || "").join("") || "";
}

// ── Detail levels ──
const DETAIL_LEVELS = [
  {
    id: "instant",
    label: "Instant",
    tagline: "No questions asked",
    desc: "Just tell us the topic and we'll generate a solid prompt immediately. No follow-up questions.",
    icon: "⚡",
    questionCount: 0,
    promptLength: "2-4 sentences — a clean, effective prompt from your topic alone",
  },
  {
    id: "standard",
    label: "Standard",
    tagline: "A well-rounded prompt",
    desc: "Good balance of detail and speed. We'll ask 3 questions to dial things in.",
    icon: "◈",
    questionCount: 3,
    promptLength: "4-6 sentences — clear with good context",
  },
  {
    id: "detailed",
    label: "Detailed",
    tagline: "A comprehensive, expert-level prompt",
    desc: "Maximum quality. We'll ask 5 questions to build a thorough, optimized prompt.",
    icon: "✦",
    questionCount: 5,
    promptLength: "6-10 sentences — thorough with full context, constraints, and output formatting",
  },
];

// ── Popular AI platforms ──
const AI_PLATFORMS = [
  { id: "chatgpt", label: "ChatGPT" },
  { id: "claude", label: "Claude" },
  { id: "gemini", label: "Gemini" },
  { id: "copilot", label: "Copilot" },
  { id: "perplexity", label: "Perplexity" },
  { id: "midjourney", label: "Midjourney" },
  { id: "grok", label: "Grok" },
  { id: "meta", label: "Meta AI" },
];

function getQuestionsSystem(detailLevel) {
  const level = DETAIL_LEVELS.find((d) => d.id === detailLevel);
  return `You are part of an AI prompt generator tool. The user has told you which AI they are writing a prompt for and what their topic/goal is.

RULES:
- Return ONLY valid JSON — no markdown, no backticks, no explanation
- Format: { "questions": [ { "id": "q1", "question": "...", "placeholder": "..." }, ... ] }
- Ask exactly ${level.questionCount} questions
- ${detailLevel === "standard"
    ? "Ask about the goal, audience/context, and format preferences"
    : "Ask thorough questions covering goal, audience, format, tone, constraints, and any specific requirements"
  }
- Tailor questions to the specific AI platform they mentioned
- Make questions specific to their topic — not generic
- Keep questions short and conversational
- Placeholders should be helpful example answers`;
}

function getPromptSystem(detailLevel) {
  const level = DETAIL_LEVELS.find((d) => d.id === detailLevel);
  return `You are an expert AI prompt engineer. Given the target AI platform, the user's topic, and ${
    detailLevel === "instant" ? "no additional context" : "their answers to follow-up questions"
  }, create a highly effective prompt they can paste directly into that AI.

RULES:
- Return ONLY the prompt text — no explanations, no labels, no markdown formatting
- Optimize specifically for the target AI platform
- The user requested a "${level.label}" level prompt, so make it ${level.promptLength}
${
  detailLevel === "instant"
    ? "- You only have the topic to work with — no follow-up answers\n- Write a clean, effective prompt using just the topic\n- Infer reasonable defaults for audience, tone, and format\n- Keep it concise but specific enough to get good results"
    : detailLevel === "standard"
    ? "- Include a clear role/persona, the main task, key context from answers, and basic format guidance\n- Be specific but not overly long"
    : "- Include a detailed role/persona, comprehensive task description, all context from answers, specific constraints, tone/style guidance, and detailed output format instructions\n- Be thorough and leave no ambiguity"
}
- Write it directed at the AI (e.g. "You are..." or "Act as..." or "Write a...")
- Never include meta-commentary — just the prompt itself`;
}

export default function PromptCraft() {
  const [step, setStep] = useState(0);
  // 0=detail, 1=AI platform, 2=topic, 3=loading-q, 4=questions, 5=loading-p, 6=result
  const [detailLevel, setDetailLevel] = useState(null);
  const [targetAI, setTargetAI] = useState("");
  const [topic, setTopic] = useState("");
  const [questions, setQuestions] = useState([]);
  const [answers, setAnswers] = useState({});
  const [generatedPrompt, setGeneratedPrompt] = useState("");
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  const [history, setHistory] = useState([]);
  const [showHistory, setShowHistory] = useState(false);
  const [hoveredDetail, setHoveredDetail] = useState(null);
  const [hoveredAI, setHoveredAI] = useState(null);
  const bottomRef = useRef(null);
  const topicRef = useRef(null);
  const aiRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [step, questions, generatedPrompt, showHistory]);

  useEffect(() => {
    if (step === 1) setTimeout(() => aiRef.current?.focus(), 300);
    if (step === 2) setTimeout(() => topicRef.current?.focus(), 200);
  }, [step]);

  const pickDetail = (level) => {
    setDetailLevel(level);
    setStep(1);
  };

  const selectAIPlatform = (name) => {
    setTargetAI(name);
  };

  const submitAI = () => {
    if (!targetAI.trim()) return;
    setStep(2);
  };

  const submitTopic = async () => {
    if (!topic.trim()) return;
    // If instant — skip questions entirely and go straight to prompt generation
    if (detailLevel.id === "instant") {
      setStep(5);
      setError("");
      try {
        const prompt = await callClaude(
          getPromptSystem(detailLevel.id),
          `Target AI: ${targetAI}\nTopic: ${topic}\nDetail level: Instant (no follow-up questions — generate from topic alone)`
        );
        setGeneratedPrompt(prompt.trim());
        setHistory((prev) =>
          [{ prompt: prompt.trim(), topic, targetAI, detail: detailLevel.label, time: new Date() }, ...prev].slice(0, 20)
        );
        setStep(6);
      } catch (e) {
        console.error(e);
        setError("Something went wrong. Please try again.");
        setStep(2);
      }
      return;
    }
    // Otherwise ask questions
    setStep(3);
    setError("");
    try {
      const raw = await callClaude(
        getQuestionsSystem(detailLevel.id),
        `Target AI: ${targetAI}\nTopic: ${topic}\nDetail level: ${detailLevel.label}`
      );
      const cleaned = raw.replace(/```json|```/g, "").trim();
      const parsed = JSON.parse(cleaned);
      if (parsed.questions?.length) {
        setQuestions(parsed.questions);
        setAnswers({});
        setStep(4);
      } else throw new Error("No questions");
    } catch (e) {
      console.error(e);
      setError("Something went wrong generating questions. Please try again.");
      setStep(2);
    }
  };

  const submitAnswers = async () => {
    setStep(5);
    setError("");
    try {
      const qaPairs = questions
        .map((q) => `Q: ${q.question}\nA: ${answers[q.id] || "(skipped)"}`)
        .join("\n\n");
      const prompt = await callClaude(
        getPromptSystem(detailLevel.id),
        `Target AI: ${targetAI}\nTopic: ${topic}\nDetail level: ${detailLevel.label}\n\nFollow-up Q&A:\n${qaPairs}`
      );
      setGeneratedPrompt(prompt.trim());
      setHistory((prev) =>
        [{ prompt: prompt.trim(), topic, targetAI, detail: detailLevel.label, time: new Date() }, ...prev].slice(0, 20)
      );
      setStep(6);
    } catch (e) {
      console.error(e);
      setError("Something went wrong building your prompt. Please try again.");
      setStep(4);
    }
  };

  const regenerate = async () => {
    setStep(5);
    try {
      const qaPairs = questions.length > 0
        ? questions.map((q) => `Q: ${q.question}\nA: ${answers[q.id] || "(skipped)"}`).join("\n\n")
        : "(no follow-up questions — instant mode)";
      const prompt = await callClaude(
        getPromptSystem(detailLevel.id),
        `Target AI: ${targetAI}\nTopic: ${topic}\nDetail level: ${detailLevel.label}\n\nFollow-up Q&A:\n${qaPairs}\n\nGenerate a DIFFERENT variation than: "${generatedPrompt.slice(0, 200)}"`
      );
      setGeneratedPrompt(prompt.trim());
      setHistory((prev) =>
        [{ prompt: prompt.trim(), topic, targetAI, detail: detailLevel.label, time: new Date() }, ...prev].slice(0, 20)
      );
      setStep(6);
    } catch (e) {
      setError("Failed to regenerate.");
      setStep(6);
    }
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(generatedPrompt);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  const startOver = () => {
    setStep(0);
    setDetailLevel(null);
    setTargetAI("");
    setTopic("");
    setQuestions([]);
    setAnswers({});
    setGeneratedPrompt("");
    setCopied(false);
    setError("");
  };

  const answeredCount = questions.filter((q) => answers[q.id]?.trim()).length;

  // Progress labels adapt based on whether questions step exists
  const isInstant = detailLevel?.id === "instant";
  const progressSteps = isInstant
    ? ["Depth", "AI Platform", "Topic", "Prompt"]
    : ["Depth", "AI Platform", "Topic", "Questions", "Prompt"];

  const getProgressWidth = () => {
    if (isInstant) {
      if (step === 0) return "0%";
      if (step === 1) return "33%";
      if (step === 2) return "66%";
      return "100%";
    }
    if (step === 0) return "0%";
    if (step === 1) return "25%";
    if (step === 2) return "50%";
    if (step <= 4) return "75%";
    return "100%";
  };

  const isStepActive = (i) => {
    if (isInstant) {
      const map = [0, 1, 2, 6];
      return step >= map[i];
    }
    const map = [0, 1, 2, 4, 6];
    return step >= map[i];
  };

  return (
    <div style={S.page}>
      <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700;800&family=Cormorant+Garamond:wght@600;700&display=swap" rel="stylesheet" />

      <div style={S.glowTop} />
      <div style={S.glowBot} />
      <div style={S.grain} />

      <div style={S.container}>
        {/* ── Header ── */}
        <header style={S.header}>
          <div style={S.logoBadge}>
            <span style={S.logoIcon}>✦</span> Prompt Craft
          </div>
          <h1 style={S.title}>
            Craft Your <span style={S.goldText}>Perfect Prompt</span>
          </h1>
          <p style={S.subtitle}>
            Tell us what you need, answer a few quick questions, and get an expert-level AI prompt — tailored to your platform and ready to paste.
          </p>
          <div style={S.divider}>
            <div style={S.dividerLine} />
            <span style={S.dividerDot}>◈</span>
            <div style={S.dividerLine} />
          </div>
        </header>

        {/* ── Progress ── */}
        <div style={S.progressWrap}>
          <div style={S.progressTrack}>
            <div style={{ ...S.progressFill, width: getProgressWidth() }} />
          </div>
          <div style={S.progressLabels}>
            {progressSteps.map((label, i) => (
              <span key={i} style={{
                ...S.progressLabel,
                color: isStepActive(i) ? "#c9a84c" : "#3a3632",
              }}>{label}</span>
            ))}
          </div>
        </div>

        {/* ═══ Step 0: Depth ═══ */}
        {step === 0 && (
          <Fade>
            <SH title="How detailed of a prompt do you need?" desc="This determines how many questions we'll ask and how thorough the final prompt will be." />
            <div style={S.detailGrid}>
              {DETAIL_LEVELS.map((level) => {
                const isHovered = hoveredDetail === level.id;
                return (
                  <button
                    key={level.id}
                    onClick={() => pickDetail(level)}
                    onMouseEnter={() => setHoveredDetail(level.id)}
                    onMouseLeave={() => setHoveredDetail(null)}
                    style={{
                      ...S.detailCard,
                      borderColor: isHovered ? "rgba(201,168,76,0.5)" : "rgba(255,255,255,0.05)",
                      background: isHovered ? "rgba(201,168,76,0.04)" : "rgba(255,255,255,0.015)",
                      transform: isHovered ? "translateY(-4px)" : "translateY(0)",
                      boxShadow: isHovered ? "0 12px 40px rgba(201,168,76,0.08)" : "none",
                    }}
                  >
                    <div style={S.detailIcon}>{level.icon}</div>
                    <div style={S.detailLabel}>{level.label}</div>
                    <div style={S.detailTagline}>{level.tagline}</div>
                    <div style={S.detailDesc}>{level.desc}</div>
                    <div style={S.detailFooter}>
                      <span style={S.detailQuestions}>
                        {level.questionCount === 0 ? "No questions" : `${level.questionCount} questions`}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          </Fade>
        )}

        {/* ═══ Step 1: AI Platform ═══ */}
        {step === 1 && (
          <Fade>
            <SH title="What AI will you be generating this prompt for?" desc="Select one below or type your own." />
            <div style={S.card}>
              {/* Selectable chips */}
              <div style={S.aiChipsWrap}>
                {AI_PLATFORMS.map((ai) => {
                  const isSelected = targetAI === ai.label;
                  const isHov = hoveredAI === ai.id;
                  return (
                    <button
                      key={ai.id}
                      onClick={() => selectAIPlatform(ai.label)}
                      onMouseEnter={() => setHoveredAI(ai.id)}
                      onMouseLeave={() => setHoveredAI(null)}
                      style={{
                        ...S.aiChip,
                        borderColor: isSelected
                          ? "rgba(201,168,76,0.5)"
                          : isHov
                          ? "rgba(201,168,76,0.25)"
                          : "rgba(255,255,255,0.06)",
                        background: isSelected
                          ? "rgba(201,168,76,0.1)"
                          : isHov
                          ? "rgba(201,168,76,0.03)"
                          : "rgba(255,255,255,0.02)",
                        color: isSelected ? "#c9a84c" : isHov ? "#b0aa9f" : "#7a756c",
                        transform: isHov && !isSelected ? "translateY(-1px)" : "translateY(0)",
                      }}
                    >
                      {ai.label}
                      {isSelected && <span style={{ marginLeft: "6px", fontSize: "11px" }}>✓</span>}
                    </button>
                  );
                })}
              </div>

              {/* Divider */}
              <div style={S.orDivider}>
                <div style={S.orLine} />
                <span style={S.orText}>or type your own</span>
                <div style={S.orLine} />
              </div>

              {/* Text input */}
              <input
                ref={aiRef}
                type="text"
                value={targetAI}
                onChange={(e) => setTargetAI(e.target.value)}
                placeholder="Type an AI platform name..."
                style={S.input}
                onKeyDown={(e) => { if (e.key === "Enter") submitAI(); }}
              />

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
            <SH
              title={`What do you need ${targetAI} to do?`}
              desc={isInstant
                ? "Describe your topic or goal. Since you chose Instant, we'll generate your prompt right away — no extra questions."
                : "Describe your topic or goal. Be as specific or broad as you'd like."
              }
            />
            <div style={S.card}>
              <label style={S.inputLabel}>Your topic or goal</label>
              <textarea
                ref={topicRef}
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                placeholder={'e.g. "Write a blog post about how remote work changes company culture" or "Help me plan a 30-day fitness program for beginners"'}
                style={S.textarea}
                rows={4}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submitTopic(); } }}
              />
              <div style={S.cardActions}>
                <BtnBack onClick={() => { setStep(1); setTopic(""); }} />
                <BtnPrimary
                  onClick={submitTopic}
                  disabled={!topic.trim()}
                  label={isInstant ? "Generate prompt →" : "Next — Ask me questions →"}
                />
              </div>
            </div>
          </Fade>
        )}

        {/* ═══ Step 3: Loading questions ═══ */}
        {step === 3 && (
          <Fade>
            <div style={S.loadBox}>
              <GoldSpinner />
              <p style={S.loadTitle}>Preparing your questions...</p>
              <p style={S.loadSub}>Crafting {detailLevel?.questionCount} personalized questions for your {targetAI} prompt</p>
            </div>
          </Fade>
        )}

        {/* ═══ Step 4: Questions ═══ */}
        {step === 4 && (
          <Fade>
            <SH
              title={detailLevel?.id === "standard" ? "A few questions to fine-tune" : "Let's get the details right"}
              desc={`Your answers help us build a ${detailLevel?.label.toLowerCase()}-level prompt for ${targetAI}. Answer as many as you'd like.`}
            />
            {error && <div style={S.errorBox}>{error}</div>}
            <div style={S.questionsWrap}>
              {questions.map((q, i) => (
                <div key={q.id} style={S.qCard}>
                  <div style={S.qNum}>{i + 1}</div>
                  <div style={{ flex: 1 }}>
                    <label style={S.qLabel}>{q.question}</label>
                    <textarea
                      value={answers[q.id] || ""}
                      onChange={(e) => setAnswers((a) => ({ ...a, [q.id]: e.target.value }))}
                      placeholder={q.placeholder}
                      style={S.qInput}
                      rows={2}
                    />
                  </div>
                </div>
              ))}
            </div>
            <div style={S.cardActions}>
              <BtnBack onClick={() => { setStep(2); setQuestions([]); }} />
              <BtnPrimary onClick={submitAnswers} disabled={answeredCount === 0} label={
                <>Build my prompt{answeredCount > 0 && <span style={S.aBadge}>{answeredCount}/{questions.length}</span>}</>
              } />
            </div>
          </Fade>
        )}

        {/* ═══ Step 5: Loading prompt ═══ */}
        {step === 5 && (
          <Fade>
            <div style={S.loadBox}>
              <GoldSpinner />
              <p style={S.loadTitle}>Crafting your prompt...</p>
              <p style={S.loadSub}>Building a {detailLevel?.label.toLowerCase()}-level prompt optimized for {targetAI}</p>
            </div>
          </Fade>
        )}

        {/* ═══ Step 6: Result ═══ */}
        {step === 6 && (
          <Fade>
            <div style={{ textAlign: "center", marginBottom: "28px" }}>
              <div style={S.resultBadge}>✦ Your {targetAI} Prompt</div>
              <p style={S.resultSub}>
                {detailLevel?.label} prompt ready — copy and paste directly into {targetAI}.
              </p>
            </div>
            {error && <div style={S.errorBox}>{error}</div>}

            <div style={S.resultCard}>
              <div style={S.resultHeader}>
                <div style={S.resultMeta}>
                  <span style={S.resultMetaTag}>{targetAI}</span>
                  <span style={S.resultMetaDot}>·</span>
                  <span style={S.resultMetaTag}>{detailLevel?.label}</span>
                </div>
                <BtnCopy onClick={handleCopy} copied={copied} />
              </div>
              <p style={S.resultText}>{generatedPrompt}</p>
            </div>

            <div style={S.resultActions}>
              <BtnSecondary onClick={startOver} label="✦ New prompt" />
              {!isInstant && (
                <BtnSecondary onClick={() => { setStep(4); setGeneratedPrompt(""); }} label="↻ Edit answers" />
              )}
              <BtnPrimary onClick={regenerate} label="⟳ Different version" />
            </div>

            <div style={S.tipsCard}>
              <div style={S.tipsHeader}>Tips for best results</div>
              <div style={S.tipsList}>
                <span style={S.tipItem}>Paste this at the <strong>start</strong> of a new chat in {targetAI}</span>
                <span style={S.tipItem}>If the response isn't right, reply with <strong>"adjust the tone"</strong> or <strong>"make it shorter"</strong></span>
                <span style={S.tipItem}>Hit <strong>Different version</strong> above to get an alternate prompt for the same topic</span>
                {isInstant && (
                  <span style={S.tipItem}>Want a more detailed prompt? Try <strong>Standard</strong> or <strong>Detailed</strong> depth next time</span>
                )}
              </div>
            </div>
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
                    onClick={() => { setGeneratedPrompt(h.prompt); setTargetAI(h.targetAI); setCopied(false); if (step !== 6) setStep(6); }}>
                    <div style={S.histTop}>
                      <div style={S.histTags}>
                        <span style={S.histTag}>{h.targetAI}</span>
                        <span style={S.histTag}>{h.detail}</span>
                      </div>
                      <span style={S.histTime}>{h.time.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                    </div>
                    <div style={S.histTopic}>{h.topic}</div>
                    <div style={S.histPreview}>{h.prompt.length > 100 ? h.prompt.slice(0, 100) + "..." : h.prompt}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      <style>{`
        @keyframes fadeUp { from { opacity:0; transform:translateY(18px); } to { opacity:1; transform:translateY(0); } }
        @keyframes spin { to { transform:rotate(360deg); } }
        @keyframes pulse { 0%,100%{opacity:0.4;} 50%{opacity:1;} }
        @keyframes shimmer {
          0% { background-position: -200% center; }
          100% { background-position: 200% center; }
        }
        @keyframes goldPulse {
          0%,100% { box-shadow: 0 0 8px rgba(201,168,76,0.12); }
          50% { box-shadow: 0 0 20px rgba(201,168,76,0.22); }
        }
        * { box-sizing:border-box; }
        textarea::placeholder, input::placeholder { color: #44403a !important; }
        textarea:focus, input:focus { outline:none; border-color: rgba(201,168,76,0.4) !important; }
        button { font-family:'Outfit',sans-serif; }
        ::-webkit-scrollbar { width: 5px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: rgba(201,168,76,0.15); border-radius: 3px; }
        .btn-primary:hover:not(:disabled) { transform: translateY(-2px); box-shadow: 0 8px 30px rgba(201,168,76,0.25); }
        .btn-secondary:hover { border-color: rgba(201,168,76,0.3); color: #c9a84c; transform: translateY(-1px); }
        .btn-back:hover { color: #c9a84c; }
        .btn-copy:hover { background: rgba(201,168,76,0.08); }
        .hist-item:hover { border-color: rgba(201,168,76,0.2) !important; background: rgba(201,168,76,0.03) !important; }
      `}</style>
    </div>
  );
}

// ── Sub-components ──

function Fade({ children }) {
  return <div style={{ animation: "fadeUp 0.5s ease forwards" }}>{children}</div>;
}

function SH({ title, desc }) {
  return (
    <div style={{ marginBottom: "28px" }}>
      <h2 style={{
        fontFamily: "'Cormorant Garamond',Georgia,serif",
        fontSize: "clamp(22px,4.5vw,32px)", fontWeight: 700,
        color: "#f0ece4", margin: "0 0 10px", lineHeight: 1.2, letterSpacing: "-0.3px",
      }}>{title}</h2>
      <p style={{ fontSize: "15px", color: "#6d675e", margin: 0, lineHeight: 1.55 }}>{desc}</p>
    </div>
  );
}

function GoldSpinner() {
  return <div style={{ width: "36px", height: "36px", border: "2.5px solid rgba(201,168,76,0.1)", borderTopColor: "#c9a84c", borderRadius: "50%", animation: "spin 0.9s linear infinite", margin: "0 auto 20px" }} />;
}

function BtnPrimary({ onClick, disabled, label }) {
  return (
    <button className="btn-primary" onClick={onClick} disabled={disabled} style={{
      padding: "14px 30px", borderRadius: "10px", border: "1px solid rgba(201,168,76,0.3)",
      background: "linear-gradient(135deg, #b8942f, #c9a84c, #d4b85a)",
      color: "#0a0a0a", fontSize: "14px", fontWeight: 700, cursor: disabled ? "default" : "pointer",
      opacity: disabled ? 0.35 : 1, transition: "all 0.3s ease", display: "flex", alignItems: "center",
      letterSpacing: "0.3px", textTransform: "uppercase",
    }}>{label}</button>
  );
}

function BtnSecondary({ onClick, label }) {
  return (
    <button className="btn-secondary" onClick={onClick} style={{
      padding: "12px 22px", borderRadius: "10px", border: "1px solid rgba(255,255,255,0.07)",
      background: "transparent", color: "#7a756c", fontSize: "13px", fontWeight: 500,
      cursor: "pointer", transition: "all 0.3s ease",
    }}>{label}</button>
  );
}

function BtnBack({ onClick }) {
  return (
    <button className="btn-back" onClick={onClick} style={{
      padding: "12px 18px", borderRadius: "10px", border: "none", background: "transparent",
      color: "#5a554c", fontSize: "14px", fontWeight: 500, cursor: "pointer", transition: "all 0.25s ease",
    }}>← Back</button>
  );
}

function BtnCopy({ onClick, copied }) {
  return (
    <button className="btn-copy" onClick={onClick} style={{
      padding: "7px 16px", borderRadius: "6px", border: "1px solid rgba(201,168,76,0.25)",
      background: copied ? "rgba(201,168,76,0.1)" : "transparent",
      color: "#c9a84c", fontSize: "12px", fontWeight: 600, cursor: "pointer",
      transition: "all 0.25s ease", letterSpacing: "0.5px", textTransform: "uppercase",
    }}>{copied ? "✓ Copied" : "Copy"}</button>
  );
}

// ── Styles ──

const S = {
  page: {
    minHeight: "100vh", background: "#050505", color: "#e8e4db",
    fontFamily: "'Outfit',sans-serif", position: "relative", overflow: "hidden",
  },
  glowTop: {
    position: "fixed", top: "-250px", right: "-200px", width: "650px", height: "650px",
    background: "radial-gradient(circle, rgba(201,168,76,0.045) 0%, transparent 60%)",
    pointerEvents: "none",
  },
  glowBot: {
    position: "fixed", bottom: "-250px", left: "-150px", width: "550px", height: "550px",
    background: "radial-gradient(circle, rgba(120,100,180,0.025) 0%, transparent 60%)",
    pointerEvents: "none",
  },
  grain: {
    position: "fixed", inset: 0, pointerEvents: "none", zIndex: 0, opacity: 0.025,
    backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)'/%3E%3C/svg%3E")`,
  },
  container: {
    maxWidth: "700px", margin: "0 auto", padding: "48px 24px 120px",
    position: "relative", zIndex: 1,
  },
  header: { textAlign: "center", marginBottom: "36px" },
  logoBadge: {
    display: "inline-flex", alignItems: "center", gap: "8px",
    padding: "7px 18px", borderRadius: "100px",
    background: "rgba(201,168,76,0.06)", border: "1px solid rgba(201,168,76,0.12)",
    fontSize: "12px", fontWeight: 600, letterSpacing: "1.5px", textTransform: "uppercase",
    color: "#c9a84c", marginBottom: "20px",
  },
  logoIcon: { fontSize: "14px" },
  title: {
    fontFamily: "'Cormorant Garamond',Georgia,serif",
    fontSize: "clamp(32px,7vw,52px)", fontWeight: 700,
    lineHeight: 1.08, margin: "0 0 16px", color: "#f0ece4", letterSpacing: "-0.5px",
  },
  goldText: {
    background: "linear-gradient(135deg, #c9a84c 0%, #e8d48b 40%, #c9a84c 70%, #a88a30 100%)",
    backgroundSize: "200% auto",
    WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
    animation: "shimmer 6s linear infinite",
  },
  subtitle: {
    fontSize: "16px", color: "#6d675e", fontWeight: 300, lineHeight: 1.65,
    maxWidth: "520px", margin: "0 auto",
  },
  divider: {
    display: "flex", alignItems: "center", gap: "16px",
    marginTop: "28px", justifyContent: "center",
  },
  dividerLine: { width: "60px", height: "1px", background: "linear-gradient(to right, transparent, rgba(201,168,76,0.15), transparent)" },
  dividerDot: { color: "#c9a84c", fontSize: "10px", opacity: 0.4 },

  progressWrap: { marginBottom: "40px" },
  progressTrack: {
    height: "2px", borderRadius: "2px", background: "rgba(255,255,255,0.04)",
    overflow: "hidden", marginBottom: "10px",
  },
  progressFill: {
    height: "100%", borderRadius: "2px",
    background: "linear-gradient(90deg, #a88a30, #c9a84c, #d4b85a)",
    transition: "width 0.6s ease",
  },
  progressLabels: { display: "flex", justifyContent: "space-between", padding: "0 2px" },
  progressLabel: {
    fontSize: "10px", fontWeight: 600, letterSpacing: "0.8px",
    textTransform: "uppercase", transition: "color 0.3s",
  },

  detailGrid: { display: "flex", flexDirection: "column", gap: "12px" },
  detailCard: {
    padding: "24px", borderRadius: "14px",
    border: "1px solid rgba(255,255,255,0.05)", background: "rgba(255,255,255,0.015)",
    cursor: "pointer", textAlign: "left",
    transition: "all 0.35s cubic-bezier(0.4,0,0.2,1)", color: "#e8e4db",
  },
  detailIcon: { fontSize: "20px", color: "#c9a84c", marginBottom: "8px" },
  detailLabel: {
    fontSize: "20px", fontWeight: 700, marginBottom: "2px",
    fontFamily: "'Cormorant Garamond',Georgia,serif", color: "#f0ece4",
  },
  detailTagline: { fontSize: "13px", color: "#c9a84c", fontWeight: 500, marginBottom: "8px" },
  detailDesc: { fontSize: "14px", color: "#6d675e", lineHeight: 1.5, marginBottom: "12px" },
  detailFooter: { display: "flex", alignItems: "center" },
  detailQuestions: {
    fontSize: "11px", fontWeight: 600, color: "#8a857c",
    textTransform: "uppercase", letterSpacing: "0.8px",
    padding: "4px 10px", borderRadius: "4px",
    background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.04)",
  },

  // AI chips
  aiChipsWrap: {
    display: "flex", flexWrap: "wrap", gap: "8px", marginBottom: "20px",
  },
  aiChip: {
    padding: "10px 18px", borderRadius: "8px",
    border: "1px solid rgba(255,255,255,0.06)", background: "rgba(255,255,255,0.02)",
    color: "#7a756c", fontSize: "14px", fontWeight: 500,
    cursor: "pointer", transition: "all 0.25s ease",
    display: "flex", alignItems: "center",
  },
  orDivider: {
    display: "flex", alignItems: "center", gap: "14px", marginBottom: "16px",
  },
  orLine: { flex: 1, height: "1px", background: "rgba(255,255,255,0.05)" },
  orText: {
    fontSize: "11px", fontWeight: 500, color: "#4a4540",
    textTransform: "uppercase", letterSpacing: "0.8px",
  },

  card: {
    background: "rgba(255,255,255,0.015)", border: "1px solid rgba(255,255,255,0.05)",
    borderRadius: "16px", padding: "28px",
  },
  inputLabel: {
    display: "block", fontSize: "12px", fontWeight: 600, color: "#8a857c",
    marginBottom: "10px", textTransform: "uppercase", letterSpacing: "0.8px",
  },
  input: {
    width: "100%", padding: "15px 18px", borderRadius: "10px",
    border: "1px solid rgba(255,255,255,0.06)", background: "rgba(0,0,0,0.4)",
    color: "#e8e4db", fontSize: "16px", fontFamily: "'Outfit',sans-serif",
    transition: "border-color 0.25s",
  },
  textarea: {
    width: "100%", padding: "15px 18px", borderRadius: "10px",
    border: "1px solid rgba(255,255,255,0.06)", background: "rgba(0,0,0,0.4)",
    color: "#e8e4db", fontSize: "15px", fontFamily: "'Outfit',sans-serif",
    resize: "vertical", lineHeight: 1.55, transition: "border-color 0.25s",
  },
  cardActions: {
    display: "flex", justifyContent: "space-between", alignItems: "center",
    marginTop: "20px", gap: "12px", flexWrap: "wrap",
  },

  loadBox: { textAlign: "center", padding: "70px 20px" },
  loadTitle: { fontSize: "18px", fontWeight: 600, color: "#f0ece4", margin: "0 0 8px", animation: "pulse 1.8s ease infinite" },
  loadSub: { fontSize: "14px", color: "#5a554c", margin: 0 },

  questionsWrap: { display: "flex", flexDirection: "column", gap: "12px", marginBottom: "20px" },
  qCard: {
    display: "flex", gap: "14px", padding: "22px", borderRadius: "14px",
    background: "rgba(255,255,255,0.015)", border: "1px solid rgba(255,255,255,0.05)",
  },
  qNum: {
    width: "26px", height: "26px", borderRadius: "50%",
    background: "rgba(201,168,76,0.08)", border: "1px solid rgba(201,168,76,0.15)",
    display: "flex", alignItems: "center", justifyContent: "center",
    fontSize: "12px", fontWeight: 700, color: "#c9a84c", flexShrink: 0, marginTop: "2px",
  },
  qLabel: { display: "block", fontSize: "15px", fontWeight: 500, color: "#e8e4db", marginBottom: "10px", lineHeight: 1.45 },
  qInput: {
    width: "100%", padding: "12px 14px", borderRadius: "8px",
    border: "1px solid rgba(255,255,255,0.06)", background: "rgba(0,0,0,0.4)",
    color: "#e8e4db", fontSize: "14px", fontFamily: "'Outfit',sans-serif",
    resize: "vertical", lineHeight: 1.5, transition: "border-color 0.25s",
  },
  aBadge: {
    marginLeft: "10px", padding: "2px 10px", borderRadius: "100px",
    background: "rgba(0,0,0,0.25)", fontSize: "11px", fontWeight: 500,
  },
  errorBox: {
    padding: "14px 18px", borderRadius: "10px",
    background: "rgba(180,60,60,0.08)", border: "1px solid rgba(180,60,60,0.15)",
    color: "#d48080", fontSize: "14px", marginBottom: "16px",
  },

  resultBadge: {
    display: "inline-block", padding: "8px 22px", borderRadius: "100px",
    background: "rgba(201,168,76,0.06)", border: "1px solid rgba(201,168,76,0.15)",
    fontSize: "14px", fontWeight: 600, color: "#c9a84c", marginBottom: "12px", letterSpacing: "0.3px",
  },
  resultSub: { fontSize: "15px", color: "#6d675e", margin: 0, lineHeight: 1.5 },
  resultCard: {
    borderRadius: "16px", background: "rgba(255,255,255,0.015)",
    border: "1px solid rgba(201,168,76,0.12)", overflow: "hidden",
    animation: "goldPulse 3s ease infinite",
  },
  resultHeader: {
    display: "flex", justifyContent: "space-between", alignItems: "center",
    padding: "14px 22px", borderBottom: "1px solid rgba(255,255,255,0.04)",
    flexWrap: "wrap", gap: "8px",
  },
  resultMeta: { display: "flex", alignItems: "center", gap: "8px" },
  resultMetaTag: {
    fontSize: "11px", fontWeight: 600, color: "#8a857c", textTransform: "uppercase", letterSpacing: "0.6px",
  },
  resultMetaDot: { color: "#3a3632", fontSize: "10px" },
  resultText: {
    padding: "26px", margin: 0, fontSize: "16px", lineHeight: 1.8,
    color: "#e8e4db", fontWeight: 300, whiteSpace: "pre-wrap",
  },
  resultActions: { display: "flex", gap: "10px", marginTop: "20px", flexWrap: "wrap" },

  tipsCard: {
    marginTop: "32px", padding: "22px", borderRadius: "12px",
    background: "rgba(120,100,180,0.03)", border: "1px solid rgba(120,100,180,0.08)",
  },
  tipsHeader: {
    fontSize: "12px", fontWeight: 700, color: "rgba(160,140,210,0.7)",
    marginBottom: "14px", textTransform: "uppercase", letterSpacing: "1px",
  },
  tipsList: { display: "flex", flexDirection: "column", gap: "8px" },
  tipItem: {
    fontSize: "13px", color: "#6d675e", lineHeight: 1.5,
    paddingLeft: "14px", borderLeft: "2px solid rgba(120,100,180,0.12)",
  },

  historySection: {
    marginTop: "56px", paddingTop: "28px", borderTop: "1px solid rgba(255,255,255,0.03)",
  },
  histToggle: {
    background: "none", border: "none", color: "#5a554c", fontSize: "13px",
    cursor: "pointer", fontWeight: 500, padding: 0, display: "flex", alignItems: "center",
    transition: "color 0.2s",
  },
  histCount: {
    marginLeft: "6px", padding: "1px 8px", borderRadius: "4px",
    background: "rgba(201,168,76,0.08)", color: "#c9a84c", fontSize: "11px", fontWeight: 600,
  },
  histList: {
    marginTop: "14px", display: "flex", flexDirection: "column", gap: "8px", animation: "fadeUp 0.3s ease",
  },
  histItem: {
    padding: "16px 20px", borderRadius: "12px",
    background: "rgba(255,255,255,0.01)", border: "1px solid rgba(255,255,255,0.04)",
    cursor: "pointer", transition: "all 0.25s ease",
  },
  histTop: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" },
  histTags: { display: "flex", gap: "6px" },
  histTag: {
    fontSize: "10px", fontWeight: 600, color: "#c9a84c", textTransform: "uppercase",
    letterSpacing: "0.6px", padding: "2px 8px", borderRadius: "4px", background: "rgba(201,168,76,0.06)",
  },
  histTime: { fontSize: "11px", color: "#3a3632" },
  histTopic: { fontSize: "14px", fontWeight: 500, color: "#b0aa9f", marginBottom: "4px" },
  histPreview: { fontSize: "12px", color: "#5a554c", lineHeight: 1.4 },
};

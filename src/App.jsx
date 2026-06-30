import React, { useState, useEffect, useRef } from "react";
import {
  Timer,
  PenLine,
  Sparkles,
  RotateCcw,
  CheckCircle2,
  AlertCircle,
  ChevronDown,
  Loader2,
  Quote,
  History,
  Trash2,
  Plus,
  FileDown,
} from "lucide-react";
import { API_URL, APP_SECRET } from "./config.js";
import { Document, Packer, Paragraph, TextRun, HeadingLevel } from "docx";

// ---- ISEE Lower Level prompt bank (grades 5–6 entry) ----
const PROMPTS = [
  { cat: "A person", text: "Who is your most important role model? Describe this person and the influence they have had on you." },
  { cat: "A person", text: "Describe someone who has had a significant impact on your life and explain why." },
  { cat: "Favorites", text: "What is your favorite subject in school? Explain why it is your favorite." },
  { cat: "Favorites", text: "What is your favorite season? Why is it important to you?" },
  { cat: "Favorites", text: "Who is your favorite author or musician? What do you like about their work?" },
  { cat: "Favorites", text: "What is your favorite family tradition? Describe it and explain why it matters to you." },
  { cat: "Experience", text: "Describe one important lesson you learned in the past year." },
  { cat: "Experience", text: "Describe a time when you overcame a challenge. What did you learn from it?" },
  { cat: "About you", text: "What three words would you use to describe yourself? Explain why you chose each one." },
  { cat: "About you", text: "What is your greatest skill? How do you use it in your everyday life?" },
  { cat: "Interests", text: "What is your favorite thing to do in your free time? Why is it important to you?" },
  { cat: "Interests", text: "Describe an activity or club you would like to try. Explain why it interests you." },
  { cat: "Imagine", text: "If you could live anywhere in the world, where would you live and why?" },
  { cat: "Imagine", text: "If you could control the weather, what would you change and why?" },
  { cat: "Imagine", text: "If you could invite any person from history to dinner, who would it be and why?" },
  { cat: "Books", text: "Think about a book you have read. Which character do you admire most, and why?" },
];

const CATS = [...new Set(PROMPTS.map((p) => p.cat))];
const TOTAL_SECONDS = 30 * 60;

const INK = "#1f3147";
const INK_SOFT = "#3a4d66";
const PAPER = "#fbfaf6";
const RULE = "#c9d4e8";
const MARGIN = "#e0b3ac";
const ACCENT = "#1f3a5f";
const AMBER = "#b06a16";

const RATING_STYLE = {
  Strong: { bg: "#e7f0e8", fg: "#2f6b3c", dot: "#3f8a4f" },
  "On Track": { bg: "#eaf0f7", fg: "#2f5485", dot: "#3f6aa3" },
  Developing: { bg: "#f6ecdf", fg: "#94621c", dot: "#bd8431" },
};

// ---- localStorage history ----
const HKEY = "isee_essay_history_v1";
function loadHistory() {
  try {
    return JSON.parse(localStorage.getItem(HKEY)) || [];
  } catch {
    return [];
  }
}
function persistHistory(list) {
  try {
    localStorage.setItem(HKEY, JSON.stringify(list.slice(0, 50)));
  } catch {
    /* ignore quota errors */
  }
}

const MKEY = "isee_mode_v1";
function loadMode() {
  try {
    const m = localStorage.getItem(MKEY);
    return m === "paper" || m === "computer" ? m : "computer";
  } catch {
    return "computer";
  }
}

const CKEY = "isee_custom_prompts_v1";
function loadCustom() {
  try {
    return JSON.parse(localStorage.getItem(CKEY)) || [];
  } catch {
    return [];
  }
}
function persistCustom(list) {
  try {
    localStorage.setItem(CKEY, JSON.stringify(list.slice(0, 100)));
  } catch {
    /* ignore */
  }
}

const CONFIG_MISSING = !API_URL || API_URL.includes("REPLACE_WITH");

export default function App() {
  const [screen, setScreen] = useState("start"); // start | writing | feedback
  const [prompt, setPrompt] = useState(null);
  const [catOpen, setCatOpen] = useState(false);
  const [rewrite, setRewrite] = useState("");
  const [essay, setEssay] = useState("");
  const [timeLeft, setTimeLeft] = useState(TOTAL_SECONDS);
  const [loading, setLoading] = useState(false);
  const [evaluation, setEvaluation] = useState(null);
  const [error, setError] = useState("");
  const [history, setHistory] = useState(() => loadHistory());
  const [reviewing, setReviewing] = useState(false); // viewing an old record
  const [mode, setMode] = useState(() => loadMode()); // "computer" | "paper"
  const [reviewedMode, setReviewedMode] = useState("computer");
  const [customPrompts, setCustomPrompts] = useState(() => loadCustom());
  const [customInput, setCustomInput] = useState("");

  function chooseMode(m) {
    setMode(m);
    try {
      localStorage.setItem(MKEY, m);
    } catch {
      /* ignore */
    }
  }

  function addAndStartCustom() {
    const text = customInput.trim();
    if (!text) return;
    const rec = { id: Date.now(), text };
    setCustomPrompts((list) => {
      const next = [rec, ...list];
      persistCustom(next);
      return next;
    });
    setCustomInput("");
    startWith({ text, cat: "Custom" });
  }

  function deleteCustom(id) {
    setCustomPrompts((list) => {
      const next = list.filter((c) => c.id !== id);
      persistCustom(next);
      return next;
    });
  }

  const essayRef = useRef("");
  const rewriteRef = useRef("");
  essayRef.current = essay;
  rewriteRef.current = rewrite;

  const words = essay.trim() ? essay.trim().split(/\s+/).length : 0;

  // countdown
  useEffect(() => {
    if (screen !== "writing") return;
    if (timeLeft <= 0) {
      finish();
      return;
    }
    const id = setTimeout(() => setTimeLeft((t) => t - 1), 1000);
    return () => clearTimeout(id);
  }, [screen, timeLeft]);

  function startWith(p) {
    setPrompt(p);
    setRewrite("");
    setEssay("");
    setEvaluation(null);
    setError("");
    setReviewing(false);
    setTimeLeft(TOTAL_SECONDS);
    setScreen("writing");
  }

  function randomPrompt() {
    startWith(PROMPTS[Math.floor(Math.random() * PROMPTS.length)]);
  }

  async function finish() {
    if (loading) return;
    const currentEssay = essayRef.current;
    const currentRewrite = rewriteRef.current;
    const wc = currentEssay.trim() ? currentEssay.trim().split(/\s+/).length : 0;
    if (wc < 20) {
      setScreen("feedback");
      setEvaluation(null);
      setError("Your essay is too short (write at least 20 words first). Write a real paragraph, then press Try again.");
      return;
    }
    setScreen("feedback");
    setLoading(true);
    setError("");
    setReviewing(false);
    try {
      const res = await fetch(API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(APP_SECRET ? { "x-app-secret": APP_SECRET } : {}),
        },
        body: JSON.stringify({
          prompt: prompt.text,
          rewrite: currentRewrite,
          essay: currentEssay,
        }),
      });
      if (!res.ok) throw new Error("status " + res.status);
      const parsed = await res.json();
      if (parsed.error) throw new Error(parsed.error);
      setEvaluation(parsed);

      const record = {
        id: Date.now(),
        date: new Date().toISOString(),
        mode,
        prompt: prompt.text,
        cat: prompt.cat,
        rewrite: currentRewrite,
        essay: currentEssay,
        evaluation: parsed,
      };
      setHistory((h) => {
        const next = [record, ...h];
        persistHistory(next);
        return next;
      });
    } catch (e) {
      setError("Couldn't generate feedback. Your essay is safe below — press Try again.");
    } finally {
      setLoading(false);
    }
  }

  function reviewRecord(rec) {
    setPrompt({ text: rec.prompt, cat: rec.cat });
    setRewrite(rec.rewrite || "");
    setEssay(rec.essay || "");
    setEvaluation(rec.evaluation);
    setError("");
    setReviewedMode(rec.mode || (rec.rewrite ? "paper" : "computer"));
    setReviewing(true);
    setScreen("feedback");
  }

  function deleteRecord(id) {
    setHistory((h) => {
      const next = h.filter((r) => r.id !== id);
      persistHistory(next);
      return next;
    });
  }

  function clearHistory() {
    setHistory([]);
    persistHistory([]);
  }

  async function downloadDocx() {
    const ess = essay || "";
    const dispMode = reviewing ? reviewedMode : mode;
    const paras = [];

    paras.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        children: [new TextRun({ text: prompt?.text || "ISEE Essay" })],
      })
    );
    paras.push(
      new Paragraph({
        children: [
          new TextRun({
            text: `${new Date().toLocaleString()} · ${ess.trim() ? ess.trim().split(/\s+/).length : 0} words · ${dispMode === "paper" ? "Paper" : "Computer"}`,
            italics: true,
            color: "888888",
            size: 18,
          }),
        ],
      })
    );
    if (dispMode === "paper" && rewrite) {
      paras.push(
        new Paragraph({
          children: [new TextRun({ text: `Prompt copied: ${rewrite}`, italics: true, size: 20 })],
        })
      );
    }
    paras.push(new Paragraph({ text: "" }));

    ess.split(/\n/).forEach((line) => {
      paras.push(new Paragraph({ children: [new TextRun({ text: line, size: 24 })] }));
    });

    if (evaluation) {
      const ev = evaluation;
      paras.push(new Paragraph({ text: "" }));
      paras.push(new Paragraph({ heading: HeadingLevel.HEADING_3, children: [new TextRun({ text: "Feedback" })] }));
      if (ev.summary) paras.push(new Paragraph({ children: [new TextRun({ text: ev.summary, size: 22 })] }));
      if (ev.responsiveness) paras.push(new Paragraph({ children: [new TextRun({ text: ev.responsiveness, size: 22 })] }));
      if (Array.isArray(ev.dimensions)) {
        paras.push(new Paragraph({ text: "" }));
        ev.dimensions.forEach((d) =>
          paras.push(
            new Paragraph({
              children: [
                new TextRun({ text: `${d.name}: `, bold: true, size: 22 }),
                new TextRun({ text: `[${d.rating}] ${d.comment || ""}`, size: 22 }),
              ],
            })
          )
        );
      }
      if (Array.isArray(ev.mistakes) && ev.mistakes.length) {
        paras.push(new Paragraph({ text: "" }));
        paras.push(new Paragraph({ children: [new TextRun({ text: "Mistakes to fix", bold: true, size: 22 })] }));
        ev.mistakes.forEach((m) =>
          paras.push(
            new Paragraph({
              bullet: { level: 0 },
              children: [new TextRun({ text: `"${m.quote}" — ${m.issue} → ${m.fix}`, size: 22 })],
            })
          )
        );
      }
      if (Array.isArray(ev.priorities) && ev.priorities.length) {
        paras.push(new Paragraph({ text: "" }));
        paras.push(new Paragraph({ children: [new TextRun({ text: "Practice next", bold: true, size: 22 })] }));
        ev.priorities.forEach((p) =>
          paras.push(new Paragraph({ bullet: { level: 0 }, children: [new TextRun({ text: p, size: 22 })] }))
        );
      }
    }

    const doc = new Document({ sections: [{ children: paras }] });
    const blob = await Packer.toBlob(doc);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const safe = (prompt?.text || "isee-essay").slice(0, 40).replace(/[^\w\u4e00-\u9fa5]+/g, "_").replace(/^_+|_+$/g, "");
    a.download = (safe || "isee-essay") + ".docx";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  const mm = String(Math.floor(timeLeft / 60)).padStart(2, "0");
  const ss = String(timeLeft % 60).padStart(2, "0");
  const low = timeLeft <= 120;

  return (
    <div style={{ minHeight: "100%", background: "#eef0f3", color: INK }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Newsreader:ital,opsz,wght@0,6..72,400;0,6..72,500;0,6..72,600;1,6..72,400&family=Inter:wght@400;500;600&family=Space+Mono:wght@400;700&display=swap');
        * { box-sizing: border-box; }
        .ies-wrap { font-family: 'Inter', system-ui, sans-serif; max-width: 860px; margin: 0 auto; padding: 28px 20px 60px; }
        .ies-display { font-family: 'Newsreader', Georgia, serif; }
        .ies-mono { font-family: 'Space Mono', ui-monospace, monospace; }
        .ies-card { background: ${PAPER}; border: 1px solid #dfe0db; border-radius: 14px; box-shadow: 0 1px 0 #fff inset, 0 10px 30px -22px rgba(31,49,71,.5); }
        .ies-btn { font-family:'Inter',sans-serif; font-weight:600; border:none; border-radius:10px; cursor:pointer; transition: filter .15s, transform .05s; }
        .ies-btn:active { transform: translateY(1px); }
        .ies-btn:disabled { opacity:.5; cursor:not-allowed; }
        .ies-btn-primary { background:${ACCENT}; color:#fff; padding:14px 22px; font-size:15px; }
        .ies-btn-primary:hover:not(:disabled) { filter:brightness(1.12); }
        .ies-btn-ghost { background:transparent; color:${ACCENT}; border:1px solid #c7cdd6; padding:10px 16px; font-size:14px; }
        .ies-btn-ghost:hover { background:#f1f3f7; }
        .ies-chip { font-family:'Inter',sans-serif; font-size:12.5px; font-weight:500; padding:7px 13px; border-radius:999px; border:1px solid #cdd3dc; background:#fff; color:${INK_SOFT}; cursor:pointer; transition:all .12s; }
        .ies-chip:hover { border-color:${ACCENT}; color:${ACCENT}; }
        .ies-row { width:100%; text-align:left; background:#fff; border:1px solid #e7e3da; border-radius:10px; padding:11px 14px; cursor:pointer; transition:border-color .12s, background .12s; }
        .ies-row:hover { border-color:${ACCENT}; background:#fcfdff; }
        .ies-seg { display:inline-flex; background:#eef0f3; border:1px solid #d8dce2; border-radius:10px; padding:3px; gap:3px; }
        .ies-seg button { font-family:'Inter',sans-serif; font-weight:600; font-size:13px; border:none; background:transparent; color:${INK_SOFT}; padding:7px 16px; border-radius:7px; cursor:pointer; transition:all .12s; }
        .ies-seg button.on { background:#fff; color:${ACCENT}; box-shadow:0 1px 3px rgba(31,49,71,.12); }
        .ies-plain textarea {
          width:100%; border:none; outline:none; resize:vertical; min-height:440px;
          font-family:'Newsreader', Georgia, serif; font-size:18px; line-height:1.7; color:${INK};
          background-color:${PAPER}; padding:16px 22px 22px;
        }
        .ies-plain textarea::placeholder { color:#aeb4bd; }
        .ies-sheet textarea {
          width:100%; border:none; outline:none; resize:vertical; min-height:420px;
          font-family:'Newsreader', Georgia, serif; font-size:18px; line-height:34px; color:${INK};
          background-color:${PAPER};
          background-image:
            repeating-linear-gradient(to bottom, transparent 0, transparent 33px, ${RULE} 33px, ${RULE} 34px),
            linear-gradient(to right, transparent 0, transparent 50px, ${MARGIN} 50px, ${MARGIN} 51.5px, transparent 51.5px);
          background-attachment: local, local;
          padding: 7px 20px 20px 66px;
        }
        .ies-sheet textarea::placeholder { color:#aeb4bd; }
        .ies-rewrite { width:100%; font-family:'Newsreader',serif; font-size:16px; color:${INK}; border:none; border-bottom:1.5px solid ${MARGIN}; background:transparent; outline:none; padding:6px 2px; }
        .ies-rewrite::placeholder { color:#b7bcc4; font-style:italic; }
        .ies-eyebrow { font-family:'Inter',sans-serif; font-size:11px; font-weight:600; letter-spacing:.14em; text-transform:uppercase; color:#8a93a0; }
        .ies-fade { animation: iesFade .4s ease both; }
        @keyframes iesFade { from { opacity:0; transform: translateY(6px);} to {opacity:1; transform:none;} }
        @keyframes iesSpin { to { transform: rotate(360deg); } }
        @media (prefers-reduced-motion: reduce) { .ies-fade { animation:none; } }
      `}</style>

      <div className="ies-wrap">
        {/* header */}
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, marginBottom: 22 }}>
          <div>
            <div className="ies-eyebrow">ISEE · Lower Level · Grade 6 entry</div>
            <h1 className="ies-display" style={{ margin: "4px 0 0", fontSize: 30, fontWeight: 600, letterSpacing: "-.01em" }}>
              Essay Studio
            </h1>
          </div>
          {screen === "writing" && (
            <div
              className="ies-mono"
              style={{
                display: "flex", alignItems: "center", gap: 8,
                fontSize: 26, fontWeight: 700,
                color: low ? "#b3261e" : INK,
                background: low ? "#fbeae8" : "#fff",
                border: `1px solid ${low ? "#eccbc7" : "#dfe0db"}`,
                borderRadius: 10, padding: "8px 14px",
              }}
            >
              <Timer size={20} strokeWidth={2.2} />
              {mm}:{ss}
            </div>
          )}
        </div>

        {/* config warning */}
        {CONFIG_MISSING && (
          <div className="ies-card" style={{ padding: "14px 18px", marginBottom: 16, borderLeft: `4px solid ${AMBER}`, display: "flex", gap: 10, alignItems: "flex-start" }}>
            <AlertCircle size={18} color={AMBER} style={{ marginTop: 1, flexShrink: 0 }} />
            <span style={{ fontSize: 13.5, color: INK_SOFT, lineHeight: 1.55 }}>
              The proxy URL isn't set. Set <code>VITE_API_URL</code> in <code>.env</code> (or edit <code>src/config.js</code>) to point at your Worker, or feedback will fail. Writing and the timer still work.
            </span>
          </div>
        )}

        {/* ---------- START ---------- */}
        {screen === "start" && (
          <div className="ies-fade">
            <div className="ies-card" style={{ padding: "30px 30px 34px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 20 }}>
                <div className="ies-seg" role="group" aria-label="Test format">
                  <button className={mode === "computer" ? "on" : ""} onClick={() => chooseMode("computer")}>Computer</button>
                  <button className={mode === "paper" ? "on" : ""} onClick={() => chooseMode("paper")}>Paper</button>
                </div>
                <span style={{ fontSize: 12.5, color: "#8a93a0", lineHeight: 1.5 }}>
                  {mode === "computer"
                    ? "Type on screen — the prompt is shown, no need to copy it"
                    : "Handwriting practice — copy the prompt at the top of page one"}
                </span>
              </div>
              <p className="ies-display" style={{ fontSize: 20, lineHeight: 1.5, margin: "0 0 6px", color: INK }}>
                One prompt. Thirty minutes. Up to two pages.
              </p>
              <p style={{ fontSize: 14.5, color: INK_SOFT, lineHeight: 1.65, margin: "0 0 22px" }}>
                On the real test the prompt is assigned at random, so the best practice is to take whatever comes. Plan for a
                minute, write a clear introduction, two or three body paragraphs with real examples from your own life, and a
                short conclusion. Save a minute at the end to fix spelling and punctuation.
              </p>

              <button className="ies-btn ies-btn-primary" onClick={randomPrompt} style={{ display: "inline-flex", alignItems: "center", gap: 9 }}>
                <Sparkles size={18} /> Give me a random prompt
              </button>

              <div style={{ marginTop: 22 }}>
                <button
                  onClick={() => setCatOpen((o) => !o)}
                  className="ies-btn"
                  style={{ background: "transparent", color: INK_SOFT, fontWeight: 500, fontSize: 13.5, display: "inline-flex", alignItems: "center", gap: 6, padding: 0 }}
                >
                  Or choose a topic type to target
                  <ChevronDown size={16} style={{ transform: catOpen ? "rotate(180deg)" : "none", transition: "transform .2s" }} />
                </button>
                {catOpen && (
                  <div className="ies-fade" style={{ marginTop: 14, display: "flex", flexWrap: "wrap", gap: 9 }}>
                    {CATS.map((c) => {
                      const pool = PROMPTS.filter((p) => p.cat === c);
                      return (
                        <button key={c} className="ies-chip" onClick={() => startWith(pool[Math.floor(Math.random() * pool.length)])}>
                          {c}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* custom prompts */}
            <div className="ies-card" style={{ padding: "20px 24px", marginTop: 16 }}>
              <div className="ies-eyebrow" style={{ marginBottom: 12, display: "inline-flex", alignItems: "center", gap: 7 }}>
                <PenLine size={14} /> Custom prompts
              </div>
              <div style={{ display: "flex", gap: 9, flexWrap: "wrap" }}>
                <input
                  value={customInput}
                  onChange={(e) => setCustomInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") addAndStartCustom();
                  }}
                  placeholder="Type your own essay prompt, then press Enter or the button…"
                  style={{
                    flex: 1, minWidth: 220, fontFamily: "'Newsreader',serif", fontSize: 15,
                    color: INK, border: "1px solid #d8dce2", borderRadius: 9, padding: "11px 14px", outline: "none",
                  }}
                />
                <button
                  className="ies-btn ies-btn-primary"
                  onClick={addAndStartCustom}
                  disabled={!customInput.trim()}
                  style={{ display: "inline-flex", alignItems: "center", gap: 7, padding: "11px 18px", fontSize: 14 }}
                >
                  <Plus size={16} /> Start with this prompt
                </button>
              </div>
              {customPrompts.length > 0 && (
                <div style={{ display: "grid", gap: 9, marginTop: 14 }}>
                  {customPrompts.map((c) => (
                    <div key={c.id} style={{ display: "flex", gap: 8, alignItems: "stretch" }}>
                      <button className="ies-row" onClick={() => startWith({ text: c.text, cat: "Custom" })} style={{ flex: 1 }}>
                        <div className="ies-display" style={{ fontSize: 14.5, color: INK, lineHeight: 1.4 }}>{c.text}</div>
                      </button>
                      <button
                        onClick={() => deleteCustom(c.id)}
                        className="ies-btn"
                        title="Delete this prompt"
                        style={{ background: "transparent", color: "#b7bcc4", padding: "0 6px" }}
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {history.length > 0 && (
              <div className="ies-card" style={{ padding: "20px 24px", marginTop: 16 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
                  <span className="ies-eyebrow" style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
                    <History size={14} /> Practice history ({history.length})
                  </span>
                  <button
                    onClick={clearHistory}
                    className="ies-btn"
                    style={{ background: "transparent", color: "#9a3b32", fontSize: 12.5, fontWeight: 500, display: "inline-flex", alignItems: "center", gap: 5, padding: 0 }}
                  >
                    <Trash2 size={13} /> Clear
                  </button>
                </div>
                <div style={{ display: "grid", gap: 9 }}>
                  {history.slice(0, 8).map((rec) => (
                    <div key={rec.id} style={{ display: "flex", gap: 8, alignItems: "stretch" }}>
                      <button className="ies-row" onClick={() => reviewRecord(rec)} style={{ flex: 1 }}>
                        <div style={{ fontSize: 11.5, color: "#9aa3b0", marginBottom: 3 }}>
                          {new Date(rec.date).toLocaleString()} · {rec.cat}
                        </div>
                        <div className="ies-display" style={{ fontSize: 14.5, color: INK, lineHeight: 1.4 }}>
                          {rec.prompt.length > 80 ? rec.prompt.slice(0, 80) + "…" : rec.prompt}
                        </div>
                      </button>
                      <button
                        onClick={() => deleteRecord(rec.id)}
                        className="ies-btn"
                        title="Delete"
                        style={{ background: "transparent", color: "#b7bcc4", padding: "0 6px" }}
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ---------- WRITING ---------- */}
        {screen === "writing" && prompt && (
          <div className="ies-fade">
            <div className="ies-card" style={{ padding: "18px 22px", marginBottom: 16, borderLeft: `4px solid ${ACCENT}` }}>
              <div className="ies-eyebrow" style={{ marginBottom: 6 }}>Your prompt · {prompt.cat}</div>
              <p className="ies-display" style={{ margin: 0, fontSize: 19, lineHeight: 1.45, color: INK }}>
                {prompt.text}
              </p>
            </div>

            {mode === "paper" && (
              <div className="ies-card" style={{ padding: "16px 22px 8px", marginBottom: 16 }}>
                <label className="ies-eyebrow" style={{ display: "block", marginBottom: 8 }}>
                  Step 1 — Copy the prompt here (you must do this on the paper test)
                </label>
                <input
                  className="ies-rewrite"
                  value={rewrite}
                  onChange={(e) => setRewrite(e.target.value)}
                  placeholder="Write the prompt in your own handwriting at the top of the page…"
                />
                <div style={{ height: 10 }} />
              </div>
            )}

            <div className={`ies-card ${mode === "paper" ? "ies-sheet" : "ies-plain"}`} style={{ padding: "16px 0 0", overflow: "hidden" }}>
              <div style={{ padding: "0 22px 10px", display: "flex", alignItems: "center", gap: 8 }}>
                <PenLine size={15} color={INK_SOFT} />
                <span className="ies-eyebrow">
                  {mode === "paper" ? "Step 2 — Write your essay" : "Write your essay"}
                </span>
              </div>
              <textarea
                value={essay}
                onChange={(e) => setEssay(e.target.value)}
                placeholder="Start writing here…"
                spellCheck={false}
                autoFocus
              />
            </div>

            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 16, gap: 12, flexWrap: "wrap" }}>
              <span style={{ fontSize: 13, color: INK_SOFT }}>
                {words} {words === 1 ? "word" : "words"} · aim for roughly 250–400
              </span>
              <button
                className="ies-btn ies-btn-primary"
                onClick={finish}
                style={{ display: "inline-flex", alignItems: "center", gap: 9 }}
                disabled={words < 1}
                title={words < 1 ? "Write something first" : ""}
              >
                <CheckCircle2 size={18} /> Finish &amp; get feedback
              </button>
            </div>
          </div>
        )}

        {/* ---------- FEEDBACK ---------- */}
        {screen === "feedback" && (
          <div className="ies-fade">
            {loading && (
              <div className="ies-card" style={{ padding: "44px 30px", textAlign: "center" }}>
                <Loader2 size={30} style={{ animation: "iesSpin 1s linear infinite", color: ACCENT }} />
                <p style={{ marginTop: 14, color: INK_SOFT, fontSize: 14.5 }}>Reading the essay like an admissions reader…</p>
              </div>
            )}

            {!loading && error && (
              <div className="ies-card" style={{ padding: "24px 26px", borderLeft: "4px solid #b3261e" }}>
                <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                  <AlertCircle size={20} color="#b3261e" style={{ marginTop: 2 }} />
                  <div>
                    <p style={{ margin: "0 0 12px", color: INK, fontSize: 14.5 }}>{error}</p>
                    <button className="ies-btn ies-btn-ghost" onClick={finish}>Try again</button>
                  </div>
                </div>
              </div>
            )}

            {!loading && evaluation && <Feedback ev={evaluation} prompt={prompt} rewrite={rewrite} essay={essay} reviewing={reviewing} mode={reviewing ? reviewedMode : mode} />}

            {!loading && (
              <div style={{ display: "flex", gap: 12, marginTop: 18, flexWrap: "wrap" }}>
                <button className="ies-btn ies-btn-primary" onClick={randomPrompt} style={{ display: "inline-flex", alignItems: "center", gap: 9 }}>
                  <Sparkles size={18} /> New random prompt
                </button>
                {evaluation && (
                  <button className="ies-btn ies-btn-ghost" onClick={downloadDocx} style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                    <FileDown size={16} /> Download Word (.docx)
                  </button>
                )}
                <button className="ies-btn ies-btn-ghost" onClick={() => setScreen("start")} style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                  <RotateCcw size={16} /> Back to start
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function Feedback({ ev, prompt, rewrite, essay, reviewing, mode }) {
  return (
    <div style={{ display: "grid", gap: 16 }}>
      {reviewing && (
        <div style={{ fontSize: 12.5, color: "#8a93a0", display: "flex", alignItems: "center", gap: 6 }}>
          <History size={13} /> Reviewing a saved practice
        </div>
      )}

      {/* summary */}
      <div className="ies-card" style={{ padding: "22px 26px", borderTop: `4px solid ${ACCENT}` }}>
        <div className="ies-eyebrow" style={{ marginBottom: 8 }}>Reader's note</div>
        <p className="ies-display" style={{ margin: 0, fontSize: 18, lineHeight: 1.55, color: INK }}>{ev.summary}</p>
        {ev.responsiveness && (
          <p style={{ margin: "12px 0 0", fontSize: 14, color: INK_SOFT, lineHeight: 1.6 }}>{ev.responsiveness}</p>
        )}
        {mode === "paper" && ev.rewriteCheck && (
          <p style={{ margin: "8px 0 0", fontSize: 13, color: AMBER, lineHeight: 1.6 }}>✎ {ev.rewriteCheck}</p>
        )}
      </div>

      {/* dimensions */}
      {Array.isArray(ev.dimensions) && (
        <div className="ies-card" style={{ padding: "20px 26px" }}>
          <div className="ies-eyebrow" style={{ marginBottom: 14 }}>How it reads, area by area</div>
          <div style={{ display: "grid", gap: 14 }}>
            {ev.dimensions.map((d, i) => {
              const s = RATING_STYLE[d.rating] || RATING_STYLE["On Track"];
              return (
                <div key={i} style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) auto", gap: 10, alignItems: "start" }}>
                  <div>
                    <div style={{ fontSize: 14.5, fontWeight: 600, color: INK }}>{d.name}</div>
                    <div style={{ fontSize: 13.5, color: INK_SOFT, lineHeight: 1.55, marginTop: 3 }}>{d.comment}</div>
                  </div>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 6, background: s.bg, color: s.fg, fontSize: 12.5, fontWeight: 600, padding: "5px 11px", borderRadius: 999, whiteSpace: "nowrap" }}>
                    <span style={{ width: 7, height: 7, borderRadius: "50%", background: s.dot }} />
                    {d.rating}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* mistakes */}
      {Array.isArray(ev.mistakes) && ev.mistakes.length > 0 && (
        <div className="ies-card" style={{ padding: "20px 26px" }}>
          <div className="ies-eyebrow" style={{ marginBottom: 14 }}>Mistakes to fix ({ev.mistakes.length})</div>
          <div style={{ display: "grid", gap: 12 }}>
            {ev.mistakes.map((m, i) => (
              <div key={i} style={{ background: "#fff", border: "1px solid #e7e3da", borderRadius: 10, padding: "12px 14px" }}>
                <div style={{ display: "flex", gap: 8, alignItems: "flex-start", marginBottom: 6 }}>
                  <Quote size={14} color={MARGIN} style={{ marginTop: 3, flexShrink: 0 }} />
                  <span className="ies-display" style={{ fontSize: 15.5, color: INK_SOFT, fontStyle: "italic" }}>"{m.quote}"</span>
                </div>
                <div style={{ fontSize: 13.5, color: INK, lineHeight: 1.55 }}>
                  <strong style={{ color: "#9a3b32" }}>Issue:</strong> {m.issue}
                </div>
                <div style={{ fontSize: 13.5, color: INK, lineHeight: 1.55, marginTop: 3 }}>
                  <strong style={{ color: "#2f6b3c" }}>Fix:</strong> {m.fix}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* strengths + priorities */}
      <div style={{ display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))" }}>
        {Array.isArray(ev.strengths) && ev.strengths.length > 0 && (
          <div className="ies-card" style={{ padding: "20px 24px" }}>
            <div className="ies-eyebrow" style={{ marginBottom: 12, color: "#3f8a4f" }}>What's working</div>
            <ul style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 8 }}>
              {ev.strengths.map((s, i) => (
                <li key={i} style={{ fontSize: 13.5, color: INK, lineHeight: 1.5 }}>{s}</li>
              ))}
            </ul>
          </div>
        )}
        {Array.isArray(ev.priorities) && ev.priorities.length > 0 && (
          <div className="ies-card" style={{ padding: "20px 24px" }}>
            <div className="ies-eyebrow" style={{ marginBottom: 12, color: ACCENT }}>Practice next</div>
            <ol style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 8 }}>
              {ev.priorities.map((p, i) => (
                <li key={i} style={{ fontSize: 13.5, color: INK, lineHeight: 1.5 }}>{p}</li>
              ))}
            </ol>
          </div>
        )}
      </div>

      {/* the essay itself */}
      <details className="ies-card" style={{ padding: "16px 22px" }}>
        <summary style={{ cursor: "pointer", fontSize: 13.5, fontWeight: 600, color: INK_SOFT }}>
          Read the essay again
        </summary>
        <div style={{ marginTop: 12 }}>
          <div className="ies-eyebrow" style={{ marginBottom: 4 }}>Prompt</div>
          <p className="ies-display" style={{ margin: "0 0 14px", fontSize: 15, color: INK }}>{prompt?.text}</p>
          {rewrite && (
            <>
              <div className="ies-eyebrow" style={{ marginBottom: 4 }}>Copied at top</div>
              <p className="ies-display" style={{ margin: "0 0 14px", fontSize: 14.5, color: INK_SOFT }}>{rewrite}</p>
            </>
          )}
          <div className="ies-eyebrow" style={{ marginBottom: 4 }}>Essay</div>
          <p className="ies-display" style={{ margin: 0, fontSize: 16, lineHeight: 1.7, color: INK, whiteSpace: "pre-wrap" }}>{essay}</p>
        </div>
      </details>
    </div>
  );
}

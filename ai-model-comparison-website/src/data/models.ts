export type ModelVendor =
  | "OpenAI"
  | "Anthropic"
  | "Google"
  | "xAI"
  | "Meta"
  | "DeepSeek"
  | "Alibaba"
  | "Mistral";

export interface AIModel {
  id: string;
  name: string;
  vendor: ModelVendor;
  releaseDate: string; // YYYY-MM
  tier: "flagship" | "economy" | "open";
  // Parameters in billions. null = not disclosed. Some vendors give ranges or active params.
  params: number | null;
  paramsActive: number | null;
  paramsNote?: string;
  contextWindow: number; // in tokens (k)
  maxOutput: number; // in tokens (k)
  modality: string[]; // e.g. ["text", "image", "audio", "video", "code"]
  pricing: {
    input: number; // USD per 1M tokens
    output: number; // USD per 1M tokens
    cached?: number; // per 1M input cached
    note?: string;
  } | null;
  pricingAPIOnly?: boolean;
  subscription?: string;
  benchmarks: {
    intelligenceIndex?: number; // AA Intelligence Index
    gpqaDiamond?: number; // %
    sweBenchVerified?: number; // %
    sweBenchPro?: number; // %
    arcAgi2?: number; // %
    mmluPro?: number; // %
    humanLastExam?: number; // %
    aime2025?: number; // %
  };
  strengths: string[];
  weaknesses: string[];
  website: string;
  vendorColor: string; // tailwind color class fragment
}

export const models: AIModel[] = [
  {
    id: "claude-fable-5",
    name: "Claude Fable 5",
    vendor: "Anthropic",
    releaseDate: "2026-08",
    tier: "flagship",
    params: null,
    paramsActive: null,
    paramsNote: "Undisclosed; MoE",
    contextWindow: 1000,
    maxOutput: 128,
    modality: ["text", "image", "code", "tool-use"],
    pricing: { input: 10, output: 50 },
    subscription: "Claude Pro ($20/mo), Claude Enterprise",
    benchmarks: {
      intelligenceIndex: 67,
      gpqaDiamond: 95.2,
      sweBenchPro: 80.3,
      humanLastExam: 59.1,
    },
    strengths: [
      "#1 on Artificial Analysis Intelligence Index",
      "80.3% SWE-Bench Pro — highest agentic coding",
      "67% factual accuracy on AA-Omniscience",
      "Exceptional long-form writing & prose",
    ],
    weaknesses: [
      "Most expensive flagship API",
      "No free tier beyond limited trial",
    ],
    website: "https://www.anthropic.com",
    vendorColor: "orange",
  },
  {
    id: "claude-opus-5",
    name: "Claude Opus 5",
    vendor: "Anthropic",
    releaseDate: "2026-07",
    tier: "flagship",
    params: null,
    paramsActive: null,
    paramsNote: "Undisclosed; MoE",
    contextWindow: 1000,
    maxOutput: 128,
    modality: ["text", "image", "code", "tool-use"],
    pricing: { input: 5, output: 25 },
    subscription: "Claude Pro ($20/mo)",
    benchmarks: {
      intelligenceIndex: 63,
      gpqaDiamond: 94.8,
      sweBenchVerified: 88.6,
      sweBenchPro: 75.0,
      arcAgi2: 30.0,
      humanLastExam: 49.8,
    },
    strengths: [
      "Top-tier coding, powers Cursor & Windsurf",
      "128K token single-pass output",
      "Best prose quality among flagship models",
      "Strong honesty (Scale SEAL)",
    ],
    weaknesses: [
      "Higher hallucination rate on hard questions (~50%)",
      "Outputs can be verbose",
    ],
    website: "https://www.anthropic.com",
    vendorColor: "orange",
  },
  {
    id: "gpt-5.6",
    name: "GPT-5.6",
    vendor: "OpenAI",
    releaseDate: "2026-08",
    tier: "flagship",
    params: null,
    paramsActive: null,
    paramsNote: "Undisclosed; deep MoE",
    contextWindow: 272,
    maxOutput: 64,
    modality: ["text", "image", "audio", "video", "code", "tool-use"],
    pricing: { input: 5, output: 30, cached: 0.5 },
    subscription: "ChatGPT Plus ($20/mo), Pro ($200/mo)",
    benchmarks: {
      intelligenceIndex: 55,
      gpqaDiamond: 93.9,
      sweBenchVerified: 88.7,
      arcAgi2: 92.5, // Sol variant
      mmluPro: 88,
      aime2025: 80,
    },
    strengths: [
      "Best all-rounder with largest ecosystem",
      "Canvas for document editing",
      "GPT-5.6 Sol leads ARC-AGI-2 (92.5%)",
      "Strong creativity & multimodal",
    ],
    weaknesses: [
      "Price doubled vs GPT-5.4",
      "Smaller 272K standard context vs peers",
    ],
    website: "https://openai.com",
    vendorColor: "emerald",
  },
  {
    id: "gemini-3.1-pro",
    name: "Gemini 3.1 Pro",
    vendor: "Google",
    releaseDate: "2026-02",
    tier: "flagship",
    params: null,
    paramsActive: null,
    paramsNote: "Undisclosed; MoE, TPU training",
    contextWindow: 1000,
    maxOutput: 64,
    modality: ["text", "image", "audio", "video", "code", "tool-use"],
    pricing: { input: 2, output: 12, note: "Doubles past 200K context" },
    subscription: "Google AI Ultra ($19.99/mo); free tier available",
    benchmarks: {
      intelligenceIndex: 57,
      gpqaDiamond: 94.3,
      sweBenchVerified: 80.6,
      sweBenchPro: 54.2,
      arcAgi2: 77.1,
      mmluPro: 87,
    },
    strengths: [
      "Top reasoning (94.3% GPQA Diamond)",
      "Excellent price-performance",
      "1M context window",
      "Strong multimodal (video/audio chains)",
    ],
    weaknesses: [
      "SWE-bench Pro lags behind Claude/GPT",
      "Usage quotas in consumer app",
    ],
    website: "https://deepmind.google/technologies/gemini/",
    vendorColor: "blue",
  },
  {
    id: "grok-4.3",
    name: "Grok 4.3",
    vendor: "xAI",
    releaseDate: "2026-06",
    tier: "flagship",
    params: null,
    paramsActive: null,
    paramsNote: "Undisclosed",
    contextWindow: 1000,
    maxOutput: 64,
    modality: ["text", "image", "code", "real-time-web"],
    pricing: { input: 1.25, output: 2.5 },
    subscription: "SuperGrok ($30/mo); included with X Premium+",
    benchmarks: {
      intelligenceIndex: 53,
      sweBenchVerified: 89.0,
      gpqaDiamond: 93.0,
    },
    strengths: [
      "Cheapest Tier-1 API (~1/12 of GPT-5.6 output)",
      "Leads SWE-bench Verified (75%/latest ~89%)",
      "Native real-time X/web grounding",
      "Strong agentic & tool use",
    ],
    weaknesses: [
      "Weaker long-form creative writing",
      "Opinionated / fewer guardrails",
    ],
    website: "https://x.ai",
    vendorColor: "slate",
  },
  {
    id: "claude-sonnet-5",
    name: "Claude Sonnet 5",
    vendor: "Anthropic",
    releaseDate: "2026-07",
    tier: "economy",
    params: null,
    paramsActive: null,
    paramsNote: "Undisclosed",
    contextWindow: 1000,
    maxOutput: 64,
    modality: ["text", "image", "code"],
    pricing: { input: 3, output: 15, note: "Intro $2/$10 until Aug 31, 2026" },
    subscription: "Claude Pro ($20/mo)",
    benchmarks: {
      intelligenceIndex: 53,
      gpqaDiamond: 92.0,
      sweBenchVerified: 80.0,
    },
    strengths: [
      "98% of Opus quality at 60% cost",
      "Best value mid-tier frontier",
      "Excellent instruction-following",
    ],
    weaknesses: ["Not quite flagship on hardest reasoning", "Falls off on ARC-AGI-3"],
    website: "https://www.anthropic.com",
    vendorColor: "orange",
  },
  {
    id: "gemini-3.5-flash",
    name: "Gemini 3.5 Flash",
    vendor: "Google",
    releaseDate: "2026-05",
    tier: "economy",
    params: null,
    paramsActive: null,
    contextWindow: 1000,
    maxOutput: 64,
    modality: ["text", "image", "audio", "video", "code"],
    pricing: { input: 1.5, output: 9 },
    subscription: "Free tier available",
    benchmarks: {
      intelligenceIndex: 55,
      gpqaDiamond: 90.0,
    },
    strengths: [
      "Best price-performance ratio",
      "Very fast responses",
      "Strong bulk/agent throughput",
    ],
    weaknesses: ["Below flagship on hardest coding/reasoning", "Higher hallucination on niche topics"],
    website: "https://deepmind.google",
    vendorColor: "blue",
  },
  {
    id: "grok-4.1-fast",
    name: "Grok 4.1 Fast",
    vendor: "xAI",
    releaseDate: "2026-06",
    tier: "economy",
    params: null,
    paramsActive: null,
    contextWindow: 512,
    maxOutput: 32,
    modality: ["text", "code"],
    pricing: { input: 0.2, output: 0.5 },
    subscription: "Included with X Premium+",
    benchmarks: {},
    strengths: ["Cheapest frontier-class API", "Extremely low latency", "Great for agent routing"],
    weaknesses: ["Less accurate than Grok 4.3", "Text-only"],
    website: "https://x.ai",
    vendorColor: "slate",
  },
  {
    id: "deepseek-v4",
    name: "DeepSeek V4",
    vendor: "DeepSeek",
    releaseDate: "2026-04",
    tier: "open",
    params: 1600,
    paramsActive: 48,
    paramsNote: "1.6T total / 48B active (MoE); open weights",
    contextWindow: 1000,
    maxOutput: 128,
    modality: ["text", "code"],
    pricing: { input: 0.27, output: 1.1 },
    subscription: "Open weights; free web tier",
    benchmarks: {
      gpqaDiamond: 78.0,
      sweBenchVerified: 75.0,
    },
    strengths: [
      "Open-weight frontier model",
      "Extremely cheap API",
      "Strong code and reasoning",
      "Self-hostable",
    ],
    weaknesses: ["Benchmarks slightly below closed-flagship", "Limited multimodality"],
    website: "https://www.deepseek.com",
    vendorColor: "cyan",
  },
  {
    id: "deepseek-v4-flash",
    name: "DeepSeek V4-Flash",
    vendor: "DeepSeek",
    releaseDate: "2026-05",
    tier: "economy",
    params: 1600,
    paramsActive: 24,
    paramsNote: "1.6T / 24B active MoE",
    contextWindow: 1000,
    maxOutput: 64,
    modality: ["text", "code"],
    pricing: { input: 0.14, output: 0.28 },
    subscription: "Open weights / free tier",
    benchmarks: {},
    strengths: ["Cheapest 1M-context model", "Open weights", "Excellent throughput"],
    weaknesses: ["Lower quality than V4 full"],
    website: "https://www.deepseek.com",
    vendorColor: "cyan",
  },
  {
    id: "llama-4-maverick",
    name: "Llama 4 Maverick",
    vendor: "Meta",
    releaseDate: "2026-04",
    tier: "open",
    params: 400,
    paramsActive: 17,
    paramsNote: "400B total / 17B active (MoE); open weights",
    contextWindow: 1000,
    maxOutput: 32,
    modality: ["text", "image", "code"],
    pricing: null,
    subscription: "Free / self-hosted; commercial license",
    benchmarks: {
      gpqaDiamond: 76.0,
    },
    strengths: [
      "Open weights (400B MoE)",
      "Native multimodal",
      "Deploy on your own infra",
      "Strong for customization/fine-tuning",
    ],
    weaknesses: ["Requires significant GPU resources", "Below frontier flagship benchmarks"],
    website: "https://llama.meta.com",
    vendorColor: "indigo",
  },
  {
    id: "qwen-3.7-max",
    name: "Qwen 3.7 Max",
    vendor: "Alibaba",
    releaseDate: "2026-06",
    tier: "flagship",
    params: null,
    paramsActive: null,
    contextWindow: 1000,
    maxOutput: 64,
    modality: ["text", "image", "code", "tool-use"],
    pricing: { input: 2.5, output: 7.5, note: "Promo $1.25/$3.75" },
    subscription: "Free tier; API paid",
    benchmarks: {
      gpqaDiamond: 92.4,
    },
    strengths: [
      "Frontier accuracy at value pricing",
      "200 free requests/day",
      "Strong multilingual (Chinese + English)",
    ],
    weaknesses: ["API-only (limited chat UI)", "Less mature agentic tooling"],
    website: "https://qwen.ai",
    vendorColor: "purple",
  },
  {
    id: "mistral-medium-3",
    name: "Mistral Medium 3",
    vendor: "Mistral",
    releaseDate: "2026-05",
    tier: "economy",
    params: null,
    paramsActive: null,
    contextWindow: 256,
    maxOutput: 32,
    modality: ["text", "code"],
    pricing: { input: 0.4, output: 2.0 },
    subscription: "Le Chat free; paid API",
    benchmarks: {
      gpqaDiamond: 74.0,
    },
    strengths: ["European-based provider", "Low latency, solid mid-tier", "Strong for European compliance"],
    weaknesses: ["Not at frontier level", "Limited multimodality"],
    website: "https://mistral.ai",
    vendorColor: "rose",
  },
];

export const benchmarkMeta: Record<
  keyof AIModel["benchmarks"],
  { label: string; description: string; higherIsBetter: boolean; max: number }
> = {
  intelligenceIndex: {
    label: "AA Intelligence Index",
    description:
      "Artificial Analysis composite index blending reasoning, coding, tool use & factual accuracy.",
    higherIsBetter: true,
    max: 70,
  },
  gpqaDiamond: {
    label: "GPQA Diamond",
    description: "PhD-level science questions (Google-Proof Q&A).",
    higherIsBetter: true,
    max: 100,
  },
  sweBenchVerified: {
    label: "SWE-bench Verified",
    description: "Resolving real-world GitHub issues (verified subset).",
    higherIsBetter: true,
    max: 100,
  },
  sweBenchPro: {
    label: "SWE-bench Pro",
    description: "Harder multi-file software engineering tasks.",
    higherIsBetter: true,
    max: 100,
  },
  arcAgi2: {
    label: "ARC-AGI-2",
    description: "Novel abstract reasoning puzzles (general fluid intelligence).",
    higherIsBetter: true,
    max: 100,
  },
  mmluPro: {
    label: "MMLU-Pro",
    description: "Multi-domain expert understanding (college+).",
    higherIsBetter: true,
    max: 100,
  },
  humanLastExam: {
    label: "Humanity's Last Exam",
    description: "Expert-level cross-disciplinary questions.",
    higherIsBetter: true,
    max: 100,
  },
  aime2025: {
    label: "AIME 2025",
    description: "American Invitational Mathematics Examination.",
    higherIsBetter: true,
    max: 100,
  },
};

export const tierLabels: Record<AIModel["tier"], { label: string; color: string }> = {
  flagship: { label: "Flagship", color: "bg-amber-100 text-amber-800 ring-amber-200" },
  economy: { label: "Value / Fast", color: "bg-emerald-100 text-emerald-800 ring-emerald-200" },
  open: { label: "Open-weights", color: "bg-indigo-100 text-indigo-800 ring-indigo-200" },
};

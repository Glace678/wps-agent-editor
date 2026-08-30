import type { ProviderDefinition } from '../types/provider'

/**
 * The renderer supports these nine language codes. Search terms are kept
 * independent from translated display names so a user can search in their
 * preferred language even when the provider catalog is returned in English.
 */
export const PROVIDER_SEARCH_LOCALES = [
  'zh-CN',
  'en',
  'ja',
  'es',
  'pt',
  'de',
  'fr',
  'ru',
  'ar',
] as const

export type ProviderSearchLocale = (typeof PROVIDER_SEARCH_LOCALES)[number]

export interface ProviderSearchAliasTerm {
  readonly value: string
  readonly locale?: ProviderSearchLocale
}

export interface ProviderSearchAliasBundle {
  /** Terms describing this provider itself (including generated name tokens). */
  readonly provider: readonly ProviderSearchAliasTerm[]
  /** Terms describing model families served by this provider. */
  readonly family: readonly ProviderSearchAliasTerm[]
  /** Extra ranking weight for an official/first-party provider entry. */
  readonly relevanceBoost: number
}

type LocalizedAliases = Partial<Record<ProviderSearchLocale, readonly string[]>> & {
  common?: readonly string[]
}

interface ProviderAliasRule {
  readonly familyPattern: RegExp
  readonly directPattern?: RegExp
  readonly aliases: LocalizedAliases
  readonly boost?: number
}

const aliases = (
  common: readonly string[],
  localized: Partial<Record<ProviderSearchLocale, readonly string[]>> = {},
): LocalizedAliases => ({ common, ...localized })

const all = (...values: string[]): LocalizedAliases => aliases(values)

/*
 * Terms below intentionally include product names, company names, common
 * transliterations, and the words users type when they are looking for an API
 * rather than a chat application. Brand spellings are stable across locales,
 * while the localized entries cover the most common native-language queries.
 */
const PROVIDER_ALIAS_RULES: readonly ProviderAliasRule[] = [
  {
    familyPattern: /(?:qwen|tongyi|dashscope|bailian|alibaba)/i,
    directPattern: /(?:^|[\s./_-])(?:alibaba|qwen|tongyi)(?:$|[\s./_-])/i,
    boost: 90,
    aliases: aliases(
      ['qwen', 'tongyi qianwen', 'tongyi', 'qianwen', 'alibaba', 'alibaba cloud', 'aliyun', 'alicloud', 'model studio', 'bailian', 'dashscope', 'tongyi lab', 'tongyi lingma', 'lingma'],
      {
        'zh-CN': ['通义千问', '千问', '阿里', '阿里巴巴', '阿里云', '阿里云百炼', '百炼', '灵积', '通义实验室', '通义灵码', '灵码', '模型服务', '大模型平台'],
        ja: ['通義千問', '千問', 'アリババ', 'アリババクラウド', '阿里雲百煉', 'ダッシュスコープ'],
        es: ['Alibaba Cloud', 'modelos de Alibaba', 'plataforma de modelos'],
        pt: ['Alibaba Cloud', 'modelos da Alibaba', 'plataforma de modelos'],
        de: ['Alibaba Cloud', 'Alibaba-Modelle', 'Modellplattform'],
        fr: ['Alibaba Cloud', 'modèles Alibaba', 'plateforme de modèles'],
        ru: ['Alibaba Cloud', 'модели Alibaba', 'платформа моделей'],
        ar: ['Alibaba Cloud', 'نماذج علي بابا', 'منصة النماذج'],
      },
    ),
  },
  {
    familyPattern: /(?:xiaomi|mimo)/i,
    directPattern: /xiaomi/i,
    boost: 120,
    aliases: aliases(
      ['xiaomi', 'xiaomi mimo', 'mimo', 'mimo ai', 'xiaomi ai', 'xiaomi model', 'mimo model', 'xiaoai', 'xiao ai'],
      {
        'zh-CN': ['小米', '小米大模型', '小米 MiMo', '小米模型', '米莫', '米模', '米Mo', '小爱', '小爱同学'],
        ja: ['シャオミ', '小米', 'Xiaomi MiMo', 'ミモ', 'ミーモ'],
        es: ['Xiaomi MiMo', 'modelo Xiaomi', 'IA de Xiaomi'],
        pt: ['Xiaomi MiMo', 'modelo Xiaomi', 'IA da Xiaomi'],
        de: ['Xiaomi MiMo', 'Xiaomi-Modell', 'Xiaomi-KI'],
        fr: ['Xiaomi MiMo', 'modèle Xiaomi', 'IA Xiaomi'],
        ru: ['Xiaomi MiMo', 'Сяоми', 'модель Xiaomi', 'ИИ Xiaomi'],
        ar: ['Xiaomi MiMo', 'شاومي', 'نموذج شاومي', 'ذكاء شاومي'],
      },
    ),
  },
  {
    familyPattern: /(?:tencent|hunyuan)/i,
    directPattern: /tencent/i,
    boost: 100,
    aliases: aliases(
      ['tencent', 'tencent cloud', 'tencent hunyuan', 'hunyuan', 'hunyuan ai', 'tencent yuanbao'],
      {
        'zh-CN': ['腾讯', '腾讯云', '腾讯混元', '混元', '混元大模型', '腾讯元宝'],
        ja: ['テンセント', 'テンセントクラウド', '混元', 'Hunyuan AI'],
        es: ['Tencent Cloud', 'modelo Hunyuan'],
        pt: ['Tencent Cloud', 'modelo Hunyuan'],
        de: ['Tencent Cloud', 'Hunyuan-Modell'],
        fr: ['Tencent Cloud', 'modèle Hunyuan'],
        ru: ['Tencent Cloud', 'модель Hunyuan', 'Тенсент'],
        ar: ['Tencent Cloud', 'نموذج Hunyuan', 'تينسنت'],
      },
    ),
  },
  {
    familyPattern: /(?:baidu|ernie|qianfan|wenxin)/i,
    directPattern: /(?:baidu|ernie|qianfan|wenxin)/i,
    boost: 100,
    aliases: aliases(
      ['baidu', 'baidu ai cloud', 'baidu qianfan', 'qianfan', 'ernie', 'ernie bot', 'wenxin'],
      {
        'zh-CN': ['百度', '百度智能云', '百度千帆', '千帆', '文心', '文心一言', '文心大模型'],
        ja: ['百度', 'バイドゥ', '百度千帆', '文心', 'ERNIE'],
        es: ['Baidu', 'Baidu Qianfan', 'modelo ERNIE'],
        pt: ['Baidu', 'Baidu Qianfan', 'modelo ERNIE'],
        de: ['Baidu', 'Baidu Qianfan', 'ERNIE-Modell'],
        fr: ['Baidu', 'Baidu Qianfan', 'modèle ERNIE'],
        ru: ['Baidu', 'Байду', 'Baidu Qianfan', 'модель ERNIE'],
        ar: ['Baidu', 'بايدو', 'Baidu Qianfan', 'نموذج ERNIE'],
      },
    ),
  },
  {
    familyPattern: /(?:doubao|volcengine|bytedance|seedance)/i,
    directPattern: /(?:doubao|volcengine|bytedance)/i,
    boost: 100,
    aliases: aliases(
      ['doubao', 'doubao ai', 'volcengine', 'volcano engine', 'volcengine ark', 'bytedance', 'byte dance', 'seed'],
      {
        'zh-CN': ['豆包', '豆包大模型', '火山引擎', '火山方舟', '字节跳动', '字节', '豆包模型'],
        ja: ['豆包', 'ドウバオ', 'Volcano Engine', 'バイトダンス'],
        es: ['Doubao', 'Volcano Engine', 'ByteDance'],
        pt: ['Doubao', 'Volcano Engine', 'ByteDance'],
        de: ['Doubao', 'Volcano Engine', 'ByteDance'],
        fr: ['Doubao', 'Volcano Engine', 'ByteDance'],
        ru: ['Doubao', 'Volcano Engine', 'ByteDance', 'БайтДэнс'],
        ar: ['Doubao', 'Volcano Engine', 'ByteDance', 'بايت دانس'],
      },
    ),
  },
  {
    familyPattern: /deepseek/i,
    directPattern: /deepseek/i,
    boost: 110,
    aliases: aliases(
      ['deepseek', 'deep seek', 'deepseek ai', 'deepseek api'],
      {
        'zh-CN': ['深度求索', '深度求索 AI', '深度求索模型', 'DeepSeek 模型'],
        ja: ['ディープシーク', 'DeepSeek AI', 'DeepSeekモデル'],
        es: ['DeepSeek AI', 'modelo DeepSeek'],
        pt: ['DeepSeek AI', 'modelo DeepSeek'],
        de: ['DeepSeek AI', 'DeepSeek-Modell'],
        fr: ['DeepSeek AI', 'modèle DeepSeek'],
        ru: ['DeepSeek AI', 'ДипСик', 'модель DeepSeek'],
        ar: ['DeepSeek AI', 'ديب سيك', 'نموذج DeepSeek'],
      },
    ),
  },
  {
    familyPattern: /(?:moonshot|kimi)/i,
    directPattern: /(?:moonshot|kimi)/i,
    boost: 105,
    aliases: aliases(
      ['moonshot', 'moonshot ai', 'kimi', 'kimi ai', 'kimi api', 'kimi code', 'kimi coding'],
      {
        'zh-CN': ['月之暗面', 'Kimi', 'Kimi 智能助手', 'Kimi 模型', '月之暗面 Kimi'],
        ja: ['ムーンショット', 'キミ', 'Kimi AI', 'Kimiモデル'],
        es: ['Moonshot AI', 'modelo Kimi'],
        pt: ['Moonshot AI', 'modelo Kimi'],
        de: ['Moonshot AI', 'Kimi-Modell'],
        fr: ['Moonshot AI', 'modèle Kimi'],
        ru: ['Moonshot AI', 'Кими', 'модель Kimi'],
        ar: ['Moonshot AI', 'كيمي', 'نموذج Kimi'],
      },
    ),
  },
  {
    familyPattern: /(?:zhipu|z\.ai|\bzai\b|glm(?:[- .]|$))/i,
    directPattern: /(?:zhipu|z\.ai|^zai(?:[- .]|$))/i,
    boost: 105,
    aliases: aliases(
      ['zhipu', 'zhipu ai', 'z.ai', 'zai', 'glm', 'chatglm', 'bigmodel'],
      {
        'zh-CN': ['智谱', '智谱 AI', '智谱清言', 'GLM', 'ChatGLM', '智谱大模型', '智谱开放平台'],
        ja: ['智谱', 'チープー', 'Zhipu AI', 'GLM', 'ChatGLM'],
        es: ['Zhipu AI', 'modelo GLM', 'ChatGLM'],
        pt: ['Zhipu AI', 'modelo GLM', 'ChatGLM'],
        de: ['Zhipu AI', 'GLM-Modell', 'ChatGLM'],
        fr: ['Zhipu AI', 'modèle GLM', 'ChatGLM'],
        ru: ['Zhipu AI', 'Чжипу', 'модель GLM', 'ChatGLM'],
        ar: ['Zhipu AI', 'زيبو', 'نموذج GLM', 'ChatGLM'],
      },
    ),
  },
  {
    familyPattern: /minimax/i,
    directPattern: /minimax/i,
    boost: 105,
    aliases: aliases(
      ['minimax', 'minimax ai', 'minimaxi', 'minimax api'],
      {
        'zh-CN': ['MiniMax', '海螺 AI', '海螺AI', 'MiniMax 大模型', 'MiniMax 模型'],
        ja: ['ミニマックス', 'MiniMax AI', 'MiniMaxモデル'],
        es: ['MiniMax AI', 'modelo MiniMax'],
        pt: ['MiniMax AI', 'modelo MiniMax'],
        de: ['MiniMax AI', 'MiniMax-Modell'],
        fr: ['MiniMax AI', 'modèle MiniMax'],
        ru: ['MiniMax AI', 'МиниМакс', 'модель MiniMax'],
        ar: ['MiniMax AI', 'ميني ماكس', 'نموذج MiniMax'],
      },
    ),
  },
  {
    familyPattern: /(?:stepfun|\bstep[- ](?:[0-9]|plan|flash))/i,
    directPattern: /stepfun/i,
    boost: 95,
    aliases: aliases(
      ['stepfun', 'step fun', 'step ai', 'step model', 'yuewen'],
      {
        'zh-CN': ['阶跃星辰', '阶跃', '阶跃 AI', '阶跃星辰模型', '跃问'],
        ja: ['ステップファン', 'StepFun', '階躍星辰'],
        es: ['StepFun', 'modelo StepFun'],
        pt: ['StepFun', 'modelo StepFun'],
        de: ['StepFun', 'StepFun-Modell'],
        fr: ['StepFun', 'modèle StepFun'],
        ru: ['StepFun', 'модель StepFun'],
        ar: ['StepFun', 'نموذج StepFun'],
      },
    ),
  },
  {
    familyPattern: /siliconflow/i,
    directPattern: /siliconflow/i,
    boost: 85,
    aliases: aliases(
      ['siliconflow', 'silicon flow', 'siliconcloud', 'silicon cloud'],
      {
        'zh-CN': ['硅基流动', '硅基流动平台', '硅基流动云', '硅基'],
        ja: ['SiliconFlow', 'シリコンフロー'],
        es: ['SiliconFlow'],
        pt: ['SiliconFlow'],
        de: ['SiliconFlow'],
        fr: ['SiliconFlow'],
        ru: ['SiliconFlow', 'СиликонФлоу'],
        ar: ['SiliconFlow', 'سيليكون فلو'],
      },
    ),
  },
  {
    familyPattern: /modelscope/i,
    directPattern: /modelscope/i,
    boost: 45,
    aliases: aliases(
      ['modelscope', 'model scope', 'modelscope community'],
      {
        'zh-CN': ['魔搭', '魔搭社区', '魔搭社区模型', 'ModelScope 社区'],
        ja: ['ModelScope', 'モデルスコープ'],
        es: ['comunidad ModelScope'],
        pt: ['comunidade ModelScope'],
        de: ['ModelScope-Community'],
        fr: ['communauté ModelScope'],
        ru: ['сообщество ModelScope'],
        ar: ['مجتمع ModelScope'],
      },
    ),
  },
  {
    familyPattern: /(?:openai|gpt(?:[- .]|$))/i,
    directPattern: /^openai/i,
    boost: 115,
    aliases: aliases(
      ['openai', 'open ai', 'chatgpt', 'chat gpt', 'gpt api', 'codex'],
      {
        'zh-CN': ['OpenAI', 'ChatGPT', 'GPT', 'GPT 模型', 'OpenAI 接口'],
        ja: ['OpenAI', 'オープンAI', 'ChatGPT', 'GPTモデル'],
        es: ['OpenAI', 'ChatGPT', 'modelo GPT'],
        pt: ['OpenAI', 'ChatGPT', 'modelo GPT'],
        de: ['OpenAI', 'ChatGPT', 'GPT-Modell'],
        fr: ['OpenAI', 'ChatGPT', 'modèle GPT'],
        ru: ['OpenAI', 'ОпенАИ', 'ChatGPT', 'модель GPT'],
        ar: ['OpenAI', 'أوبن إيه آي', 'ChatGPT', 'نموذج GPT'],
      },
    ),
  },
  {
    familyPattern: /(?:anthropic|claude)/i,
    directPattern: /anthropic/i,
    boost: 115,
    aliases: aliases(
      ['anthropic', 'anthropic ai', 'claude', 'claude api'],
      {
        'zh-CN': ['Anthropic', 'Claude', '克劳德', '克勞德', 'Claude 模型'],
        ja: ['Anthropic', 'アンスロピック', 'Claude', 'クロード'],
        es: ['Anthropic', 'Claude', 'modelo Claude'],
        pt: ['Anthropic', 'Claude', 'modelo Claude'],
        de: ['Anthropic', 'Claude', 'Claude-Modell'],
        fr: ['Anthropic', 'Claude', 'modèle Claude'],
        ru: ['Anthropic', 'Антропик', 'Клод', 'модель Claude'],
        ar: ['Anthropic', 'أنثروبيك', 'كلود', 'نموذج Claude'],
      },
    ),
  },
  {
    familyPattern: /(?:google|gemini|gemma|vertex)/i,
    directPattern: /^(?:google|vertex)/i,
    boost: 110,
    aliases: aliases(
      ['google', 'google ai', 'google cloud ai', 'gemini', 'gemini api', 'gemma', 'vertex ai', 'google vertex'],
      {
        'zh-CN': ['谷歌', '谷歌云', 'Google AI', 'Gemini', 'Gemini 模型', 'Vertex AI'],
        ja: ['Google', 'グーグル', 'Google AI', 'Gemini', 'Vertex AI'],
        es: ['Google', 'Google AI', 'Gemini', 'Vertex AI'],
        pt: ['Google', 'Google AI', 'Gemini', 'Vertex AI'],
        de: ['Google', 'Google AI', 'Gemini', 'Vertex AI'],
        fr: ['Google', 'Google AI', 'Gemini', 'Vertex AI'],
        ru: ['Google', 'Гугл', 'Google AI', 'Gemini', 'Vertex AI'],
        ar: ['Google', 'جوجل', 'Google AI', 'Gemini', 'Vertex AI'],
      },
    ),
  },
  {
    familyPattern: /(?:meta|llama)/i,
    directPattern: /^(?:meta|llama)/i,
    boost: 100,
    aliases: aliases(
      ['meta', 'meta ai', 'llama', 'llama ai', 'llama api'],
      {
        'zh-CN': ['Meta', '脸书 AI', 'Llama', '羊驼', 'Llama 模型'],
        ja: ['Meta', 'メタ', 'Llama', 'ラマモデル'],
        es: ['Meta AI', 'Llama', 'modelo Llama'],
        pt: ['Meta AI', 'Llama', 'modelo Llama'],
        de: ['Meta AI', 'Llama', 'Llama-Modell'],
        fr: ['Meta AI', 'Llama', 'modèle Llama'],
        ru: ['Meta AI', 'Мета', 'Llama', 'модель Llama'],
        ar: ['Meta AI', 'ميتا', 'Llama', 'نموذج Llama'],
      },
    ),
  },
  {
    familyPattern: /(?:mistral|mixtral|codestral|magistral)/i,
    directPattern: /^mistral/i,
    boost: 95,
    aliases: aliases(
      ['mistral', 'mistral ai', 'mixtral', 'codestral', 'magistral'],
      {
        'zh-CN': ['Mistral', 'Mistral AI', 'Mixtral', 'Codestral', 'Mistral 模型'],
        ja: ['Mistral AI', 'ミストラル', 'Mixtral', 'Codestral'],
        es: ['Mistral AI', 'Mixtral', 'Codestral'],
        pt: ['Mistral AI', 'Mixtral', 'Codestral'],
        de: ['Mistral AI', 'Mixtral', 'Codestral'],
        fr: ['Mistral AI', 'Mixtral', 'Codestral'],
        ru: ['Mistral AI', 'Мистраль', 'Mixtral', 'Codestral'],
        ar: ['Mistral AI', 'ميسترال', 'Mixtral', 'Codestral'],
      },
    ),
  },
  {
    familyPattern: /(?:cohere|command(?:[- .]|$))/i,
    directPattern: /^cohere/i,
    boost: 90,
    aliases: aliases(
      ['cohere', 'cohere ai', 'command', 'command-r'],
      {
        'zh-CN': ['Cohere', 'Command', 'Cohere 模型'],
        ja: ['Cohere', 'コヒア', 'Command'],
        es: ['Cohere', 'modelo Command'],
        pt: ['Cohere', 'modelo Command'],
        de: ['Cohere', 'Command-Modell'],
        fr: ['Cohere', 'modèle Command'],
        ru: ['Cohere', 'Кохир', 'модель Command'],
        ar: ['Cohere', 'كوهير', 'نموذج Command'],
      },
    ),
  },
  {
    familyPattern: /(?:nvidia|nemotron)/i,
    directPattern: /^nvidia/i,
    boost: 90,
    aliases: aliases(
      ['nvidia', 'nvidia ai', 'nvidia nim', 'nim', 'nemotron'],
      {
        'zh-CN': ['英伟达', '英伟达 AI', 'NVIDIA NIM', 'Nemotron'],
        ja: ['NVIDIA', 'エヌビディア', 'NVIDIA NIM', 'Nemotron'],
        es: ['NVIDIA', 'NVIDIA NIM', 'Nemotron'],
        pt: ['NVIDIA', 'NVIDIA NIM', 'Nemotron'],
        de: ['NVIDIA', 'NVIDIA NIM', 'Nemotron'],
        fr: ['NVIDIA', 'NVIDIA NIM', 'Nemotron'],
        ru: ['NVIDIA', 'НVIDIA', 'Немотрон', 'NVIDIA NIM'],
        ar: ['NVIDIA', 'إنفيديا', 'Nemotron', 'NVIDIA NIM'],
      },
    ),
  },
  {
    familyPattern: /(?:amazon|aws|bedrock|nova(?:[- .]|$))/i,
    directPattern: /^(?:amazon|nova)/i,
    boost: 95,
    aliases: aliases(
      ['amazon', 'amazon web services', 'aws', 'aws ai', 'amazon bedrock', 'bedrock', 'nova'],
      {
        'zh-CN': ['亚马逊', '亚马逊云', 'AWS', 'AWS Bedrock', 'Amazon Bedrock', 'Nova 模型'],
        ja: ['Amazon', 'アマゾン', 'AWS', 'Amazon Bedrock', 'Nova'],
        es: ['Amazon', 'AWS', 'Amazon Bedrock', 'modelo Nova'],
        pt: ['Amazon', 'AWS', 'Amazon Bedrock', 'modelo Nova'],
        de: ['Amazon', 'AWS', 'Amazon Bedrock', 'Nova-Modell'],
        fr: ['Amazon', 'AWS', 'Amazon Bedrock', 'modèle Nova'],
        ru: ['Amazon', 'Амазон', 'AWS', 'Amazon Bedrock', 'модель Nova'],
        ar: ['Amazon', 'أمازون', 'AWS', 'Amazon Bedrock', 'نموذج Nova'],
      },
    ),
  },
  {
    familyPattern: /(?:azure|microsoft)/i,
    directPattern: /^(?:azure|microsoft)/i,
    boost: 95,
    aliases: aliases(
      ['azure', 'microsoft azure', 'azure openai', 'microsoft ai'],
      {
        'zh-CN': ['微软', '微软云', 'Azure', 'Azure OpenAI'],
        ja: ['Microsoft Azure', 'マイクロソフト', 'Azure OpenAI'],
        es: ['Microsoft Azure', 'Azure OpenAI'],
        pt: ['Microsoft Azure', 'Azure OpenAI'],
        de: ['Microsoft Azure', 'Azure OpenAI'],
        fr: ['Microsoft Azure', 'Azure OpenAI'],
        ru: ['Microsoft Azure', 'Майкрософт', 'Azure OpenAI'],
        ar: ['Microsoft Azure', 'مايكروسوفت', 'Azure OpenAI'],
      },
    ),
  },
  {
    familyPattern: /cloudflare/i,
    directPattern: /^cloudflare/i,
    boost: 85,
    aliases: aliases(
      ['cloudflare', 'cloudflare ai', 'workers ai', 'ai gateway'],
      {
        'zh-CN': ['Cloudflare', 'Cloudflare AI', 'Workers AI', 'AI 网关'],
        ja: ['Cloudflare', 'Workers AI', 'AIゲートウェイ'],
        es: ['Cloudflare', 'Workers AI', 'puerta de enlace de IA'],
        pt: ['Cloudflare', 'Workers AI', 'gateway de IA'],
        de: ['Cloudflare', 'Workers AI', 'KI-Gateway'],
        fr: ['Cloudflare', 'Workers AI', 'passerelle IA'],
        ru: ['Cloudflare', 'Workers AI', 'шлюз ИИ'],
        ar: ['Cloudflare', 'Workers AI', 'بوابة الذكاء الاصطناعي'],
      },
    ),
  },
  {
    familyPattern: /(?:github|gitlab|copilot)/i,
    directPattern: /^(?:github|gitlab)/i,
    boost: 85,
    aliases: aliases(
      ['github', 'github models', 'github copilot', 'copilot', 'gitlab duo'],
      {
        'zh-CN': ['GitHub', 'GitHub Models', 'GitHub Copilot', 'Copilot', 'GitLab Duo'],
        ja: ['GitHub', 'GitHub Copilot', 'コパイロット', 'GitLab Duo'],
        es: ['GitHub', 'GitHub Copilot', 'Copilot', 'GitLab Duo'],
        pt: ['GitHub', 'GitHub Copilot', 'Copilot', 'GitLab Duo'],
        de: ['GitHub', 'GitHub Copilot', 'Copilot', 'GitLab Duo'],
        fr: ['GitHub', 'GitHub Copilot', 'Copilot', 'GitLab Duo'],
        ru: ['GitHub', 'GitHub Copilot', 'Копилот', 'GitLab Duo'],
        ar: ['GitHub', 'GitHub Copilot', 'كوبايلوت', 'GitLab Duo'],
      },
    ),
  },
  {
    familyPattern: /openrouter/i,
    directPattern: /^openrouter/i,
    boost: 80,
    aliases: aliases(
      ['openrouter', 'open router', 'model router', 'model gateway'],
      {
        'zh-CN': ['OpenRouter', '模型路由', '模型网关'],
        ja: ['OpenRouter', 'モデルルーター', 'モデルゲートウェイ'],
        es: ['OpenRouter', 'enrutador de modelos', 'puerta de enlace de modelos'],
        pt: ['OpenRouter', 'roteador de modelos', 'gateway de modelos'],
        de: ['OpenRouter', 'Modell-Router', 'Modell-Gateway'],
        fr: ['OpenRouter', 'routeur de modèles', 'passerelle de modèles'],
        ru: ['OpenRouter', 'маршрутизатор моделей', 'шлюз моделей'],
        ar: ['OpenRouter', 'موجّه النماذج', 'بوابة النماذج'],
      },
    ),
  },
  {
    familyPattern: /huggingface|hugging face/i,
    directPattern: /huggingface|hugging face/i,
    boost: 80,
    aliases: aliases(
      ['hugging face', 'huggingface', 'hf', 'hugging face inference'],
      {
        'zh-CN': ['Hugging Face', '抱抱脸', 'HF 模型社区'],
        ja: ['Hugging Face', 'ハギングフェイス', 'HF'],
        es: ['Hugging Face', 'comunidad de modelos HF'],
        pt: ['Hugging Face', 'comunidade de modelos HF'],
        de: ['Hugging Face', 'HF-Modellcommunity'],
        fr: ['Hugging Face', 'communauté de modèles HF'],
        ru: ['Hugging Face', 'Хаггинг Фейс', 'сообщество моделей HF'],
        ar: ['Hugging Face', 'هاغينغ فيس', 'مجتمع نماذج HF'],
      },
    ),
  },
  {
    familyPattern: /ollama/i,
    directPattern: /^ollama/i,
    boost: 80,
    aliases: aliases(
      ['ollama', 'ollama cloud', 'local ollama', 'local model'],
      {
        'zh-CN': ['Ollama', '奥拉玛', '本地模型', '本地 Ollama'],
        ja: ['Ollama', 'オラマ', 'ローカルモデル'],
        es: ['Ollama local', 'modelo local'],
        pt: ['Ollama local', 'modelo local'],
        de: ['lokales Ollama', 'lokales Modell'],
        fr: ['Ollama local', 'modèle local'],
        ru: ['локальный Ollama', 'локальная модель'],
        ar: ['Ollama المحلي', 'نموذج محلي'],
      },
    ),
  },
  {
    familyPattern: /perplexity|sonar/i,
    directPattern: /^perplexity/i,
    boost: 85,
    aliases: aliases(
      ['perplexity', 'perplexity ai', 'sonar', 'perplexity api'],
      {
        'zh-CN': ['Perplexity', 'Perplexity AI', 'Sonar'],
        ja: ['Perplexity', 'パープレキシティ', 'Sonar'],
        es: ['Perplexity', 'Perplexity AI', 'Sonar'],
        pt: ['Perplexity', 'Perplexity AI', 'Sonar'],
        de: ['Perplexity', 'Perplexity AI', 'Sonar'],
        fr: ['Perplexity', 'Perplexity AI', 'Sonar'],
        ru: ['Perplexity', 'Перплекси́ти', 'Sonar'],
        ar: ['Perplexity', 'بيربلكسيتي', 'Sonar'],
      },
    ),
  },
  {
    familyPattern: /(?:xai|grok)/i,
    directPattern: /^xai/i,
    boost: 90,
    aliases: aliases(
      ['xai', 'x.ai', 'grok', 'grok ai'],
      {
        'zh-CN': ['xAI', 'Grok', 'Grok 模型'],
        ja: ['xAI', 'Grok', 'グロック'],
        es: ['xAI', 'Grok'],
        pt: ['xAI', 'Grok'],
        de: ['xAI', 'Grok'],
        fr: ['xAI', 'Grok'],
        ru: ['xAI', 'Grok', 'Грок'],
        ar: ['xAI', 'Grok', 'غروك'],
      },
    ),
  },
  {
    familyPattern: /groq/i,
    directPattern: /^groq/i,
    boost: 85,
    aliases: all('groq', 'groq cloud', 'Groq API'),
  },
  {
    familyPattern: /cerebras/i,
    directPattern: /^cerebras/i,
    boost: 80,
    aliases: all('cerebras', 'cerebras cloud', 'cerebras inference'),
  },
  {
    familyPattern: /together/i,
    directPattern: /^together/i,
    boost: 75,
    aliases: all('together', 'together ai', 'together inference'),
  },
  {
    familyPattern: /fireworks/i,
    directPattern: /^fireworks/i,
    boost: 75,
    aliases: all('fireworks', 'fireworks ai', 'fireworks inference'),
  },
  {
    familyPattern: /(?:baichuan|百川)/i,
    directPattern: /baichuan/i,
    boost: 90,
    aliases: aliases(['baichuan', 'baichuan ai'], {
      'zh-CN': ['百川', '百川智能', '百川大模型'],
      ja: ['百川', 'Baichuan AI'],
      ru: ['Baichuan', 'Байчуань'],
      ar: ['Baichuan', 'بايتشوان'],
    }),
  },
  {
    familyPattern: /(?:\byi(?:[- .]|$)|01\.ai|零一)/i,
    directPattern: /(?:^yi$|01\.ai)/i,
    boost: 85,
    aliases: aliases(['yi', '01.ai', '01 ai'], {
      'zh-CN': ['零一万物', '零一', 'Yi 模型'],
      ja: ['零一万物', 'Yiモデル'],
      ru: ['01.AI', 'модель Yi'],
      ar: ['01.AI', 'نموذج Yi'],
    }),
  },
  {
    familyPattern: /(?:internlm|intern lm|书生|浦语)/i,
    directPattern: /internlm/i,
    boost: 85,
    aliases: aliases(['internlm', 'intern lm'], {
      'zh-CN': ['书生浦语', '书生·浦语', 'InternLM'],
      ja: ['InternLM', '書生浦語'],
      ru: ['InternLM'],
      ar: ['InternLM'],
    }),
  },
  {
    familyPattern: /longcat/i,
    directPattern: /^longcat/i,
    boost: 80,
    aliases: aliases(['longcat', 'long cat'], {
      'zh-CN': ['LongCat', '龙猫', '龍貓'],
      ja: ['LongCat', 'ロンキャット'],
      ru: ['LongCat'],
      ar: ['LongCat'],
    }),
  },
  {
    familyPattern: /qiniu/i,
    directPattern: /^qiniu/i,
    boost: 75,
    aliases: aliases(['qiniu', 'qiniu ai', 'qiniu cloud'], {
      'zh-CN': ['七牛云', '七牛 AI', '七牛云大模型'],
      ja: ['七牛雲', 'Qiniu AI'],
      ru: ['Qiniu Cloud'],
      ar: ['Qiniu Cloud'],
    }),
  },
]

// Stable first-party ordering for families that expose several official
// endpoints. Catalog order changes when models.dev refreshes, so ranking must
// not depend on the seed file position.
const PREFERRED_PROVIDER_BOOSTS: Readonly<Record<string, number>> = {
  alibaba: 60,
  'alibaba-cn': 50,
  'alibaba-coding-plan-cn': 40,
  'alibaba-coding-plan': 30,
  'alibaba-token-plan': 20,
  'alibaba-token-plan-cn': 10,
  xiaomi: 60,
  'xiaomi-token-plan-cn': 50,
  'xiaomi-token-plan-ams': 40,
  'xiaomi-token-plan-sgp': 30,
  openai: 60,
  anthropic: 60,
  google: 60,
  'google-vertex': 35,
  meta: 60,
  llama: 50,
  deepseek: 60,
  'moonshotai-cn': 60,
  moonshotai: 50,
  'kimi-for-coding': 40,
  zhipuai: 60,
  zai: 55,
  'zhipuai-coding-plan': 45,
  'zai-coding-plan': 40,
  minimax: 60,
  'minimax-cn': 55,
  'minimax-coding-plan': 45,
  'minimax-cn-coding-plan': 40,
  stepfun: 60,
  'stepfun-ai': 55,
  'stepfun-step-plan': 45,
  'stepfun-ai-step-plan': 40,
  siliconflow: 60,
  'siliconflow-cn': 50,
  modelscope: 60,
  'tencent-tokenhub': 60,
  'tencent-coding-plan': 50,
  'tencent-token-plan': 40,
}

const GENERIC_TOKEN_ALIASES: Record<string, Partial<Record<ProviderSearchLocale, readonly string[]>>> = {
  ai: {
    'zh-CN': ['人工智能', '智能'],
    ja: ['人工知能'],
    es: ['inteligencia artificial', 'IA'],
    pt: ['inteligência artificial', 'IA'],
    de: ['künstliche intelligenz', 'KI'],
    fr: ['intelligence artificielle', 'IA'],
    ru: ['искусственный интеллект', 'ИИ'],
    ar: ['الذكاء الاصطناعي', 'ذكاء اصطناعي'],
  },
  cloud: {
    'zh-CN': ['云', '云端', '云服务'],
    ja: ['クラウド'],
    es: ['nube'],
    pt: ['nuvem'],
    de: ['cloud', 'wolke'],
    fr: ['cloud', 'nuage'],
    ru: ['облако'],
    ar: ['سحابة'],
  },
  gateway: {
    'zh-CN': ['网关'],
    ja: ['ゲートウェイ'],
    es: ['puerta de enlace', 'gateway'],
    pt: ['gateway'],
    de: ['gateway'],
    fr: ['passerelle', 'gateway'],
    ru: ['шлюз', 'gateway'],
    ar: ['بوابة', 'gateway'],
  },
  router: {
    'zh-CN': ['路由', '路由器'],
    ja: ['ルーター'],
    es: ['enrutador'],
    pt: ['roteador'],
    de: ['router'],
    fr: ['routeur'],
    ru: ['маршрутизатор'],
    ar: ['موجّه'],
  },
  coding: {
    'zh-CN': ['编程', '编码', '代码', '编程套餐', '编码套餐'],
    ja: ['コーディング', 'コード'],
    es: ['programación', 'código'],
    pt: ['programação', 'código'],
    de: ['programmierung', 'code'],
    fr: ['programmation', 'code'],
    ru: ['программирование', 'код'],
    ar: ['برمجة', 'كود'],
  },
  token: {
    'zh-CN': ['令牌', 'Token', '代币'],
    ja: ['トークン'],
    es: ['token'],
    pt: ['token'],
    de: ['token'],
    fr: ['jeton', 'token'],
    ru: ['токен'],
    ar: ['رمز', 'توكن'],
  },
  plan: {
    'zh-CN': ['套餐', '计划', '订阅', '方案'],
    ja: ['プラン', '購読'],
    es: ['plan', 'suscripción'],
    pt: ['plano', 'assinatura'],
    de: ['plan', 'abonnement'],
    fr: ['plan', 'abonnement'],
    ru: ['план', 'подписка'],
    ar: ['خطة', 'اشتراك'],
  },
  local: {
    'zh-CN': ['本地', '本机'],
    ja: ['ローカル'],
    es: ['local'],
    pt: ['local'],
    de: ['lokal'],
    fr: ['local'],
    ru: ['локальный'],
    ar: ['محلي'],
  },
  china: {
    'zh-CN': ['中国', '中国大陆', '国内', '中国区'],
    ja: ['中国', '中国向け'],
    es: ['China', 'China continental'],
    pt: ['China', 'China continental'],
    de: ['China', 'Festlandchina'],
    fr: ['Chine', 'Chine continentale'],
    ru: ['Китай', 'материковый Китай'],
    ar: ['الصين', 'الصين القارية'],
  },
  global: {
    'zh-CN': ['全球', '国际', '海外'],
    ja: ['グローバル', '海外', '国際'],
    es: ['global', 'internacional'],
    pt: ['global', 'internacional'],
    de: ['global', 'international'],
    fr: ['global', 'international'],
    ru: ['глобальный', 'международный'],
    ar: ['عالمي', 'دولي'],
  },
  europe: {
    'zh-CN': ['欧洲', '欧盟', '欧洲区'],
    ja: ['ヨーロッパ', '欧州'],
    es: ['Europa', 'UE'],
    pt: ['Europa', 'UE'],
    de: ['Europa', 'EU'],
    fr: ['Europe', 'UE'],
    ru: ['Европа', 'ЕС'],
    ar: ['أوروبا', 'الاتحاد الأوروبي'],
  },
  singapore: {
    'zh-CN': ['新加坡', '狮城', '獅城'],
    ja: ['シンガポール'],
    es: ['Singapur'],
    pt: ['Singapura'],
    de: ['Singapur'],
    fr: ['Singapour'],
    ru: ['Сингапур'],
    ar: ['سنغافورة'],
  },
}

const QUERY_ALIAS_REPLACEMENTS: readonly { aliases: readonly string[]; canonical: string }[] = [
  { aliases: ['通义灵码', '灵码', 'tongyi lingma', 'lingma'], canonical: 'qwen coding' },
  { aliases: ['通义千问', '通義千問', '千问', '千問', 'tongyi qianwen', 'qianwen', 'tongyi'], canonical: 'qwen' },
  { aliases: ['小爱同学', '小米大模型', '小米模型', '小米', '小米 MiMo', '小米Mimo', '小爱', 'xiaoai', 'xiao ai', 'シャオミ', 'ミーモ', 'ミモ', 'Сяоми', 'شاومي'], canonical: 'xiaomi' },
  { aliases: ['腾讯混元', '腾讯元宝', '混元大模型', '混元', '腾讯云', '腾讯', 'tencent yuanbao', 'テンセント', 'Тенсент', 'تينسنت'], canonical: 'tencent' },
  { aliases: ['深度求索', '深度求索 AI', 'ディープシーク', 'ДипСик', 'ديب سيك'], canonical: 'deepseek' },
  { aliases: ['月之暗面', '月之暗面 Kimi', 'ムーンショット', 'Кими', 'كيمي'], canonical: 'kimi' },
  { aliases: ['智谱 AI', '智谱', '智谱大模型', 'チープー', 'Чжипу', 'زيبو'], canonical: 'zhipu' },
  { aliases: ['百度智能云', '百度千帆', '文心一言', '文心大模型', '百度', 'バイドゥ', 'Байду', 'بايدو'], canonical: 'baidu' },
  { aliases: ['火山方舟', '火山引擎', '豆包大模型', '豆包', 'volcengine ark', 'ドウバオ', 'БайтДэнс', 'بايت دانس'], canonical: 'doubao' },
  { aliases: ['阶跃星辰', '阶跃 AI', '阶跃', '跃问', 'yuewen', 'ステップファン'], canonical: 'stepfun' },
  { aliases: ['硅基流动', '硅基流动平台', '硅基流动云', 'siliconcloud', 'silicon cloud', 'シリコンフロー', 'СиликонФлоу', 'سيليكون فلو'], canonical: 'siliconflow' },
  { aliases: ['魔搭社区', '魔搭', 'モデルスコープ'], canonical: 'modelscope' },
  { aliases: ['谷歌云', '谷歌', 'グーグル', 'Гугл', 'جوجل'], canonical: 'google' },
  { aliases: ['微软云', '微软', 'マイクロソフト', 'Майкрософт', 'مايكروسوفت'], canonical: 'azure' },
  { aliases: ['英伟达', 'エヌビディア', 'Немотрон', 'إنفيديا'], canonical: 'nvidia' },
  { aliases: ['亚马逊云', '亚马逊', 'アマゾン', 'Амазон', 'أمازون'], canonical: 'amazon' },
  { aliases: ['脸书 AI', '메타', 'メタ', 'Мета', 'ميتا'], canonical: 'meta' },
  { aliases: ['抱抱脸', 'ハギングフェイス', 'Хаггинг Фейс', 'هاغينغ فيس'], canonical: 'huggingface' },
]

const CONTEXT_REPLACEMENTS: readonly { aliases: readonly string[]; canonical: string }[] = [
  { aliases: ['模型服务商', '模型提供商', '模型服务', '提供商', '服务商', '模型', '服务'], canonical: ' ' },
  { aliases: ['model service provider', 'model provider', 'model service', 'provider', 'providers', 'models'], canonical: ' ' },
  { aliases: ['proveedor de modelos', 'proveedores de modelos', 'servicio de modelos', 'modelos'], canonical: ' ' },
  { aliases: ['provedor de modelos', 'provedores de modelos', 'serviço de modelos', 'modelos'], canonical: ' ' },
  { aliases: ['modellanbieter', 'modellservice', 'modelle'], canonical: ' ' },
  { aliases: ['fournisseur de modèles', 'service de modèles', 'modèles'], canonical: ' ' },
  { aliases: ['провайдер моделей', 'сервис моделей', 'модели'], canonical: ' ' },
  { aliases: ['مزود النماذج', 'خدمة النماذج', 'النماذج'], canonical: ' ' },
  { aliases: ['モデルプロバイダー', 'モデルサービス', 'モデル'], canonical: ' ' },
]

function providerLabels(provider: ProviderDefinition): string {
  return [provider.id, provider.name].join(' ')
}

function providerCoreIdentity(provider: ProviderDefinition): string {
  return [provider.id, provider.name, provider.api, provider.doc, ...(provider.env ?? [])].join(' ')
}

function providerFullIdentity(provider: ProviderDefinition): string {
  return [providerCoreIdentity(provider), ...(provider.models ?? []).flatMap((model) => [model.id, model.name])].join(' ')
}

function splitIdentifier(value: string): string[] {
  return value
    .replace(/([a-z\d])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(/[^\p{L}\p{N}]+/u)
    .map((part) => part.trim())
    .filter((part) => part.length > 1)
}

function addTerm(target: ProviderSearchAliasTerm[], value: string, locale?: ProviderSearchLocale): void {
  if (!value.trim()) return
  target.push({ value, locale })
}

function collectLocalizedAliases(target: ProviderSearchAliasTerm[], values: LocalizedAliases): void {
  for (const value of values.common ?? []) addTerm(target, value)
  for (const locale of PROVIDER_SEARCH_LOCALES) {
    for (const value of values[locale] ?? []) addTerm(target, value, locale)
  }
}

function hostTerms(value: string): string[] {
  try {
    const url = new URL(value)
    return url.hostname
      .split('.')
      .flatMap((part) => splitIdentifier(part))
      .filter((part) => !/^(?:www|api|chat|v1|com|ai|cn|net|org|cloud)$/i.test(part))
  } catch {
    return []
  }
}

function addGeneratedProviderTerms(provider: ProviderDefinition, target: ProviderSearchAliasTerm[]): void {
  const sources = [provider.id, provider.name, ...hostTerms(provider.api), ...hostTerms(provider.doc ?? '')]
  const stopWords = new Set(['ai', 'api', 'www', 'cloud', 'models', 'model', 'service', 'services', 'provider', 'providers'])

  for (const source of sources) {
    const parts = splitIdentifier(source)
    if (parts.length === 0) continue
    addTerm(target, parts.join(' '))
    const useful = parts.filter((part) => !stopWords.has(part.toLowerCase()))
    if (useful.length > 0 && useful.length !== parts.length) addTerm(target, useful.join(' '))
    for (const part of useful) {
      if (part.length >= 3) addTerm(target, part)
      const translations = GENERIC_TOKEN_ALIASES[part.toLowerCase()]
      if (!translations) continue
      for (const locale of PROVIDER_SEARCH_LOCALES) {
        for (const value of translations[locale] ?? []) addTerm(target, value, locale)
      }
    }
  }

  const core = providerCoreIdentity(provider).toLowerCase()
  const regionTokens = [
    ['china', 'cn', 'mainland', '中国', '中國', '国内', '國內'],
    ['europe', 'eu', 'ams', '欧洲', '歐洲'],
    ['singapore', 'sgp', '新加坡'],
    ['global', 'international', '海外', '国际', '國際'],
  ] as const
  for (const [key, ...needles] of regionTokens) {
    if (!needles.some((needle) => core.includes(needle.toLowerCase()))) continue
    const translations = GENERIC_TOKEN_ALIASES[key]
    if (!translations) continue
    addTerm(target, key)
    for (const locale of PROVIDER_SEARCH_LOCALES) {
      for (const value of translations[locale] ?? []) addTerm(target, value, locale)
    }
  }

  if (/(?:coding|code|编程|编码)/i.test(core)) {
    collectLocalizedAliases(target, { common: ['coding', 'coding plan', 'code plan'], ...GENERIC_TOKEN_ALIASES.coding, ...GENERIC_TOKEN_ALIASES.plan })
  }
  if (/(?:套餐|订阅|subscription|plan)/i.test(core)) {
    collectLocalizedAliases(target, { common: ['plan', 'subscription'], ...GENERIC_TOKEN_ALIASES.plan })
  }
  if (/token/i.test(core)) {
    collectLocalizedAliases(target, { common: ['token', 'token plan', 'token subscription'], ...GENERIC_TOKEN_ALIASES.token })
  }
  if (/(?:token[-\s]?plan|token plan)/i.test(core)) {
    // Token Plan products in the catalog are coding subscriptions even when
    // their display name omits the word "coding".
    collectLocalizedAliases(target, {
      common: ['code', 'coder', 'coding', 'coding subscription', 'token coding'],
      ...GENERIC_TOKEN_ALIASES.coding,
    })
  }
}

function collectRuleTerms(provider: ProviderDefinition): { provider: ProviderSearchAliasTerm[]; family: ProviderSearchAliasTerm[]; boost: number } {
  const labels = providerLabels(provider)
  const full = providerFullIdentity(provider)
  const providerTerms: ProviderSearchAliasTerm[] = []
  const familyTerms: ProviderSearchAliasTerm[] = []
  const preferredBoost = PREFERRED_PROVIDER_BOOSTS[provider.id] ?? 0
  let boost = preferredBoost

  for (const rule of PROVIDER_ALIAS_RULES) {
    if (rule.familyPattern.test(full)) collectLocalizedAliases(familyTerms, rule.aliases)
    if (rule.directPattern?.test(labels)) {
      collectLocalizedAliases(providerTerms, rule.aliases)
      // A provider name can mention several brands (for example a cloud-hosted
      // Anthropic endpoint). Use its strongest direct identity instead of
      // accumulating unrelated brand boosts.
      boost = Math.max(boost, preferredBoost + (rule.boost ?? 0))
    }
  }
  addGeneratedProviderTerms(provider, providerTerms)
  return { provider: providerTerms, family: familyTerms, boost }
}

function dedupeTerms(terms: readonly ProviderSearchAliasTerm[]): readonly ProviderSearchAliasTerm[] {
  const seen = new Set<string>()
  const output: ProviderSearchAliasTerm[] = []
  for (const term of terms) {
    const key = `${term.locale ?? '*'}:${term.value.normalize('NFKD').toLowerCase()}`
    if (seen.has(key)) continue
    seen.add(key)
    output.push(term)
  }
  return output
}

export function getProviderSearchAliasBundle(provider: ProviderDefinition): ProviderSearchAliasBundle {
  const terms = collectRuleTerms(provider)
  return {
    provider: dedupeTerms(terms.provider),
    family: dedupeTerms(terms.family),
    relevanceBoost: terms.boost,
  }
}

export function getProviderSearchQueryReplacements(): readonly { aliases: readonly string[]; canonical: string }[] {
  return QUERY_ALIAS_REPLACEMENTS
}

export function getProviderSearchContextReplacements(): readonly { aliases: readonly string[]; canonical: string }[] {
  return CONTEXT_REPLACEMENTS
}
